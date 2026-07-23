// CSV-импорт каналов с column-mapping: staging, дедуп, bulk insert/update
// через unnest(), stub-контакты админов и авто-привязка channel_admins.
import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  type FieldDef,
  ImportChannelsSchema as BaseImportChannels,
  ImportChannelsResultSchema as BaseImportResult,
} from "@repo/core";
import { db, sql as sqlClient } from "../../db/client.ts";
import { contactUsernameLowerSql } from "../../lib/contact-sql.ts";
import { errMsg } from "../../lib/errors.ts";
import { loadChannelPropertyDefs } from "../../lib/entity-properties.ts";
import { resolveChannelIdentifier } from "../../lib/channel-providers/index.ts";
import { syncMaxChannelsBatch } from "../../lib/channel-providers/max.ts";
import {
  channelAdmins,
  channels,
  contacts,
  projectItems,
  tgUsers,
} from "../../db/schema.ts";
import { healPlacementRecipients } from "../../lib/placement-recipient.ts";
import {
  assertRole,
  type WorkspaceVars,
} from "../../middleware/assert-member.ts";
import { WsParam, pickMaxClient } from "./shared.ts";

const ImportChannelsSchema = BaseImportChannels.openapi("ImportChannels");
const ImportChannelsResultSchema = BaseImportResult.openapi(
  "ImportChannelsResult",
);

// Drizzle строит INSERT VALUES (a),(b),… через рекурсивный SQL-builder, на
// 10k+ строк падает в RangeError (call-stack). Бьём на куски ~500 — Postgres
// прожуёт каждый чанк за десятки мс, общий импорт остаётся в одном HTTP.
const INSERT_CHUNK = 500;
function chunks<T>(arr: T[], size: number): T[][] {
  if (arr.length <= size) return [arr];
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

// CSV-строка → типизированное значение кастом-поля по каталогу. null = ячейка
// пустая/нераспознанная (не пишем). Для select'ов CSV даёт человекочитаемое имя
// опции — резолвим по name (case-insensitive), затем по id. multi_select —
// значения через запятую.
// optionIndex — заранее построенный словарь lower(name|id) → id для select-поля
// (см. buildOptionIndex). Передаётся снаружи, чтобы не делать linear .find на
// каждую из десятков тысяч CSV-строк.
function coerceImportPropertyValue(
  def: FieldDef,
  rawInput: string | undefined,
  optionIndex: Map<string, string> | undefined,
): unknown {
  const raw = rawInput?.trim();
  if (!raw) return null;
  const resolveOption = (s: string): string | null =>
    optionIndex?.get(s.trim().toLowerCase()) ?? null;
  switch (def.type) {
    case "single_select":
      return resolveOption(raw);
    case "multi_select": {
      const ids = raw
        .split(",")
        .map((s) => resolveOption(s))
        .filter((x): x is string => x !== null);
      return ids.length > 0 ? Array.from(new Set(ids)) : null;
    }
    case "number": {
      const n = Number(raw.replace(/\s+/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    default:
      // text/textarea/email/tel/url/user_select — строка как есть.
      return raw;
  }
}

// Индекс опций select-поля: lower(name|id) → id. id кладём первым, name — вторым,
// чтобы при коллизии имя имело приоритет (как старый «сначала по name»).
function buildOptionIndex(def: FieldDef): Map<string, string> {
  const idx = new Map<string, string>();
  for (const v of def.values ?? []) idx.set(v.id.toLowerCase(), v.id);
  for (const v of def.values ?? []) idx.set(v.name.toLowerCase(), v.id);
  return idx;
}

// CSV-импорт каналов с column-mapping. Body: {rows, mapping, platform}.
// Юзер на фронте маппит колонки в ImportWizard, бэк применяет.
//
// Правило приоритета: соцсетевой pull всегда побеждает.
//   - synced_at IS NULL → CSV пишет всё (типизированные поля + properties)
//   - synced_at IS NOT NULL → CSV пишет только properties; типизированные
//     поля остаются от соцсети
// admin_username и properties всегда обновляются — соцсеть их не отдаёт.
// Кастом-поля (mapping.properties) валидируются по каталогу канала; ключи не из
// каталога и нераспознанные select-значения молча отбрасываются.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/import",
    tags: ["channels"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: ImportChannelsSchema } },
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ImportChannelsResultSchema } },
        description: "Import result",
      },
    },
  }),
  async (c) => {
    const { wsId } = c.req.valid("param");
    const userId = c.get("userId");
    const { rows, mapping } = c.req.valid("json");

    // Каталог кастом-полей канала — для коэрции/валидации mapping.properties.
    const propertyDefs = await loadChannelPropertyDefs(wsId);
    const defByKey = new Map(propertyDefs.map((d) => [d.key, d]));
    // Индексы опций select-полей строим один раз (не на каждую строку).
    const optionIndexByKey = new Map<string, Map<string, string>>();
    for (const d of propertyDefs) {
      if (d.type === "single_select" || d.type === "multi_select") {
        optionIndexByKey.set(d.key, buildOptionIndex(d));
      }
    }

    // Step 1: применяем mapping к каждой строке CSV → нормализованный staging.
    // Идентификатор — ОДНА колонка-ссылка. Платформа детектится из домена
    // построчно (тот же резолвер, что и ручная вставка); для TG username/инвайт
    // извлекаются из URL. Одна точка истины — нет рассинхрона username vs link.
    // Ключ дедупа: platform + (lower(username) | lower(link)).
    type Staged = {
      title: string;
      platform: "telegram" | "youtube" | "tiktok" | "dzen" | "max";
      username: string | null;
      link: string | null;
      memberCount: number | null;
      description: string | null;
      // lower-case без `@`, для smart-stub резолва.
      adminUsername: string | null;
      properties: Record<string, unknown>;
    };
    const stagedByKey = new Map<string, Staged>();
    let skippedNoIdentifier = 0;
    const propsMap = mapping.properties ?? {};

    const pickStr = (r: Record<string, string>, h: string | undefined) =>
      h ? r[h]?.trim() || null : null;
    const stagedKey = (s: Pick<Staged, "platform" | "username" | "link">) =>
      `${s.platform}:` +
      (s.username ? `un:${s.username.toLowerCase()}` : `ln:${s.link!.toLowerCase()}`);

    for (const r of rows) {
      const linkRaw = pickStr(r, mapping.link);
      // Адрес → платформа + идентификатор одним резолвером (общий с bulk).
      const resolved = linkRaw ? resolveChannelIdentifier(linkRaw) : null;
      if (!resolved) {
        skippedNoIdentifier++;
        continue;
      }
      const { platform, username, link } = resolved;
      const key = stagedKey({ platform, username, link });

      const description = pickStr(r, mapping.description);
      const memCntRaw = pickStr(r, mapping.memberCount);
      const memCntParsed = memCntRaw ? Number(memCntRaw.replace(/\s+/g, "")) : NaN;
      const memberCount = Number.isFinite(memCntParsed) ? memCntParsed : null;
      const adminRaw = pickStr(r, mapping.adminUsername);
      const adminUsername = adminRaw
        ? adminRaw.replace(/^@/, "").toLowerCase()
        : null;

      // properties: только ключи из каталога; значение коэрсим под тип поля.
      const properties: Record<string, unknown> = {};
      for (const [pkey, csvHeader] of Object.entries(propsMap)) {
        const def = defByKey.get(pkey);
        if (!def) continue;
        const v = coerceImportPropertyValue(
          def,
          r[csvHeader],
          optionIndexByKey.get(pkey),
        );
        if (v !== null) properties[pkey] = v;
      }

      // title без явного маппинга — fallback на @username или link,
      // чтобы NOT NULL constraint не падал.
      const titleFromCsv = pickStr(r, mapping.title);
      const title = titleFromCsv || (username ? `@${username}` : link!);

      const existing = stagedByKey.get(key);
      if (existing) {
        // Несколько CSV-строк на тот же канал → склеиваем, ранняя строка
        // приоритетнее по непустым полям, properties мержатся.
        stagedByKey.set(key, {
          title: existing.title || title,
          platform: existing.platform,
          username: existing.username || username,
          link: existing.link || link,
          memberCount: existing.memberCount ?? memberCount,
          description: existing.description || description,
          adminUsername: existing.adminUsername || adminUsername,
          properties: { ...existing.properties, ...properties },
        });
      } else {
        stagedByKey.set(key, {
          title,
          platform,
          username,
          link,
          memberCount,
          description,
          adminUsername,
          properties,
        });
      }
    }

    // Step 2: lookup существующих каналов по lower(username) ИЛИ lower(link).
    // Платформа теперь построчная → не фильтруем по ней в SQL, а кладём в ключ
    // мапы (`${platform}:un|ln:value`) и матчим уже с учётом платформы строки.
    // link-ключ берём только у staged без username (иначе дедуп идёт по @).
    const stagedList = [...stagedByKey.values()];
    const usernamesLower = stagedList
      .map((s) => s.username?.toLowerCase())
      .filter((x): x is string => !!x);
    const linksLower = stagedList
      .filter((s) => !s.username && s.link)
      .map((s) => s.link!.toLowerCase());

    const existingChannels =
      usernamesLower.length || linksLower.length
        ? await db
            .select({
              id: channels.id,
              platform: channels.platform,
              usernameLower: sql<string | null>`lower(${channels.username})`,
              linkLower: sql<string | null>`lower(${channels.link})`,
              syncedAt: channels.syncedAt,
              properties: channels.properties,
            })
            .from(channels)
            .where(
              and(
                eq(channels.workspaceId, wsId),
                or(
                  usernamesLower.length
                    ? inArray(sql`lower(${channels.username})`, usernamesLower)
                    : undefined,
                  linksLower.length
                    ? inArray(sql`lower(${channels.link})`, linksLower)
                    : undefined,
                ),
              ),
            )
        : [];

    // Ключ совпадает со stagedKey: `${platform}:un|ln:value`.
    const existingByKey = new Map<string, (typeof existingChannels)[number]>();
    for (const e of existingChannels) {
      if (e.usernameLower) {
        existingByKey.set(`${e.platform}:un:${e.usernameLower}`, e);
      }
      if (e.linkLower) {
        existingByKey.set(`${e.platform}:ln:${e.linkLower}`, e);
      }
    }

    // Step 3: разруливаем INSERT vs UPDATE-typed vs UPDATE-props-only.
    type ToInsert = Staged & { __ins: true };
    type ToUpdateFull = Staged & {
      __upd: "full";
      id: string;
      mergedProps: Record<string, unknown>;
    };
    type ToUpdatePropsOnly = {
      __upd: "props";
      id: string;
      mergedProps: Record<string, unknown>;
      adminUsername: string | null;
      // Прямая ссылка на staged-row, чтобы потом не искать через
      // O(N²) linear-scan для построения idByKey.
      staged: Staged;
    };
    const toInsert: ToInsert[] = [];
    const toUpdateFull: ToUpdateFull[] = [];
    const toUpdatePropsOnly: ToUpdatePropsOnly[] = [];

    for (const staged of stagedList) {
      const exMatch = existingByKey.get(stagedKey(staged)) ?? null;
      if (!exMatch) {
        toInsert.push({ ...staged, __ins: true });
        continue;
      }
      const merged = {
        ...((exMatch.properties as Record<string, unknown>) ?? {}),
        ...staged.properties,
      };
      if (exMatch.syncedAt) {
        toUpdatePropsOnly.push({
          __upd: "props",
          id: exMatch.id,
          mergedProps: merged,
          adminUsername: staged.adminUsername,
          staged,
        });
      } else {
        toUpdateFull.push({
          ...staged,
          __upd: "full",
          id: exMatch.id,
          mergedProps: merged,
        });
      }
    }

    // Step 4: stub-контакты для admin'ов (та же логика что была в старом
    // /import: smart-stub — если @username есть в tg_users replica, контакт
    // создаётся с tg_user_id сразу).
    const uniqueAdminUsernames = new Set<string>();
    for (const s of stagedList) {
      if (s.adminUsername) uniqueAdminUsernames.add(s.adminUsername);
    }
    let adminContactsCreated = 0;
    let adminContactsRecognized = 0;
    const usernameToContactId = new Map<string, string>();
    if (uniqueAdminUsernames.size > 0) {
      const usernames = [...uniqueAdminUsernames];
      const existingContacts = await db
        .select({
          id: contacts.id,
          username: contactUsernameLowerSql,
        })
        .from(contacts)
        .where(
          and(
            eq(contacts.workspaceId, wsId),
            inArray(
              contactUsernameLowerSql,
              usernames,
            ),
          ),
        );
      for (const e of existingContacts) {
        if (e.username) usernameToContactId.set(e.username, e.id);
      }
      const missing = usernames.filter((u) => !usernameToContactId.has(u));
      if (missing.length > 0) {
        const known = await db
          .select({
            userId: tgUsers.userId,
            username: sql<string>`lower(${tgUsers.username})`,
            fullName: tgUsers.fullName,
          })
          .from(tgUsers)
          .where(
            and(
              eq(tgUsers.isDeleted, false),
              inArray(sql`lower(${tgUsers.username})`, missing),
            ),
          );
        const knownByUsername = new Map(known.map((k) => [k.username, k]));
        const stubInserts = missing.map((u) => {
          const k = knownByUsername.get(u);
          const props: Record<string, unknown> = {
            telegram_username: u,
            full_name: k?.fullName || `@${u}`,
          };
          if (k?.userId) props.tg_user_id = k.userId;
          if (k) adminContactsRecognized++;
          return { workspaceId: wsId, properties: props, createdBy: userId };
        });
        for (const chunk of chunks(stubInserts, INSERT_CHUNK)) {
          const inserted = await db
            .insert(contacts)
            .values(chunk)
            .onConflictDoNothing()
            .returning({
              id: contacts.id,
              username: contactUsernameLowerSql,
            });
          for (const ins of inserted) {
            if (ins.username) usernameToContactId.set(ins.username, ins.id);
          }
          adminContactsCreated += inserted.length;
        }
        // ON CONFLICT мог проглотить race — дочитываем.
        const stillMissing = missing.filter((u) => !usernameToContactId.has(u));
        if (stillMissing.length > 0) {
          const reread = await db
            .select({
              id: contacts.id,
              username: contactUsernameLowerSql,
            })
            .from(contacts)
            .where(
              and(
                eq(contacts.workspaceId, wsId),
                inArray(
                  contactUsernameLowerSql,
                  stillMissing,
                ),
              ),
            );
          for (const r of reread) {
            if (r.username) usernameToContactId.set(r.username, r.id);
          }
        }
      }
    }

    // Step 5: bulk INSERT новых каналов чанками по INSERT_CHUNK.
    let channelsCreated = 0;
    // Свежесозданные id — для жадной MAX-выгрузки на импорте (CHAT_INFO ×100).
    const createdChannelIds: string[] = [];
    const idByKey = new Map<string, string>();
    if (toInsert.length > 0) {
      const allRows = toInsert.map((t) => ({
        workspaceId: wsId,
        platform: t.platform,
        title: t.title,
        description: t.description,
        username: t.username,
        link: t.link,
        memberCount: t.memberCount,
        properties: t.properties,
        createdBy: userId,
      }));
      for (const chunk of chunks(allRows, INSERT_CHUNK)) {
        const inserted = await db
          .insert(channels)
          .values(chunk)
          .returning({
            id: channels.id,
            platform: channels.platform,
            usernameLower: sql<string | null>`lower(${channels.username})`,
            linkLower: sql<string | null>`lower(${channels.link})`,
          });
        for (const ins of inserted) {
          // Ключ как stagedKey: `${platform}:un|ln:value`.
          if (ins.usernameLower) {
            idByKey.set(`${ins.platform}:un:${ins.usernameLower}`, ins.id);
          } else if (ins.linkLower) {
            idByKey.set(`${ins.platform}:ln:${ins.linkLower}`, ins.id);
          }
          if (ins.platform === "max") createdChannelIds.push(ins.id);
        }
        channelsCreated += inserted.length;
      }
    }

    // Также мапим существующих в тот же idByKey — для admin-привязки ниже.
    for (const u of toUpdateFull) {
      idByKey.set(stagedKey(u), u.id);
    }
    for (const u of toUpdatePropsOnly) {
      idByKey.set(stagedKey(u.staged), u.id);
    }

    // Step 6: bulk UPDATE существующих каналов через unnest(). Один SQL на
    // все строки — даже на 14k без N+1. postgres-js принимает массивы и
    // авто-сериализует в text[]/int[]/jsonb-массивы.
    if (toUpdateFull.length > 0) {
      const ids = toUpdateFull.map((u) => u.id);
      const titles = toUpdateFull.map((u) => u.title);
      const usernames = toUpdateFull.map((u) => u.username);
      const links = toUpdateFull.map((u) => u.link);
      const members = toUpdateFull.map((u) => u.memberCount);
      const descs = toUpdateFull.map((u) => u.description);
      const propsJson = toUpdateFull.map((u) => JSON.stringify(u.mergedProps));
      await sqlClient`
        UPDATE channels c SET
          title = u.title,
          username = COALESCE(u.username, c.username),
          link = COALESCE(u.link, c.link),
          member_count = COALESCE(u.member_count, c.member_count),
          description = COALESCE(u.description, c.description),
          properties = u.properties::jsonb,
          updated_at = now()
        FROM unnest(
          ${ids}::text[],
          ${titles}::text[],
          ${usernames}::text[],
          ${links}::text[],
          ${members}::integer[],
          ${descs}::text[],
          ${propsJson}::text[]
        ) AS u(id, title, username, link, member_count, description, properties)
        WHERE c.id = u.id
      `;
    }

    if (toUpdatePropsOnly.length > 0) {
      const ids = toUpdatePropsOnly.map((u) => u.id);
      const propsJson = toUpdatePropsOnly.map((u) =>
        JSON.stringify(u.mergedProps),
      );
      await sqlClient`
        UPDATE channels c SET
          properties = u.properties::jsonb,
          updated_at = now()
        FROM unnest(
          ${ids}::text[],
          ${propsJson}::text[]
        ) AS u(id, properties)
        WHERE c.id = u.id
      `;
    }

    // Step 7: channel_admins. Авто-детект админа из импорта НЕ перебивает
    // активное размещение молча — иначе рождается «зомби»-карточка: канал
    // числится за одним контактом, а карточка ведёт другого (channel_admins и
    // project_items.contact_id расходятся, heal тут не звался). Классифицируем
    // каждую детект-связь по состоянию размещений канала:
    //  • КОНФЛИКТ (есть живое размещение с ДРУГИМ получателем) → channel_admins
    //    не трогаем, кладём кандидата в meta.suggested_admin: оператор увидит на
    //    карточке «админ сменился → перевести?» и решит сам (осознанный set-admin);
    //  • БЕЗОПАСНО (размещения нет / получатель совпадает / сирота) → пишем
    //    channel_admins; для каналов с размещениями лечим сирот (heal без
    //    override — заполняем contact_id IS NULL, не перетирая настроенных).
    const detectedLinks: {
      channelId: string;
      contactId: string;
      username: string;
    }[] = [];
    for (const staged of stagedList) {
      if (!staged.adminUsername) continue;
      const channelId = idByKey.get(stagedKey(staged));
      const contactId = usernameToContactId.get(staged.adminUsername);
      if (channelId && contactId) {
        detectedLinks.push({
          channelId,
          contactId,
          username: staged.adminUsername,
        });
      }
    }
    if (detectedLinks.length > 0) {
      const detChannelIds = [...new Set(detectedLinks.map((l) => l.channelId))];
      const placementRows = await db
        .select({
          channelId: projectItems.channelId,
          contactId: projectItems.contactId,
        })
        .from(projectItems)
        .where(inArray(projectItems.channelId, detChannelIds));
      const recipientsByChannel = new Map<string, Set<string>>();
      const channelsWithPlacement = new Set<string>();
      for (const p of placementRows) {
        if (!p.channelId) continue;
        channelsWithPlacement.add(p.channelId);
        if (p.contactId) {
          const set = recipientsByChannel.get(p.channelId) ?? new Set<string>();
          set.add(p.contactId);
          recipientsByChannel.set(p.channelId, set);
        }
      }
      const safeLinks: { channelId: string; contactId: string }[] = [];
      const healChannelIds = new Set<string>();
      const conflicts: { channelId: string; username: string }[] = [];
      for (const l of detectedLinks) {
        const recips = recipientsByChannel.get(l.channelId);
        if (recips && recips.size > 0 && !recips.has(l.contactId)) {
          conflicts.push({ channelId: l.channelId, username: l.username });
        } else {
          safeLinks.push({ channelId: l.channelId, contactId: l.contactId });
          if (channelsWithPlacement.has(l.channelId)) {
            healChannelIds.add(l.channelId);
          }
        }
      }
      for (const chunk of chunks(safeLinks, INSERT_CHUNK)) {
        await db.insert(channelAdmins).values(chunk).onConflictDoNothing();
      }
      for (const channelId of healChannelIds) {
        await healPlacementRecipients(channelId);
      }
      // Safe-канал больше не в конфликте → гасим возможный старый suggested_admin
      // (иначе маркер «админ сменился» завис бы после того, как расхождение ушло:
      // прошлый импорт мог его выставить, а этот подтвердил совпадение). Только
      // каналы с размещением — suggested_admin в принципе ставится лишь для них.
      if (healChannelIds.size > 0) {
        await db
          .update(channels)
          .set({ meta: sql`${channels.meta} - 'suggested_admin'` })
          .where(inArray(channels.id, [...healChannelIds]));
      }
      if (conflicts.length > 0) {
        // Один bulk-UPDATE через unnest (идиома этого файла, ср. Step 6 выше),
        // а не N round-trip'ов: у каждого конфликта свой username в meta.
        const ids = conflicts.map((c) => c.channelId);
        const usernames = conflicts.map((c) => c.username);
        await sqlClient`
          UPDATE channels c SET
            meta = c.meta || jsonb_build_object('suggested_admin', u.username),
            updated_at = now()
          FROM unnest(${ids}::text[], ${usernames}::text[]) AS u(id, username)
          WHERE c.id = u.id
        `;
      }
    }

    // MAX: жадно выгружаем карточки свежесозданных каналов в фоне — CHAT_INFO
    // батчит до 100 id за раз (другое API, чем ленивый per-channel у YT/TikTok).
    // Не блокируем ответ импорта; reach доберётся ленивым single-синком.
    if (createdChannelIds.length > 0) {
      const role = c.get("workspaceRole");
      void (async () => {
        try {
          const picked = await pickMaxClient(wsId, userId, role);
          if (!picked) return;
          const rows = await db
            .select()
            .from(channels)
            .where(inArray(channels.id, createdChannelIds));
          const res = await syncMaxChannelsBatch(picked.client, rows);
          console.log(
            `[max-import] ${wsId}: выгружено ${res.updated}, не резолвнулось ${res.unresolved}`,
          );
        } catch (e) {
          console.error(`[max-import] batch failed ${wsId}:`, errMsg(e));
        }
      })();
    }

    return c.json({
      channelsCreated,
      channelsUpdated: toUpdateFull.length,
      channelsSyncSkipped: toUpdatePropsOnly.length,
      adminContactsCreated,
      adminContactsRecognized,
      skippedNoIdentifier,
    });
  },
);

export default app;
