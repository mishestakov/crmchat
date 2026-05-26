import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  type Channel,
  ChannelSchema as BaseChannelSchema,
  CreateChannelSchema as BaseCreateChannel,
  ImportChannelsSchema as BaseImportChannels,
  ImportChannelsResultSchema as BaseImportResult,
} from "@repo/core";
import { db, sql as sqlClient } from "../db/client.ts";
import { contactUsernameLowerSql } from "../lib/contact-sql.ts";
import { extractUsername } from "../lib/tg-username.ts";
import { errMsg } from "../lib/errors.ts";
import {
  type TdContent,
  TdMediaThumbSchema,
  TdMessageEntitySchema,
  extractFormattedText,
  extractMediaThumb,
} from "../lib/td-message.ts";
import {
  channelAdmins,
  channelSubscriptions,
  channelThumbnails,
  channels,
  contacts,
  outreachAccounts,
  tgUsers,
} from "../db/schema.ts";
import {
  assertChannelAccess,
  channelAccessClause,
} from "../lib/channels-access.ts";
import { contactAccessClause } from "../lib/contacts-access.ts";
import { getOutreachWorkerClient } from "../lib/outreach-account-client.ts";
import { accountAccessClause } from "../lib/outreach-access.ts";
import {
  assertRole,
  type WorkspaceRole,
  type WorkspaceVars,
} from "../middleware/assert-member.ts";
import type { TdClient } from "../lib/tdlib/client.ts";

// Каналы читаются любым outreach-аккаунтом workspace'а — единственный
// TG-actor у нас. Берём первый available active доступный юзеру (RBAC через
// accountAccessClause), поднимаем worker'а если ещё не поднят.
//
// Round-robin / sticky канал→аккаунт не вводим: один аккаунт прочитает
// любой канал, thumbnail/member_count кешируется 24h. Если упрёмся в
// flood-лимиты — добавим выбор по нагрузке.
// Классификация TDLib/MTProto-ошибок resolve'а канала. Permanent = «канала
// действительно нет с точки зрения TG» — пишем в unavailable_*, перестаём
// дёргать TDLib (cooldown-gate ниже). Transient (FLOOD_WAIT, network, 5xx)
// просто throw — не помечаем, пусть юзер ретраит.
//
// Список patterns пополняется по факту: добавляем когда реально увидели в
// проде. core.telegram.org/api/errors имеет ещё CHANNEL_PRIVATE,
// USERNAME_INVALID, PEER_ID_INVALID — добавим если наткнёмся.
const PERMANENT_RESOLVE_PATTERNS = ["chat not found", "username_not_occupied"];

function classifyResolveError(
  e: unknown,
): { permanent: true; reason: string } | { permanent: false } {
  const raw = errMsg(e);
  const low = raw.toLowerCase();
  for (const p of PERMANENT_RESOLVE_PATTERNS) {
    if (low.includes(p)) return { permanent: true, reason: raw };
  }
  return { permanent: false };
}

async function markChannelUnavailable(
  id: string,
  reason: string,
): Promise<void> {
  await db
    .update(channels)
    .set({
      unavailableSince: sql`coalesce(${channels.unavailableSince}, now())`,
      unavailableLastCheckAt: new Date(),
      unavailableReason: reason,
    })
    .where(eq(channels.id, id));
}

// Cooldown между retry-ями TDLib для unavailable-каналов. После провала ждём
// час — потом один шанс. «Нормальные клиенты не долбят туда где не
// существует». Юзер может бэк-флагом ?force=true сбить cooldown, если
// нужна immediate-проверка (кнопка «проверить сейчас» в UI).
const UNAVAILABLE_COOLDOWN_MS = 60 * 60 * 1000;

function isInUnavailableCooldown(
  channel: typeof channels.$inferSelect,
): boolean {
  if (!channel.unavailableLastCheckAt) return false;
  return (
    Date.now() - channel.unavailableLastCheckAt.getTime() <
    UNAVAILABLE_COOLDOWN_MS
  );
}

async function clearChannelUnavailable(id: string): Promise<void> {
  await db
    .update(channels)
    .set({
      unavailableSince: null,
      unavailableLastCheckAt: null,
      unavailableReason: null,
    })
    .where(eq(channels.id, id));
}

async function pickOutreachClient(
  wsId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<{ client: TdClient; accountId: string } | null> {
  const [acc] = await db
    .select({ id: outreachAccounts.id, workspaceId: outreachAccounts.workspaceId })
    .from(outreachAccounts)
    .where(
      and(
        accountAccessClause(wsId, userId, role),
        eq(outreachAccounts.status, "active"),
      ),
    )
    .orderBy(outreachAccounts.createdAt)
    .limit(1);
  if (!acc) return null;
  const client = await getOutreachWorkerClient(acc);
  if (!client) return null;
  return { client, accountId: acc.id };
}

// Выбор аккаунта для чтения канала. Приоритет: любой подписанный аккаунт
// workspace'a (для приватных каналов это единственный способ + позволяет
// команде читать через коллегин аккаунт). Fallback — мой собственный
// аккаунт (для публичных каналов работает без подписки, как раньше).
async function pickChannelReader(
  channelId: string,
  wsId: string,
  userId: string,
  role: WorkspaceRole,
): Promise<{ client: TdClient; accountId: string } | null> {
  const [subscribed] = await db
    .select({ id: outreachAccounts.id, workspaceId: outreachAccounts.workspaceId })
    .from(channelSubscriptions)
    .innerJoin(
      outreachAccounts,
      eq(outreachAccounts.id, channelSubscriptions.accountId),
    )
    .where(
      and(
        eq(channelSubscriptions.channelId, channelId),
        eq(channelSubscriptions.status, "subscribed"),
        eq(outreachAccounts.workspaceId, wsId),
        eq(outreachAccounts.status, "active"),
      ),
    )
    .limit(1);
  if (subscribed) {
    const client = await getOutreachWorkerClient(subscribed);
    if (client) return { client, accountId: subscribed.id };
  }
  return pickOutreachClient(wsId, userId, role);
}

const ChannelSchema = BaseChannelSchema.openapi("Channel");
const CreateChannelSchema = BaseCreateChannel.openapi("CreateChannel");
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

const WsParam = z.object({ wsId: z.string().min(1).max(64) });
const WsIdParam = z.object({
  wsId: z.string().min(1).max(64),
  id: z.string().min(1).max(64),
});
const WsIdContactParam = z.object({
  wsId: z.string().min(1).max(64),
  id: z.string().min(1).max(64),
  contactId: z.string().min(1).max(64),
});

// Привязать админов можно двумя способами: contactIds — выбрать существующие
// контакты; usernames — добавить по @username (find-or-create stub-контакт, как
// при CSV-импорте). Это закрывает «контакта админа нет — добавить прямо здесь».
const AddAdminsBody = z
  .object({
    contactIds: z.array(z.string().min(1).max(64)).max(50).optional(),
    usernames: z.array(z.string().min(1).max(64)).max(50).optional(),
  })
  .refine(
    (b) => (b.contactIds?.length ?? 0) + (b.usernames?.length ?? 0) > 0,
    { message: "укажите contactIds или usernames" },
  );

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

// Soft-limit на /channels: на 14k каналов фронт рендерит без боли, но
// уже на 100k+ JSON станет толстым. 1000 — компромисс: видно достаточно
// для оценки, а если каналов больше — юзер сужает поиском.
const CHANNELS_PAGE_LIMIT = 1000;

const ChannelsListQuery = z.object({
  q: z.string().max(200).optional(),
});

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/channels",
    tags: ["channels"],
    request: { params: WsParam, query: ChannelsListQuery },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(ChannelSchema) } },
        description: "Channels with admins (limit 1000, see CHANNELS_PAGE_LIMIT)",
      },
    },
  }),
  async (c) => {
    const { wsId } = c.req.valid("param");
    const { q } = c.req.valid("query");
    // Поиск: ILIKE по title + username. Юзер вводит подстроку, regex не
    // нужен — escape '%' и '_' чтобы спецсимволы не превращали запрос в
    // wildcard'ный.
    const term = q?.trim();
    const searchClause = term
      ? sql`(${channels.title} ILIKE ${"%" + term.replace(/[%_]/g, "\\$&") + "%"} OR ${channels.username} ILIKE ${"%" + term.replace(/[%_]/g, "\\$&") + "%"})`
      : undefined;
    // Сортировка: member_count desc (NULLS LAST для не-засинканных) — топ
    // канал сверху, главный сигнал ценности; created_at — tie-breaker.
    const rows = await db
      .select()
      .from(channels)
      .where(and(channelAccessClause(wsId), searchClause))
      .orderBy(
        sql`${channels.memberCount} desc nulls last, ${channels.createdAt} desc`,
      )
      .limit(CHANNELS_PAGE_LIMIT);
    return c.json(await joinAdmins(rows));
  },
);

// Single-channel GET для карточки контакта: блок «Каналы» показывает табы
// по contact.channels[], клик по табу подгружает полный Channel.
app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/channels/{id}",
    tags: ["channels"],
    request: { params: WsIdParam },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Channel by id",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const channel = await assertChannelAccess(id, wsId);
    const [serialized] = await joinAdmins([channel]);
    return c.json(serialized!);
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels",
    tags: ["channels"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: CreateChannelSchema } },
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const { wsId } = c.req.valid("param");
    const userId = c.get("userId");
    const body = c.req.valid("json");

    const [created] = await db
      .insert(channels)
      .values({
        workspaceId: wsId,
        platform: body.platform ?? "telegram",
        title: body.title,
        link: body.link ?? null,
        username: body.username ?? null,
        externalId: body.externalId ?? null,
        createdBy: userId,
      })
      .returning();
    if (!created) throw new HTTPException(500, { message: "insert failed" });

    if (body.adminContactIds?.length) {
      await db
        .insert(channelAdmins)
        .values(
          body.adminContactIds.map((contactId) => ({
            channelId: created.id,
            contactId,
          })),
        )
        .onConflictDoNothing();
    }

    const [serialized] = await joinAdmins([created]);
    return c.json(serialized!, 201);
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/channels/{id}",
    tags: ["channels"],
    middleware: [assertRole("admin")] as const,
    request: { params: WsIdParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    await db
      .delete(channels)
      .where(and(eq(channels.id, id), eq(channels.workspaceId, wsId)));
    return c.body(null, 204);
  },
);

// Привязка контакт↔канал постфактум: каналы могли прийти из CSV без
// админов, а контакты автоподтянуться позже из живого трафика — нужен
// способ связать руками. Возвращает обновлённый channel (с актуальным
// admins[]) — фронт сразу патчит cache.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/admins",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      body: { content: { "application/json": { schema: AddAdminsBody } } },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Admins added",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const userId = c.get("userId");
    const { contactIds = [], usernames = [] } = c.req.valid("json");

    const channel = await assertChannelAccess(id, wsId);

    // Проверяем, что все contactIds доступны юзеру (а не просто принадлежат
    // workspace'у): member не должен прилинковать к каналу контакт коллеги,
    // которого сам видеть не вправе.
    if (contactIds.length > 0) {
      const valid = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(contactAccessClause(wsId), inArray(contacts.id, contactIds)));
      if (valid.length !== contactIds.length) {
        throw new HTTPException(400, {
          message: "some contacts are not accessible",
        });
      }
    }

    // usernames → find-or-create stub-контакт. extractUsername нормализует и
    // отбрасывает мусор (URL/«foo bar»/точки) — иначе в telegram_username
    // попадёт битый хэндл, который аутрич не зарезолвит. full_name = «@username»
    // до первого синка/трафика.
    const linkIds = [...contactIds];
    const norm = [
      ...new Set(
        usernames
          .map((u) => extractUsername(u))
          .filter((u): u is string => u !== null),
      ),
    ];
    if (norm.length > 0) {
      await db
        .insert(contacts)
        .values(
          norm.map((u) => ({
            workspaceId: wsId,
            properties: { telegram_username: u, full_name: `@${u}` },
            createdBy: userId,
          })),
        )
        .onConflictDoNothing();
      const found = await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(
          and(
            eq(contacts.workspaceId, wsId),
            inArray(contactUsernameLowerSql, norm),
          ),
        );
      linkIds.push(...found.map((f) => f.id));
    }

    if (linkIds.length > 0) {
      await db
        .insert(channelAdmins)
        .values(linkIds.map((contactId) => ({ channelId: id, contactId })))
        .onConflictDoNothing();
    }

    const [serialized] = await joinAdmins([channel]);
    return c.json(serialized!);
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/channels/{id}/admins/{contactId}",
    tags: ["channels"],
    request: { params: WsIdContactParam },
    responses: { 204: { description: "Admin removed" } },
  }),
  async (c) => {
    const { wsId, id, contactId } = c.req.valid("param");
    // Канал должен быть доступен этому юзеру (без проверки можно было бы
    // дёрнуть DELETE по подобранному channelId, в том числе чужому).
    await assertChannelAccess(id, wsId);
    await db
      .delete(channelAdmins)
      .where(
        and(
          eq(channelAdmins.channelId, id),
          eq(channelAdmins.contactId, contactId),
        ),
      );
    return c.body(null, 204);
  },
);

// Pull свежей карточки канала из TG. Lazy: фронт дёргает при открытии
// drawer'а если synced_at IS NULL или > 24h.
//
// Цепочка:
//   - если есть external_id → getChat(id)
//   - иначе по username → searchPublicChat(username) → Chat (с id)
//   - getSupergroup + getSupergroupFullInfo (только chatTypeSupergroup;
//     private/group/bot → 400)
// Запись: типизированные колонки + meta (REPLACE целиком) + synced_at.
// properties и admins не трогаем. Thumbnail (chat.photo.minithumbnail) →
// channel_thumbnails.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/sync",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      // ?force=true — кнопка «проверить сейчас» в UI: пропустить cooldown-gate
      // и сходить в TDLib даже если канал помечен недоступным <1h назад.
      query: z.object({ force: z.coerce.boolean().optional() }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Channel synced from TG",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { force } = c.req.valid("query");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);

    if (channel.platform !== "telegram") {
      throw new HTTPException(400, {
        message: `sync supported only for platform=telegram (got ${channel.platform})`,
      });
    }
    if (!channel.externalId && !channel.username) {
      throw new HTTPException(400, {
        message: "channel has neither external_id nor username; nothing to look up",
      });
    }
    // Cooldown-gate: канал помечен недоступным <1h назад → не идём в TDLib,
    // если только не передали ?force=true (кнопка «проверить сейчас» в UI).
    if (!force && isInUnavailableCooldown(channel)) {
      throw new HTTPException(410, {
        message: channel.unavailableReason ?? "channel unavailable",
      });
    }

    const picked = await pickOutreachClient(wsId, userId, role);
    if (!picked) {
      throw new HTTPException(412, {
        message:
          "no active Telegram account available — connect one in /outreach/accounts/new",
      });
    }
    const tdClient = picked.client;

    type TdChat = {
      id: number;
      title: string;
      type: { _: string; supergroup_id?: number; is_channel?: boolean };
      photo?: { minithumbnail?: { data: string } };
    };
    type TdSupergroupFullInfo = {
      description: string;
      member_count: number;
      linked_chat_id: number;
      direct_messages_chat_id: number;
      gift_count: number;
      outgoing_paid_message_star_count: number;
      photo?: { minithumbnail?: { data: string } };
    };

    // searchPublicChat — единственный способ зарегистрировать публичный чат
    // в TDLib-state без подписки. Только после него getSupergroupFullInfo
    // и getChatHistory получают chat (см. td_api.tl §searchPublicChat,
    // §getChat — offline-only). getChat(externalId) — fallback для каналов
    // без @username; в холодной сессии скорее всего тоже упадёт, но другого
    // выхода нет.
    let tdChat: TdChat;
    try {
      tdChat = channel.username
        ? ((await tdClient.invoke({
            _: "searchPublicChat",
            username: channel.username,
          } as never)) as TdChat)
        : ((await tdClient.invoke({
            _: "getChat",
            chat_id: Number(channel.externalId),
          } as never)) as TdChat);
    } catch (e) {
      const cls = classifyResolveError(e);
      if (cls.permanent) await markChannelUnavailable(id, cls.reason);
      throw new HTTPException(404, {
        message: `Telegram lookup failed: ${errMsg(e)}`,
      });
    }

    if (tdChat.type._ !== "chatTypeSupergroup" || !tdChat.type.supergroup_id) {
      throw new HTTPException(400, {
        message: `chat ${tdChat.id} is not a supergroup (got ${tdChat.type._})`,
      });
    }

    const supergroupId = tdChat.type.supergroup_id;
    // Race-fix: searchPublicChat выше эмитит updateSupergroup, replicator
    // handler кладёт patch в channelMetaBuf и взводит flush на 500ms.
    // Если getSupergroupFullInfo (~200-1000ms RPC) затянется и flush
    // выстрелит до финального UPDATE — flush не найдёт row по
    // meta->>'supergroup_id' и patch потеряется до следующего sync.
    // Кладём supergroup_id в meta заранее, чтобы flush точно попал.
    await db
      .update(channels)
      .set({
        meta: sql`${channels.meta} || ${JSON.stringify({ supergroup_id: String(supergroupId) })}::jsonb`,
      })
      .where(eq(channels.id, id));

    // getSupergroup НЕ вызываем — его поля (boost_level, verification, has_dm,
    // is_channel, …) прилетают как updateSupergroup и пишутся в meta фоновым
    // handler'ом в tg-replicator.ts. FullInfo же без явного invoke'а update'ом
    // не приходит (cached for up to 1 minute, см. td_api.tl §getSupergroupFullInfo).
    let tdFull: TdSupergroupFullInfo;
    try {
      tdFull = (await tdClient.invoke({
        _: "getSupergroupFullInfo",
        supergroup_id: supergroupId,
      } as never)) as TdSupergroupFullInfo;
    } catch (e) {
      const cls = classifyResolveError(e);
      if (cls.permanent) await markChannelUnavailable(id, cls.reason);
      throw new HTTPException(404, {
        message: `Telegram lookup failed: ${errMsg(e)}`,
      });
    }

    // Только свои поля; nice-to-have от updateSupergroup доедут merge'ем.
    const metaPatch: Record<string, unknown> = {
      supergroup_id: String(supergroupId),
      linked_chat_id: tdFull.linked_chat_id || null,
      direct_messages_chat_id: tdFull.direct_messages_chat_id || null,
      gift_count: tdFull.gift_count,
      outgoing_paid_message_star_count: tdFull.outgoing_paid_message_star_count,
    };

    const description = tdFull.description || null;
    const externalIdNew = String(tdChat.id);

    // Thumbnail: chat.photo.minithumbnail.data приходит как base64-строка
    // (TDLib bytes-поля в JSON — base64). Если у канала нет аватара — поле
    // photo отсутствует, прежний кеш не сносим.
    const minithumb =
      tdChat.photo?.minithumbnail?.data ?? tdFull.photo?.minithumbnail?.data;
    const [[updated]] = await Promise.all([
      db
        .update(channels)
        .set({
          externalId: externalIdNew,
          title: tdChat.title || channel.title,
          description,
          memberCount: tdFull.member_count,
          meta: sql`${channels.meta} || ${JSON.stringify(metaPatch)}::jsonb`,
          syncedAt: new Date(),
          updatedAt: new Date(),
          unavailableSince: null,
          unavailableLastCheckAt: null,
          unavailableReason: null,
        })
        .where(eq(channels.id, id))
        .returning(),
      minithumb
        ? db
            .insert(channelThumbnails)
            .values({ channelId: id, b64: minithumb })
            .onConflictDoUpdate({
              target: channelThumbnails.channelId,
              set: { b64: minithumb, updatedAt: new Date() },
            })
        : Promise.resolve(),
    ]);
    const [serialized] = await joinAdmins([updated!]);
    return c.json(serialized!);
  },
);

// Подписать аккаунт workspace'a на канал. Публичный канал (есть @) идёт
// через joinChat(chat_id); приватный (только invite-link типа t.me/+abc)
// — через joinChatByInviteLink. Read history после подписки идёт через
// этот аккаунт (см. GET /channels/{id}/history). Команда видит подписки
// друг друга — один подписанный = читают все.
//
// `INVITE_REQUEST_SENT` (закрытый канал, нужно подтверждение админа) →
// сохраняем status=pending, read через такой аккаунт ещё не работает.
const SubscribeBody = z.object({ accountId: z.string().min(1).max(64) });

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/subscribe",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      body: {
        content: { "application/json": { schema: SubscribeBody } },
        required: true,
      },
    },
    responses: { 204: { description: "Subscribed (or pending approval)" } },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { accountId } = c.req.valid("json");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);
    if (channel.platform !== "telegram") {
      throw new HTTPException(400, {
        message: "subscribe supported only for platform=telegram",
      });
    }
    // Право подписки = право write через аккаунт. Member может подписать
    // только свои аккаунты, admin — любой в workspace'е.
    const [acc] = await db
      .select({ id: outreachAccounts.id })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.id, accountId),
          accountAccessClause(wsId, userId, role),
          eq(outreachAccounts.status, "active"),
        ),
      )
      .limit(1);
    if (!acc) {
      throw new HTTPException(404, { message: "account not found" });
    }
    const client = await getOutreachWorkerClient({ id: acc.id, workspaceId: wsId });
    if (!client) {
      throw new HTTPException(503, { message: "tg client unavailable" });
    }

    // Резолв chat_id перед joinChat. Для импортированных каналов externalId
    // может быть null (CSV без явного chat_id) — в этом случае идём через
    // searchPublicChat (public) или joinChatByInviteLink (private, который
    // сам возвращает Chat с id). После резолва сохраняем externalId — без
    // этого getChatHistory упадёт на NaN.
    let resolvedChatId: number | null = channel.externalId
      ? Number(channel.externalId)
      : null;
    let status: "subscribed" | "pending" = "subscribed";
    try {
      if (channel.username && !resolvedChatId) {
        const tdChat = (await client.invoke({
          _: "searchPublicChat",
          username: channel.username,
        } as never)) as { id: number };
        resolvedChatId = tdChat.id;
      }
      if (resolvedChatId) {
        await client.invoke({
          _: "joinChat",
          chat_id: resolvedChatId,
        } as never);
      } else if (channel.link) {
        const tdChat = (await client.invoke({
          _: "joinChatByInviteLink",
          invite_link: channel.link,
        } as never)) as { id: number };
        resolvedChatId = tdChat.id;
      } else {
        throw new HTTPException(400, {
          message: "channel has neither @username nor invite link",
        });
      }
    } catch (e) {
      const msg = errMsg(e);
      // TDLib возвращает специальное сообщение когда канал требует одобрения
      // (см. td_api.tl §joinChat: «May return an error with a message
      // INVITE_REQUEST_SENT if only a join request was created»).
      if (msg.includes("INVITE_REQUEST_SENT")) {
        status = "pending";
      } else {
        throw new HTTPException(400, { message: msg });
      }
    }

    if (resolvedChatId && !channel.externalId) {
      await db
        .update(channels)
        .set({ externalId: String(resolvedChatId) })
        .where(eq(channels.id, id));
    }

    await db
      .insert(channelSubscriptions)
      .values({ accountId, channelId: id, status })
      .onConflictDoUpdate({
        target: [channelSubscriptions.accountId, channelSubscriptions.channelId],
        set: { status, subscribedAt: new Date() },
      });

    return c.body(null, 204);
  },
);

// Отписать аккаунт. Если других подписанных нет — приватный канал станет
// недоступен для read'a команды. UX-предупреждение делается на фронте.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/channels/{id}/unsubscribe",
    tags: ["channels"],
    request: {
      params: WsIdParam,
      body: {
        content: { "application/json": { schema: SubscribeBody } },
        required: true,
      },
    },
    responses: { 204: { description: "Unsubscribed" } },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { accountId } = c.req.valid("json");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);
    const [acc] = await db
      .select({ id: outreachAccounts.id })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.id, accountId),
          accountAccessClause(wsId, userId, role),
        ),
      )
      .limit(1);
    if (!acc) {
      throw new HTTPException(404, { message: "account not found" });
    }
    const client = await getOutreachWorkerClient({ id: acc.id, workspaceId: wsId });
    if (client && channel.externalId) {
      try {
        await client.invoke({
          _: "leaveChat",
          chat_id: Number(channel.externalId),
        } as never);
      } catch (e) {
        // Если уже не подписан в TG — продолжаем чистить нашу запись.
        console.error(`[channels/unsubscribe] leaveChat:`, errMsg(e));
      }
    }
    await db
      .delete(channelSubscriptions)
      .where(
        and(
          eq(channelSubscriptions.accountId, accountId),
          eq(channelSubscriptions.channelId, id),
        ),
      );

    return c.body(null, 204);
  },
);

// PATCH /channels/{id} — редактирование «наших» полей. На MVP только
// username: типичный кейс — админ переименовал канал, мы поправили @ и
// заново резолвим. На смене username сбрасываем unavailable_*-флаги, чтобы
// next sync не упёрся в cooldown (новый @ — это логически уже другой чат).
const PatchChannelSchema = z.object({
  username: z.string().min(1).max(64).nullable().optional(),
});

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/channels/{id}",
    tags: ["channels"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsIdParam,
      body: {
        content: { "application/json": { schema: PatchChannelSchema } },
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ChannelSchema } },
        description: "Channel updated",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const channel = await assertChannelAccess(id, wsId);
    const body = c.req.valid("json");

    // Юзер может ввести «@channelname» или «channelname» — нормализуем.
    let nextUsername = channel.username;
    if (body.username !== undefined) {
      nextUsername = body.username
        ? body.username.replace(/^@/, "").trim() || null
        : null;
    }
    const usernameChanged = nextUsername !== channel.username;

    const [updated] = await db
      .update(channels)
      .set({
        username: nextUsername,
        updatedAt: new Date(),
        // Username сменился — сбрасываем флаг недоступности и forced
        // повторный resolve. Делаем здесь, не в frontend, чтобы инвариант
        // «новый @ = новый канал к проверке» не зависел от UI.
        ...(usernameChanged
          ? {
              unavailableSince: null,
              unavailableLastCheckAt: null,
              unavailableReason: null,
              syncedAt: null,
            }
          : {}),
      })
      .where(eq(channels.id, id))
      .returning();
    const [serialized] = await joinAdmins([updated!]);
    return c.json(serialized!);
  },
);

// История канала: последние N сообщений (plain-text), через personal-TDLib.
// Не-текст (фото/видео/forward) → "[медиа]"; этого достаточно для оценки
// активности канала, full-render медиа — отдельная задача.
//
// Pagination: from_message_id=0 на первой странице (TDLib возвращает с
// last сообщения). На дальнейших передаём id последнего полученного.
const ChannelHistoryQuery = z.object({
  fromMessageId: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const ChannelHistoryReaction = z.object({
  emoji: z.string(),
  count: z.number().int().nonnegative(),
});
const ChannelHistoryItem = z.object({
  id: z.string(),
  date: z.iso.datetime(),
  text: z.string(),
  entities: z.array(TdMessageEntitySchema),
  mediaThumb: TdMediaThumbSchema.nullable(),
  // messageInteractionInfo (td_api.tl:2730). У постов в каналах view_count
  // почти всегда есть; forward_count и replies — опционально (репост только
  // если кто-то форварднул, replies — только если у канала есть linked-чат).
  views: z.number().int().nonnegative().nullable(),
  forwards: z.number().int().nonnegative().nullable(),
  replies: z.number().int().nonnegative().nullable(),
  // Только реакции на стандартные emoji. Custom-emoji (premium) и paid-reactions
  // скипаем — без download custom-emoji не отрендерим, они станут '?'.
  reactions: z.array(ChannelHistoryReaction),
  isForwarded: z.boolean(),
});
const ChannelHistoryResponse = z.object({
  messages: z.array(ChannelHistoryItem),
});

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/channels/{id}/history",
    tags: ["channels"],
    request: { params: WsIdParam, query: ChannelHistoryQuery },
    responses: {
      200: {
        content: {
          "application/json": { schema: ChannelHistoryResponse },
        },
        description: "Last N messages of the channel (plain-text)",
      },
    },
  }),
  async (c) => {
    const { wsId, id } = c.req.valid("param");
    const { fromMessageId, limit } = c.req.valid("query");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const channel = await assertChannelAccess(id, wsId);

    if (channel.platform !== "telegram") {
      throw new HTTPException(400, {
        message: "history supported only for platform=telegram",
      });
    }
    if (!channel.externalId) {
      throw new HTTPException(412, {
        message:
          "channel not synced yet — POST /sync first (resolves chat_id from username)",
      });
    }
    if (isInUnavailableCooldown(channel)) {
      throw new HTTPException(410, {
        message: channel.unavailableReason ?? "channel unavailable",
      });
    }

    // Приватный канал (нет @username) можно прочитать только подписанным
    // аккаунтом — TDLib без подписки отдаст «Chat not found». Явный 412
    // с маркером, чтобы фронт показал плашку «Подписаться».
    if (!channel.username) {
      const [anySub] = await db
        .select({ accountId: channelSubscriptions.accountId })
        .from(channelSubscriptions)
        .innerJoin(
          outreachAccounts,
          eq(outreachAccounts.id, channelSubscriptions.accountId),
        )
        .where(
          and(
            eq(channelSubscriptions.channelId, id),
            eq(channelSubscriptions.status, "subscribed"),
            eq(outreachAccounts.workspaceId, wsId),
            eq(outreachAccounts.status, "active"),
          ),
        )
        .limit(1);
      if (!anySub) {
        throw new HTTPException(412, {
          message: "subscription required to read private channel",
        });
      }
    }

    const picked = await pickChannelReader(id, wsId, userId, role);
    if (!picked) {
      throw new HTTPException(412, {
        message:
          "no active Telegram account available — connect one in /outreach/accounts/new",
      });
    }
    const tdClient = picked.client;

    type TdReaction = {
      type: { _: string; emoji?: string };
      total_count: number;
    };
    type TdMessage = {
      id: number;
      date: number;
      content: TdContent;
      interaction_info?: {
        view_count?: number;
        forward_count?: number;
        reply_info?: { reply_count: number };
        reactions?: { reactions: TdReaction[] };
      };
      forward_info?: { origin: { _: string }; date: number };
    };
    type TdMessages = { messages: TdMessage[] };

    const chatId = Number(channel.externalId);

    // Прогрев state'а на каждый запрос: searchPublicChat кладёт чат в TDLib
    // memory state (см. td_api.tl §searchPublicChat — гарантирует updateNewChat
    // до возврата). Без него getChatHistory упадёт «Chat not found» в холодной
    // сессии (после рестарта api). Если username нет — пропускаем, надеемся
    // что чат уже зарегистрирован (например через подписку юзера).
    if (channel.username) {
      try {
        await tdClient.invoke({
          _: "searchPublicChat",
          username: channel.username,
        } as never);
      } catch (e) {
        const cls = classifyResolveError(e);
        if (cls.permanent) await markChannelUnavailable(id, cls.reason);
        throw new HTTPException(404, {
          message: `Telegram lookup failed: ${errMsg(e)}`,
        });
      }
    }

    // openChat → backfill-loop getChatHistory → closeChat. Без openChat
    // TDLib не считает чат активным; в supergroup'ах/каналах «all updates
    // are received only for opened chats» (td_api.tl §openChat) и
    // сервер-fetch менее агрессивный. closeChat — best-effort в finally,
    // только если openChat успел: иначе TDLib ответит «Chat not found» и
    // спамит лог (счётчик opened-chats и так не рос).
    //
    // Каналы холодные (юзер не подписан → RAM-кэш TDLib пустой), и первый
    // getChatHistory часто возвращает 1-2 сообщения — TDLib инициирует
    // фоновый fetch и возвращает что успел (td_api.tl §getChatHistory: «can
    // be smaller than the specified limit»). Дозваниваемся пагинацией по
    // from_message_id=oldest_id пока не наберём limit или TDLib не отдаст
    // empty (конец канала). MAX_ATTEMPTS — защита от бесконечного цикла.
    const fetchHistory = (from: number, want: number) =>
      tdClient.invoke({
        _: "getChatHistory",
        chat_id: chatId,
        from_message_id: from,
        offset: 0,
        limit: want,
        only_local: false,
      } as never) as Promise<TdMessages>;

    const MAX_ATTEMPTS = 5;
    let aggregated: TdMessage[] = [];
    let from = fromMessageId ?? 0;
    let opened = false;
    try {
      await tdClient.invoke({ _: "openChat", chat_id: chatId } as never);
      opened = true;
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        const r = await fetchHistory(from, limit - aggregated.length);
        if (r.messages.length === 0) break;
        aggregated = [...aggregated, ...r.messages];
        if (aggregated.length >= limit) break;
        from = Number(r.messages[r.messages.length - 1]!.id);
      }
    } catch (e) {
      const cls = classifyResolveError(e);
      if (cls.permanent) await markChannelUnavailable(id, cls.reason);
      throw new HTTPException(404, {
        message: `history fetch failed: ${errMsg(e)}`,
      });
    } finally {
      if (opened) {
        await tdClient
          .invoke({ _: "closeChat", chat_id: chatId } as never)
          .catch((e: unknown) =>
            console.error(`[channels/history] closeChat ${chatId} failed:`, e),
          );
      }
    }
    const result: TdMessages = { messages: aggregated };

    // Дошли сюда — TDLib отдал историю, канал точно доступен. Сбрасываем
    // unavailable-флаг, если ранее был выставлен (например, прошлый sync
    // упал, юзер переподключил аккаунт, теперь чат резолвится).
    if (channel.unavailableSince) {
      await clearChannelUnavailable(id);
    }

    const items = (result.messages ?? []).map((m) => {
      const { text, entities } = extractFormattedText(m.content);
      const mediaThumb = extractMediaThumb(m.content);
      const ii = m.interaction_info;
      const reactions = (ii?.reactions?.reactions ?? [])
        .filter((r) => r.type._ === "reactionTypeEmoji" && r.type.emoji)
        .map((r) => ({ emoji: r.type.emoji!, count: r.total_count }));
      return {
        id: String(m.id),
        date: new Date(m.date * 1000).toISOString(),
        // Без текста и без thumb (стикер/voice/etc) — короткий type-label.
        text: text || (mediaThumb ? "" : "[медиа]"),
        entities,
        mediaThumb,
        views: ii?.view_count ?? null,
        forwards: ii?.forward_count ?? null,
        replies: ii?.reply_info?.reply_count ?? null,
        reactions,
        isForwarded: !!m.forward_info,
      };
    });

    return c.json({ messages: items });
  },
);

// CSV-импорт каналов с column-mapping. Body: {rows, mapping, platform}.
// Юзер на фронте маппит колонки в ImportWizard, бэк применяет.
//
// Правило приоритета: соцсетевой pull всегда побеждает.
//   - synced_at IS NULL → CSV пишет всё (типизированные поля + properties)
//   - synced_at IS NOT NULL → CSV пишет только properties; типизированные
//     поля остаются от соцсети
// admin_username и properties всегда обновляются — соцсеть их не отдаёт.
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
    const { rows, mapping, platform } = c.req.valid("json");

    // Step 1: применяем mapping к каждой строке CSV → нормализованный staging.
    // Дедуп внутри батча: ключ = external_id (если есть), иначе lower(username).
    type Staged = {
      title: string;
      externalId: string | null;
      username: string | null;
      link: string | null;
      memberCount: number | null;
      description: string | null;
      // lower-case без `@`, для smart-stub резолва.
      adminUsername: string | null;
      properties: Record<string, string>;
    };
    const stagedByKey = new Map<string, Staged>();
    let skippedNoIdentifier = 0;
    const propsMap = mapping.properties ?? {};

    const pickStr = (r: Record<string, string>, h: string | undefined) =>
      h ? r[h]?.trim() || null : null;
    const stagedKey = (s: { externalId: string | null; username: string | null }) =>
      s.externalId ? `eid:${s.externalId}` : `un:${s.username!.toLowerCase()}`;

    for (const r of rows) {
      const externalId = pickStr(r, mapping.externalId);
      const usernameRaw = pickStr(r, mapping.username);
      const username = usernameRaw ? usernameRaw.replace(/^@/, "") : null;
      if (!externalId && !username) {
        skippedNoIdentifier++;
        continue;
      }
      const key = stagedKey({ externalId, username });

      // CSV редко даёт явный link, но для публичного TG-канала он
      // тривиально дерайвится из username. CSV-link имеет приоритет.
      const linkFromCsv = pickStr(r, mapping.link);
      const link =
        linkFromCsv || (username && platform === "telegram" ? `https://t.me/${username}` : null);
      const description = pickStr(r, mapping.description);
      const memCntRaw = pickStr(r, mapping.memberCount);
      const memCntParsed = memCntRaw ? Number(memCntRaw.replace(/\s+/g, "")) : NaN;
      const memberCount = Number.isFinite(memCntParsed) ? memCntParsed : null;
      const adminRaw = pickStr(r, mapping.adminUsername);
      const adminUsername = adminRaw
        ? adminRaw.replace(/^@/, "").toLowerCase()
        : null;

      const properties: Record<string, string> = {};
      for (const [pkey, csvHeader] of Object.entries(propsMap)) {
        const v = r[csvHeader]?.trim();
        if (v) properties[pkey] = v;
      }

      // title без явного маппинга — fallback на @username или externalId,
      // чтобы NOT NULL constraint не падал.
      const titleFromCsv = pickStr(r, mapping.title);
      const title =
        titleFromCsv || (username ? `@${username}` : `id:${externalId}`);

      const existing = stagedByKey.get(key);
      if (existing) {
        // Несколько CSV-строк на тот же канал → склеиваем, ранняя строка
        // приоритетнее по непустым полям, properties мержатся.
        stagedByKey.set(key, {
          title: existing.title || title,
          externalId: existing.externalId || externalId,
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
          externalId,
          username,
          link,
          memberCount,
          description,
          adminUsername,
          properties,
        });
      }
    }

    // Step 2: lookup существующих каналов по external_id ИЛИ lower(username).
    const stagedList = [...stagedByKey.values()];
    const externalIds = stagedList
      .map((s) => s.externalId)
      .filter((x): x is string => !!x);
    const usernamesLower = stagedList
      .map((s) => s.username?.toLowerCase())
      .filter((x): x is string => !!x);

    const existingChannels =
      externalIds.length || usernamesLower.length
        ? await db
            .select({
              id: channels.id,
              externalId: channels.externalId,
              usernameLower: sql<string | null>`lower(${channels.username})`,
              syncedAt: channels.syncedAt,
              properties: channels.properties,
            })
            .from(channels)
            .where(
              and(
                eq(channels.workspaceId, wsId),
                eq(channels.platform, platform),
                or(
                  externalIds.length
                    ? inArray(channels.externalId, externalIds)
                    : undefined,
                  usernamesLower.length
                    ? inArray(
                        sql`lower(${channels.username})`,
                        usernamesLower,
                      )
                    : undefined,
                ),
              ),
            )
        : [];

    const byExtId = new Map<
      string,
      (typeof existingChannels)[number]
    >();
    const byUsernameLower = new Map<
      string,
      (typeof existingChannels)[number]
    >();
    for (const e of existingChannels) {
      if (e.externalId) byExtId.set(e.externalId, e);
      if (e.usernameLower) byUsernameLower.set(e.usernameLower, e);
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
      const exMatch =
        (staged.externalId && byExtId.get(staged.externalId)) ||
        (staged.username &&
          byUsernameLower.get(staged.username.toLowerCase())) ||
        null;
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
    const idByKey = new Map<string, string>();
    if (toInsert.length > 0) {
      const allRows = toInsert.map((t) => ({
        workspaceId: wsId,
        platform,
        externalId: t.externalId,
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
            externalId: channels.externalId,
            usernameLower: sql<string | null>`lower(${channels.username})`,
          });
        for (const ins of inserted) {
          if (ins.externalId) idByKey.set(`eid:${ins.externalId}`, ins.id);
          if (ins.usernameLower) idByKey.set(`un:${ins.usernameLower}`, ins.id);
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
      const externals = toUpdateFull.map((u) => u.externalId);
      const usernames = toUpdateFull.map((u) => u.username);
      const links = toUpdateFull.map((u) => u.link);
      const members = toUpdateFull.map((u) => u.memberCount);
      const descs = toUpdateFull.map((u) => u.description);
      const propsJson = toUpdateFull.map((u) => JSON.stringify(u.mergedProps));
      await sqlClient`
        UPDATE channels c SET
          title = u.title,
          external_id = COALESCE(u.external_id, c.external_id),
          username = COALESCE(u.username, c.username),
          link = COALESCE(u.link, c.link),
          member_count = COALESCE(u.member_count, c.member_count),
          description = COALESCE(u.description, c.description),
          properties = u.properties::jsonb,
          updated_at = now()
        FROM unnest(
          ${ids}::text[],
          ${titles}::text[],
          ${externals}::text[],
          ${usernames}::text[],
          ${links}::text[],
          ${members}::integer[],
          ${descs}::text[],
          ${propsJson}::text[]
        ) AS u(id, title, external_id, username, link, member_count, description, properties)
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

    // Step 7: channel_admins. Связи для всех staged-row'ов, где есть и
    // channelId, и contactId.
    const allChannelAdminLinks: { channelId: string; contactId: string }[] = [];
    for (const staged of stagedList) {
      if (!staged.adminUsername) continue;
      const channelId = idByKey.get(stagedKey(staged));
      const contactId = usernameToContactId.get(staged.adminUsername);
      if (channelId && contactId) {
        allChannelAdminLinks.push({ channelId, contactId });
      }
    }
    if (allChannelAdminLinks.length > 0) {
      for (const chunk of chunks(allChannelAdminLinks, INSERT_CHUNK)) {
        await db.insert(channelAdmins).values(chunk).onConflictDoNothing();
      }
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

// Достраивает Channel объекты массивом admins (с минимальными полями для
// рендера колонки «админ» и «закреплён за») + thumbnail из отдельной
// таблицы (LEFT JOIN, может быть null если соц-pull ещё не делали).
async function joinAdmins(
  rows: (typeof channels.$inferSelect)[],
): Promise<Channel[]> {
  if (rows.length === 0) return [];
  const channelIds = rows.map((r) => r.id);
  const [adminRows, thumbRows] = await Promise.all([
    db
      .select({
        channelId: channelAdmins.channelId,
        contactId: contacts.id,
        properties: contacts.properties,
        primaryAccountId: contacts.primaryAccountId,
      })
      .from(channelAdmins)
      .innerJoin(contacts, eq(channelAdmins.contactId, contacts.id))
      .where(inArray(channelAdmins.channelId, channelIds)),
    db
      .select({
        channelId: channelThumbnails.channelId,
        b64: channelThumbnails.b64,
      })
      .from(channelThumbnails)
      .where(inArray(channelThumbnails.channelId, channelIds)),
  ]);
  const thumbByChannel = new Map(thumbRows.map((t) => [t.channelId, t.b64]));

  const byChannel = new Map<
    string,
    {
      contactId: string;
      fullName: string | null;
      telegramUsername: string | null;
      primaryAccountId: string | null;
    }[]
  >();
  for (const a of adminRows) {
    const props = a.properties as Record<string, unknown>;
    const list = byChannel.get(a.channelId) ?? [];
    list.push({
      contactId: a.contactId,
      fullName:
        typeof props.full_name === "string" ? props.full_name : null,
      telegramUsername:
        typeof props.telegram_username === "string"
          ? props.telegram_username
          : null,
      primaryAccountId: a.primaryAccountId,
    });
    byChannel.set(a.channelId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    platform: r.platform,
    externalId: r.externalId,
    title: r.title,
    description: r.description,
    username: r.username,
    link: r.link,
    memberCount: r.memberCount,
    meta: r.meta,
    properties: r.properties,
    syncedAt: r.syncedAt?.toISOString() ?? null,
    lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
    unavailableSince: r.unavailableSince?.toISOString() ?? null,
    unavailableLastCheckAt: r.unavailableLastCheckAt?.toISOString() ?? null,
    unavailableReason: r.unavailableReason ?? null,
    thumbnailB64: thumbByChannel.get(r.id) ?? null,
    admins: byChannel.get(r.id) ?? [],
    createdBy: r.createdBy,
    createdAt: r.createdAt.toISOString(),
  }));
}

export default app;
