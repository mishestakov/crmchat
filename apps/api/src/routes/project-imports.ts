import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  channelAdmins,
  channels,
  contacts,
  projectImports,
  projectItems,
  projects,
  scheduledMessages,
  type ProjectStage,
} from "../db/schema.ts";
import {
  contactTgUserIdSql,
  contactUsernameLowerSql,
} from "../lib/contact-sql.ts";
import {
  loadPropertyDefs,
  validateContactProperties,
} from "../lib/contact-properties.ts";
import { parseChannelInput } from "@repo/core";
import { assertProjectAccess } from "../lib/projects-access.ts";
import {
  buildScheduledRows,
  fillStickyFromScheduledMessages,
  resolveProjectAccountIds,
  resolveStickyByTgUserIds,
  resolveWarmTgUserIds,
} from "../lib/project-scheduling.ts";
import { assertRole, type WorkspaceVars } from "../middleware/assert-member.ts";

// CSV-импорт лидов в существующий проект. Заменяет старый
// `/outreach/lists` flow: раньше лист создавался отдельно и под него
// сразу sequence; теперь лист — это просто batch импорта в уже
// существующий проект (project_imports). Проект может иметь много batch'ей
// (этап 12.5 «доливка лидов»).

const TG_USERNAME_RE = /^[a-zA-Z0-9_]{5,32}$/;

const WsProjectParam = z.object({
  wsId: z.string().min(1).max(64),
  projectId: z.string().min(1).max(64),
});

const ImportSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    sourceMeta: z.object({
      fileName: z.string().optional(),
      usernameColumn: z.string().optional(),
      channelUsernameColumn: z.string().optional(),
      columns: z.array(z.string()).optional(),
      propertyMappings: z.record(z.string(), z.string()).optional(),
    }),
    importStats: z
      .object({
        imported: z.number().int(),
        skippedMissingIdentifier: z.number().int(),
        skippedDuplicate: z.number().int(),
        recognized: z.number().int().optional(),
      })
      .nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("ProjectImport");

const CreateImportBody = z
  .object({
    name: z.string().min(1).max(200),
    sourceMeta: z.object({
      fileName: z.string().optional(),
      usernameColumn: z.string().optional(),
      channelUsernameColumn: z.string().optional(),
      columns: z.array(z.string()).optional(),
      propertyMappings: z.record(z.string(), z.string()).optional(),
    }),
    rows: z.array(z.record(z.string(), z.string())).max(50000),
  })
  .openapi("CreateProjectImport");

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/imports",
    tags: ["projects"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(ImportSchema) } },
        description: "Imports history for project",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    await assertProjectAccess(projectId, wsId, userId, role);
    const rows = await db
      .select()
      .from(projectImports)
      .where(eq(projectImports.projectId, projectId))
      .orderBy(asc(projectImports.createdAt));
    return c.json(rows.map(serialize));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/imports",
    tags: ["projects"],
    middleware: [assertRole("admin")] as const,
    request: {
      params: WsProjectParam,
      body: {
        content: { "application/json": { schema: CreateImportBody } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: ImportSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);

    // A2: в done-проект лить нельзя — цепочка уже отыграна.
    if (project.status === "done") {
      throw new HTTPException(400, {
        message: "Cannot import into completed project",
      });
    }

    const body = c.req.valid("json");
    const {
      usernameColumn,
      channelUsernameColumn,
      propertyMappings = {},
    } = body.sourceMeta;

    const seen = new Set<string>();
    const stats = {
      imported: 0,
      skippedMissingIdentifier: 0,
      skippedDuplicate: 0,
    };
    const candidates: {
      username: string;
      properties: Record<string, string>;
      // Канал, на который ведёт лид. Извлекается из CSV-колонки
      // body.sourceMeta.channelUsernameColumn парсером parseChannelInput
      // (понимает @foo / t.me/foo / t.me/+abc и т.д.). Один из двух слотов:
      // channelUsername — публичный канал, channelInviteLink — приватный.
      // Используется после транзакции для upsert'а каналов и
      // channel_admins-связок с контактом лида.
      channelUsername: string | null;
      channelInviteLink: string | null;
    }[] = [];

    for (const row of body.rows) {
      // TG username case-insensitive: "Mike1936"/"mike1936"/"@Mike1936" —
      // один и тот же юзер, нормализуем к lowercase для dedup.
      const usernameRaw =
        usernameColumn && row[usernameColumn]
          ? row[usernameColumn]!.trim().replace(/^@/, "").toLowerCase()
          : "";

      const username = usernameRaw && TG_USERNAME_RE.test(usernameRaw)
        ? usernameRaw
        : null;

      // Лид без @username бесполезен для outreach: ни через searchPublicChat
      // не найдём, ни через deep-link в TG-клиенте не откроем.
      if (!username) {
        stats.skippedMissingIdentifier++;
        continue;
      }

      // Dedup по username (case-insensitive). Один и тот же @ в разных
      // регистрах — одна строка.
      const dedupKey = `u:${username}`;
      if (seen.has(dedupKey)) {
        stats.skippedDuplicate++;
        continue;
      }
      seen.add(dedupKey);

      // properties: смапленные на CRM-property keys + остальные CSV-колонки
      // под raw header (для {{}}-подстановок). Username уже использован
      // как identifier — не дублируем.
      const properties: Record<string, string> = {};
      const consumed = new Set<string>();
      if (usernameColumn) consumed.add(usernameColumn);
      for (const [propKey, csvCol] of Object.entries(propertyMappings)) {
        const v = row[csvCol]?.trim();
        if (v) {
          properties[propKey] = v;
          consumed.add(csvCol);
        }
      }
      for (const [k, v] of Object.entries(row)) {
        if (consumed.has(k)) continue;
        if (v && v.trim()) properties[k] = v.trim();
      }

      // Канал лида — парсим из CSV-колонки. Парсер понимает голый username,
      // ссылку t.me/foo, invite-link t.me/+abc. Не распознанное молчаливо
      // отбрасываем (вспомогательное обогащение, не identifier лида).
      let channelUsername: string | null = null;
      let channelInviteLink: string | null = null;
      if (channelUsernameColumn) {
        const parsed = parseChannelInput(row[channelUsernameColumn]);
        channelUsername = parsed.username;
        channelInviteLink = parsed.inviteLink;
      }

      candidates.push({
        username,
        properties,
        channelUsername,
        channelInviteLink,
      });
    }

    // Eager-конверсия: лид всегда указывает на contact. Сейчас ищем
    // существующие контакты по @username (lower), для незнакомых создаём
    // stub-контакты (без tg_user_id — он подтянется через
    // ensureContactTgUserId при первом открытии drawer'а или send'е).
    // Stub'ы получают contactDefaults и owner round-robin проекта.
    const usernames = candidates.map((c) => c.username);

    const known =
      usernames.length > 0
        ? await db
            .select({
              id: contacts.id,
              tgUserId: contactTgUserIdSql,
              username: contactUsernameLowerSql,
            })
            .from(contacts)
            .where(
              and(
                eq(contacts.workspaceId, wsId),
                inArray(contactUsernameLowerSql, usernames),
              ),
            )
        : [];
    const contactByUsername = new Map<
      string,
      { id: string; tgUserId: string | null }
    >();
    for (const k of known) {
      if (k.username) {
        contactByUsername.set(k.username, { id: k.id, tgUserId: k.tgUserId });
      }
    }
    const recognized = [...contactByUsername.values()].filter(
      (c) => c.tgUserId !== null,
    ).length;

    const missingUsernames = candidates
      .filter((c) => !contactByUsername.has(c.username))
      .map((c) => c.username);

    if (missingUsernames.length > 0) {
      const defs = await loadPropertyDefs(wsId);
      const allKeys = new Set(defs.map((d) => d.key));
      const projectDefaults =
        (project.contactDefaults as Record<string, unknown>) ?? {};
      const ownerIds = project.contactDefaultOwnerIds as string[];
      const rrStart = project.contactOwnerRoundRobin;
      const projectCreatedBy = project.createdBy;

      const stubRows = missingUsernames.map((username, idx) => {
        const props: Record<string, unknown> = { telegram_username: username };
        if (allKeys.has("full_name")) props.full_name = `@${username}`;
        for (const [k, v] of Object.entries(projectDefaults)) {
          if (props[k] === undefined && allKeys.has(k)) props[k] = v;
        }
        if (ownerIds.length > 0 && allKeys.has("owner_id")) {
          props.owner_id = ownerIds[(rrStart + idx) % ownerIds.length];
        }
        return {
          workspaceId: wsId,
          properties: validateContactProperties(defs, props),
          createdBy: projectCreatedBy,
        };
      });

      // ON CONFLICT по партиальному unique (workspace, lower(@username)) — если
      // параллельный импорт уже вставил тот же @, проглатываем и подтянем
      // contactId через re-fetch ниже.
      const inserted = await db
        .insert(contacts)
        .values(stubRows)
        .onConflictDoNothing()
        .returning({
          id: contacts.id,
          username: contactUsernameLowerSql,
          tgUserId: contactTgUserIdSql,
        });
      for (const s of inserted) {
        if (s.username) {
          contactByUsername.set(s.username, {
            id: s.id,
            tgUserId: s.tgUserId,
          });
        }
      }
      const stillMissing = missingUsernames.filter(
        (u) => !contactByUsername.has(u),
      );
      if (stillMissing.length > 0) {
        const refetched = await db
          .select({
            id: contacts.id,
            tgUserId: contactTgUserIdSql,
            username: contactUsernameLowerSql,
          })
          .from(contacts)
          .where(
            and(
              eq(contacts.workspaceId, wsId),
              inArray(contactUsernameLowerSql, stillMissing),
            ),
          );
        for (const r of refetched) {
          if (r.username) {
            contactByUsername.set(r.username, {
              id: r.id,
              tgUserId: r.tgUserId,
            });
          }
        }
      }

      // Сдвигаем round-robin counter на число реально использованных слотов.
      if (ownerIds.length > 0 && stubRows.length > 0) {
        await db
          .update(projects)
          .set({
            contactOwnerRoundRobin: sql`${projects.contactOwnerRoundRobin} + ${stubRows.length}`,
          })
          .where(eq(projects.id, projectId));
      }
    }

    const resolved = candidates.map((c) => {
      const contact = contactByUsername.get(c.username)!;
      return {
        ...c,
        contactId: contact.id,
        tgUserId: contact.tgUserId,
      };
    });

    // INSERT batch'а импорта + лидов в одной транзакции. ON CONFLICT DO
    // NOTHING на partial unique индексе (project, lower(username)) —
    // закрывает дубли с предыдущих импортов в этот же проект (12.5
    // доливка). Считаем сколько реально вставили.
    // Дефолтная стадия для новых импортируемых лидов = первая stage
    // канбана проекта (по order). Если у проекта нет stages (теоретически
    // возможно если кто-то их все удалил) — лиды создаются с null
    // stage_id и UI покажет их в колонке «Без стадии».
    const projectStages = project.stages as ProjectStage[];
    const initialStageId =
      projectStages.length > 0
        ? [...projectStages].sort((a, b) => a.order - b.order)[0]!.id
        : null;

    // A1: для active/paused — сразу планируем scheduled_messages с offsets
    // от now(). В paused worker не отправит (фильтрует по project.status),
    // но row'ы лежат как pending → resume их подтянет. Для draft — ничего,
    // /activate подхватит все накопленные лиды единым проходом.
    const willSchedule =
      project.status === "active" || project.status === "paused";
    let accountIds: string[] = [];
    if (willSchedule) {
      accountIds = await resolveProjectAccountIds(wsId, project);
      if (accountIds.length === 0) {
        throw new HTTPException(400, {
          message: "No active outreach accounts available",
        });
      }
      if (project.messages.length === 0) {
        throw new HTTPException(400, {
          message: "Project has no messages",
        });
      }
    }

    const importRow = await db.transaction(async (tx) => {
      const [imp] = await tx
        .insert(projectImports)
        .values({
          workspaceId: wsId,
          projectId,
          name: body.name,
          sourceMeta: body.sourceMeta,
          createdBy: userId,
          // importStats заполним ниже после INSERT'а лидов.
        })
        .returning();
      if (!imp) throw new HTTPException(500, { message: "import insert failed" });

      const insertedLeads: (typeof projectItems.$inferSelect)[] = [];
      if (resolved.length > 0) {
        // Chunked insert: postgres-js биндит каждое значение как отдельный $N
        // (лимит ~65k параметров на query). 1000 строк × ~10 cols = 10k params.
        const CHUNK = 1000;
        const rows = resolved.map((c) => ({
          workspaceId: wsId,
          projectId,
          importId: imp.id,
          kind: "lead" as const,
          stageId: initialStageId,
          username: c.username,
          tgUserId: c.tgUserId,
          contactId: c.contactId,
          properties: c.properties,
        }));
        for (let i = 0; i < rows.length; i += CHUNK) {
          const inserted = await tx
            .insert(projectItems)
            .values(rows.slice(i, i + CHUNK))
            .onConflictDoNothing()
            .returning();
          insertedLeads.push(...inserted);
        }
      }
      const actuallyInserted = insertedLeads.length;

      // Планируем отправки для новых лидов. Sticky/warm считаются на этом
      // же tg_user_id наборе. offsets — от момента доливки.
      if (willSchedule && insertedLeads.length > 0) {
        const tgUserIds = insertedLeads
          .map((l) => l.tgUserId)
          .filter((x): x is string => x !== null);
        const priorByTgUserId = await resolveStickyByTgUserIds(wsId, tgUserIds);
        const remaining = tgUserIds.filter((id) => !priorByTgUserId.has(id));
        await fillStickyFromScheduledMessages(wsId, remaining, priorByTgUserId);
        const warmTgUserIds = await resolveWarmTgUserIds(wsId, tgUserIds);

        const scheduledRows = buildScheduledRows({
          wsId,
          project,
          accountIds,
          leads: insertedLeads.map((l) => ({
            id: l.id,
            username: l.username,
            tgUserId: l.tgUserId,
            properties: (l.properties ?? {}) as Record<string, unknown>,
          })),
          baseTime: new Date(),
          priorByTgUserId,
          warmTgUserIds,
        });
        const CHUNK = 1000;
        for (let i = 0; i < scheduledRows.length; i += CHUNK) {
          await tx
            .insert(scheduledMessages)
            .values(scheduledRows.slice(i, i + CHUNK));
        }
      }

      const finalStats = {
        ...stats,
        imported: actuallyInserted,
        skippedDuplicate: stats.skippedDuplicate + (resolved.length - actuallyInserted),
        recognized,
      };

      const [withStats] = await tx
        .update(projectImports)
        .set({ importStats: finalStats })
        .where(eq(projectImports.id, imp.id))
        .returning();
      return withStats!;
    });

    // === Bonus: каналы из CSV ===========================================
    // Если в маппинге указана колонка с адресом канала — заводим карточки
    // каналов в /channels и связываем их с контактами-админами через
    // channel_admins. Публичные (есть @username) и приватные (invite-link)
    // идут двумя ветками: у первых дедуп по lower(username) и sync догонит
    // title/member_count; у вторых дедуп по link внутри батча, между
    // импортами могут возникнуть дубли — лечатся отдельным sub-task'ом
    // через checkChatInviteLink. Падать импорт из-за этого не должен: лиды
    // уже закоммичены выше.
    if (channelUsernameColumn) {
      const adminsByUsername = new Map<string, Set<string>>();
      const adminsByInvite = new Map<string, Set<string>>();
      for (const r of resolved) {
        if (r.channelUsername) {
          const set = adminsByUsername.get(r.channelUsername) ?? new Set();
          set.add(r.contactId);
          adminsByUsername.set(r.channelUsername, set);
        } else if (r.channelInviteLink) {
          const set = adminsByInvite.get(r.channelInviteLink) ?? new Set();
          set.add(r.contactId);
          adminsByInvite.set(r.channelInviteLink, set);
        }
      }

      const channelIdByKey = new Map<string, string>();

      // Публичные. ON CONFLICT по partial unique (ws, platform,
      // lower(username)) — если канал уже в /channels, не трогаем.
      if (adminsByUsername.size > 0) {
        const uniqueUsernames = [...adminsByUsername.keys()];
        await db
          .insert(channels)
          .values(
            uniqueUsernames.map((u) => ({
              workspaceId: wsId,
              platform: "telegram" as const,
              username: u,
              title: `@${u}`,
              link: `https://t.me/${u}`,
              createdBy: userId,
            })),
          )
          .onConflictDoNothing();
        const existing = await db
          .select({
            id: channels.id,
            usernameLower: sql<string>`lower(${channels.username})`,
          })
          .from(channels)
          .where(
            and(
              eq(channels.workspaceId, wsId),
              eq(channels.platform, "telegram"),
              inArray(sql`lower(${channels.username})`, uniqueUsernames),
            ),
          );
        for (const e of existing) {
          channelIdByKey.set(`u:${e.usernameLower}`, e.id);
        }
      }

      // Приватные. Уникального индекса на link в БД нет: дедуп ТОЛЬКО
      // внутри батча (через Map по link). Между батчами/импортами дубли
      // возможны — закроется отдельным sub-task'ом через
      // checkChatInviteLink (резолв chat_id до Subscribe).
      // Сначала ищем существующие карточки с тем же link, чтобы не плодить
      // дубли при доливке того же CSV.
      if (adminsByInvite.size > 0) {
        const uniqueLinks = [...adminsByInvite.keys()];
        const existing = await db
          .select({ id: channels.id, link: channels.link })
          .from(channels)
          .where(
            and(
              eq(channels.workspaceId, wsId),
              eq(channels.platform, "telegram"),
              inArray(channels.link, uniqueLinks),
            ),
          );
        const existingLinks = new Set(existing.map((e) => e.link!));
        for (const e of existing) channelIdByKey.set(`i:${e.link!}`, e.id);
        const toInsert = uniqueLinks.filter((l) => !existingLinks.has(l));
        if (toInsert.length > 0) {
          const inserted = await db
            .insert(channels)
            .values(
              toInsert.map((link) => ({
                workspaceId: wsId,
                platform: "telegram" as const,
                username: null,
                title: "Приватный канал",
                link,
                createdBy: userId,
              })),
            )
            .returning({ id: channels.id, link: channels.link });
          for (const ins of inserted) channelIdByKey.set(`i:${ins.link!}`, ins.id);
        }
      }

      // INSERT channel_admins по парам (channelId, contactId). ON CONFLICT
      // DO NOTHING — связь уже могла существовать с предыдущих импортов.
      const adminRows: { channelId: string; contactId: string }[] = [];
      for (const [u, contactSet] of adminsByUsername) {
        const channelId = channelIdByKey.get(`u:${u}`);
        if (!channelId) continue;
        for (const cid of contactSet) adminRows.push({ channelId, contactId: cid });
      }
      for (const [l, contactSet] of adminsByInvite) {
        const channelId = channelIdByKey.get(`i:${l}`);
        if (!channelId) continue;
        for (const cid of contactSet) adminRows.push({ channelId, contactId: cid });
      }
      if (adminRows.length > 0) {
        await db
          .insert(channelAdmins)
          .values(adminRows)
          .onConflictDoNothing();
      }
    }

    return c.json(serialize(importRow), 201);
  },
);

function serialize(row: typeof projectImports.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    sourceMeta: row.sourceMeta,
    importStats: row.importStats,
    createdAt: row.createdAt.toISOString(),
  };
}

export default app;
