import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { and, asc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  channelAdmins,
  channels,
  contacts,
  DEFAULT_OUTREACH_STAGES,
  messageTemplates,
  outreachAccounts,
  outreachAccountsMode,
  projectItems,
  projects,
  projectPhase,
  stageTemplates,
  tracks,
  projectStatus,
  scheduledMessages,
  scheduledMessageStatus,
  type ProjectMessage,
  type ProjectStage,
} from "../db/schema.ts";
import { pickDefined } from "../lib/pick-defined.ts";
import { emitProjectChanged, subscribeProject } from "../lib/events.ts";
import { myAccountIdsSql } from "../lib/outreach-access.ts";
import {
  assertProjectAccess,
  projectAccessClause,
} from "../lib/projects-access.ts";
import {
  buildScheduledRows,
  prepareAgencyLeads,
  resolveProjectAccountIds,
  resolveStickyByTgUserIds,
  resolveWarmTgUserIds,
  type SchedulingLead,
} from "../lib/project-scheduling.ts";
import { type WorkspaceVars } from "../middleware/assert-member.ts";
import { nextStepSql } from "./contacts.ts";

// Outreach-проект: рассылка по одному списку с N сообщениями и задержками.
// Активация = pre-schedule всех scheduled_messages с round-robin аккаунтом и
// snapshot'ом текста после {{}}-подстановок. Worker (фаза 3b) забирает pending
// scheduled_messages по sendAt + расписанию workspace.

const WsParam = z.object({ wsId: z.string().min(1).max(64) });
const WsProjectParam = z.object({
  wsId: z.string().min(1).max(64),
  projectId: z.string().min(1).max(64),
});

const DelaySchema = z.object({
  period: z.enum(["minutes", "hours", "days"]),
  value: z.number().int().min(0).max(365),
});

const MessageSchema = z.object({
  id: z.string(),
  text: z.string().min(1).max(4000),
  // Альтернативный текст для «тёплых» лидов (тех, кто хоть раз отвечал нам
  // через любой аккаунт воркспейса). Сейчас применяется только к первому
  // сообщению (idx=0) — UI отдаёт это поле только для первого шага.
  warmText: z.string().max(4000).nullable().optional(),
  delay: DelaySchema,
});

const ProjectStatusSchema = z.enum(projectStatus.enumValues);
const PhaseSchema = z.enum(projectPhase.enumValues);
const AccountsModeSchema = z.enum(outreachAccountsMode.enumValues);

const StageSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(80),
  order: z.number().int(),
});

const ProjectSchema = z
  .object({
    id: z.string(),
    trackId: z.string(),
    name: z.string(),
    status: ProjectStatusSchema,
    // agency-поля (kind='agency'). Для bd-проектов phase='briefing' и brief-*
    // null — UI их не показывает.
    phase: PhaseSchema,
    brief: z.string().nullable(),
    budgetAmount: z.number().nullable(),
    periodStart: z.iso.datetime().nullable(),
    periodEnd: z.iso.datetime().nullable(),
    tov: z.string().nullable(),
    constraints: z.string().nullable(),
    advertiserData: z.string().nullable(),
    stages: z.array(StageSchema),
    accountsMode: AccountsModeSchema,
    accountsSelected: z.array(z.string()),
    messages: z.array(MessageSchema),
    contactDefaultOwnerIds: z.array(z.string()),
    contactDefaults: z.record(z.string(), z.unknown()),
    activatedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    // Клиент финализировал медиаплан (фаза «Согласование»): решения заморожены.
    // null = ещё правит / не дошли до согласования. Менеджер может переоткрыть.
    clientFinalizedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    // SUM(contacts.unread_count) по всем лидам проекта с фильтром по доступным
    // member'у аккаунтам. Считается только в GET /projects (list). Для single-
    // project ответов (POST/PATCH/activate/...) всегда 0 — фронт инвалидирует
    // список и подтянет свежий sum.
    unreadCount: z.number().int(),
  })
  .openapi("Project");

const CreateProjectBody = z
  .object({
    trackId: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
    // Опциональный stage_template — стадии скопируются из шаблона. Если
    // не передан, используется DEFAULT_OUTREACH_STAGES (4 стадии).
    templateId: z.string().min(1).max(64).optional(),
    // Опциональный message_template — цепочка сообщений скопируется в
    // projects.messages. Не передан → проект создаётся с пустой цепочкой,
    // юзер её набьёт руками в редакторе.
    messageTemplateId: z.string().min(1).max(64).optional(),
    // agency: бриф можно заполнить сразу при создании кампании (§5.2) либо
    // позже через PATCH. Для bd-проектов игнорируются.
    brief: z.string().max(10000).optional(),
    budgetAmount: z.number().nonnegative().optional(),
    periodStart: z.iso.datetime().optional(),
    periodEnd: z.iso.datetime().optional(),
    tov: z.string().max(2000).optional(),
    constraints: z.string().max(2000).optional(),
    advertiserData: z.string().max(2000).optional(),
  })
  .openapi("CreateProject");

const UpdateProjectBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    stages: z.array(StageSchema).optional(),
    accountsMode: AccountsModeSchema.optional(),
    accountsSelected: z.array(z.string()).optional(),
    messages: z.array(MessageSchema).optional(),
    contactDefaultOwnerIds: z.array(z.string()).optional(),
    contactDefaults: z.record(z.string(), z.unknown()).optional(),
    // agency: фаза и бриф правятся в любом статусе (не snapshot-поля).
    // phase — свободная навигация по визарду, brief-* — данные кампании.
    phase: PhaseSchema.optional(),
    brief: z.string().max(10000).nullable().optional(),
    budgetAmount: z.number().nonnegative().nullable().optional(),
    periodStart: z.iso.datetime().nullable().optional(),
    periodEnd: z.iso.datetime().nullable().optional(),
    tov: z.string().max(2000).nullable().optional(),
    constraints: z.string().max(2000).nullable().optional(),
    advertiserData: z.string().max(2000).nullable().optional(),
  })
  .openapi("UpdateProject");

const MoveItemBody = z
  .object({
    // null валиден — «убрать из канбана» (вернуться в «Без стадии»).
    stageId: z.string().min(1).max(64).nullable(),
  })
  .openapi("MoveProjectItem");

// Расширенный progress: на каждое сообщение sequence у лида либо одно
// scheduled_messages-row (одна попытка), либо ничего (msg ещё не запланирован).
// status: pending → sent → (read), либо failed/cancelled.
const LeadMessageProgressSchema = z
  .object({
    messageIdx: z.number().int(),
    status: z.enum(scheduledMessageStatus.enumValues),
    sentAt: z.iso.datetime().nullable(),
    readAt: z.iso.datetime().nullable(),
    scheduledAt: z.iso.datetime().nullable(),
    error: z.string().nullable(),
  })
  .openapi("OutreachLeadMessageProgress");

const LeadAccountSchema = z
  .object({
    id: z.string(),
    firstName: z.string().nullable(),
    tgUsername: z.string().nullable(),
    phoneNumber: z.string().nullable(),
    hasPremium: z.boolean(),
  })
  .openapi("OutreachLeadAccount");

const LeadProgressSchema = z
  .object({
    id: z.string(),
    username: z.string().nullable(),
    // tg_user_id зафиксирован после первой отправки worker'а (или из
    // pre-resolve sticky на импорте, если контакт был в базе). Нужен на
    // фронте для quick send'а лиду, у которого ещё нет привязанного контакта.
    tgUserId: z.string().nullable(),
    // CSV-properties (для toggle «Показать CSV-данные» в leads-таблице).
    // Сюда уезжают и raw CSV-headers, и mapped-keys.
    properties: z.record(z.string(), z.string()),
    // Аккаунт, через который отправляются сообщения этому лиду. Может быть
    // разным для разных лидов (round-robin distribution при активации).
    // null если sequence ещё в draft и лид незнаком (без sticky).
    account: LeadAccountSchema.nullable(),
    // Откуда приехал account: "scheduled" — фактический accountId зафиксирован
    // в scheduled_messages (sequence уже активирована); "sticky" — предсказание
    // через contacts.primary_account_id, sequence ещё в draft и round-robin
    // этот лид не зацепит; null — лид незнаком, на активации уйдёт в RR.
    accountSource: z.enum(["scheduled", "sticky"]).nullable(),
    // Прогресс по каждому сообщению цепочки. Длина = project.messages.length.
    messages: z.array(LeadMessageProgressSchema),
    repliedAt: z.iso.datetime().nullable(),
    contactId: z.string().nullable(),
    // Непрочитанные входящие — счётчик с прицепленного контакта (если есть).
    // Для лидов без contactId всегда 0. Бэйдж на канбане; синхронизация через
    // contact-stream SSE — листенер на /kanban апдейтит лидов с этим contactId.
    unreadCount: z.number().int(),
    // Ближайший открытый reminder контакта. Рендерится на канбан-карточке как
    // Bell-иконка + дата (Сегодня / DD.MM, красным если просрочен). Берётся
    // через nextStepSql subquery с привязанного contact'а; для лидов без
    // contactId всегда null.
    nextStep: z
      .object({
        date: z.iso.datetime(),
        text: z.string(),
        repeat: z.enum(["none", "daily", "weekly", "monthly"]),
      })
      .nullable(),
    // Текущая стадия канбана (id из project.stages[*].id). null = «без
    // стадии» — карточка не на канбане.
    stageId: z.string().nullable(),
    // CSV-batch, в котором лид появился в проекте. Для фильтра таблицы
    // лидов «Импорт: ▾» — посмотреть только что подлили.
    importId: z.string().nullable(),
  })
  .openapi("OutreachLeadProgress");

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects",
    tags: ["outreach"],
    request: { params: WsParam },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(ProjectSchema) } },
        description: "Projects",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");

    // SUM непрочитанных по лидам проекта с фильтром RBAC: member видит unread
    // только по лидам, привязанным к его аккаунтам (через scheduled_messages).
    // Без фильтра в /leads такой лид и так не показался бы, а в бейдже всплыло
    // бы число которого «нигде нет».
    const memberFilter =
      role === "admin"
        ? sql`true`
        : sql`EXISTS (
            SELECT 1 FROM scheduled_messages sm
            WHERE sm.item_id = pi.id
              AND sm.account_id IN ${myAccountIdsSql(wsId, userId)}
          )`;
    // projects.id внутри correlated subquery — голым SQL, не через
    // ${projects.id}. Drizzle на колоночном binding'е выводит просто "id"
    // без префикса таблицы, и postgres путается с алиасом `pi.id` →
    // «column reference "id" is ambiguous».
    const unreadSql = sql<number>`COALESCE((
      SELECT SUM(c.unread_count)::int
      FROM project_items pi
      JOIN contacts c ON c.id = pi.contact_id
      WHERE pi.project_id = projects.id
        AND c.unread_count > 0
        AND ${memberFilter}
    ), 0)`;

    const rows = await db
      .select({
        row: projects,
        unread: unreadSql.as("unread_count"),
      })
      .from(projects)
      .where(
        and(
          projectAccessClause(wsId, userId, role),
          ne(projects.status, "archived"),
        ),
      )
      .orderBy(asc(projects.createdAt));
    return c.json(rows.map((r) => serializeProject(r.row, r.unread)));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects",
    tags: ["outreach"],
    request: {
      params: WsParam,
      body: {
        content: { "application/json": { schema: CreateProjectBody } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: ProjectSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const body = c.req.valid("json");
    const [track] = await db
      .select({ id: tracks.id })
      .from(tracks)
      .where(and(eq(tracks.id, body.trackId), eq(tracks.workspaceId, wsId)))
      .limit(1);
    if (!track) throw new HTTPException(404, { message: "track not found" });

    // Стадии: либо копия из шаблона, либо DEFAULT_OUTREACH_STAGES.
    let initialStages: ProjectStage[] = DEFAULT_OUTREACH_STAGES;
    if (body.templateId) {
      const [tpl] = await db
        .select({ stages: stageTemplates.stages })
        .from(stageTemplates)
        .where(
          and(
            eq(stageTemplates.id, body.templateId),
            eq(stageTemplates.workspaceId, wsId),
          ),
        )
        .limit(1);
      if (!tpl) {
        throw new HTTPException(404, { message: "template not found" });
      }
      initialStages = tpl.stages;
    }

    // Цепочка: либо копия из message-шаблона, либо пустой массив.
    let initialMessages: ProjectMessage[] = [];
    if (body.messageTemplateId) {
      const [tpl] = await db
        .select({ messages: messageTemplates.messages })
        .from(messageTemplates)
        .where(
          and(
            eq(messageTemplates.id, body.messageTemplateId),
            eq(messageTemplates.workspaceId, wsId),
          ),
        )
        .limit(1);
      if (!tpl) {
        throw new HTTPException(404, { message: "message template not found" });
      }
      initialMessages = tpl.messages;
    }

    // kind проставляется автоматом из workspace.mode (см. db/schema.ts рядом
    // с projectKind). bd → outreach, agency → agency. Юзер kind не выбирает.
    const mode = c.get("workspaceMode");
    const kind = mode === "agency" ? "agency" : "outreach";
    const [row] = await db
      .insert(projects)
      .values({
        workspaceId: wsId,
        trackId: body.trackId,
        name: body.name,
        kind,
        stages: initialStages,
        messages: initialMessages,
        // agency brief-поля (для bd остаются null/default). numeric → string,
        // ISO-даты → Date.
        brief: body.brief ?? null,
        budgetAmount: body.budgetAmount != null ? String(body.budgetAmount) : null,
        periodStart: body.periodStart ? new Date(body.periodStart) : null,
        periodEnd: body.periodEnd ? new Date(body.periodEnd) : null,
        tov: body.tov ?? null,
        constraints: body.constraints ?? null,
        advertiserData: body.advertiserData ?? null,
        createdBy: userId,
      })
      .returning();
    return c.json(serializeProject(row!), 201);
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}",
    tags: ["outreach"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: { "application/json": { schema: ProjectSchema } },
        description: "Project",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const row = await assertProjectAccess(projectId, wsId, userId, role);
    return c.json(serializeProject(row));
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/projects/{projectId}",
    tags: ["outreach"],
    request: {
      params: WsProjectParam,
      body: {
        content: { "application/json": { schema: UpdateProjectBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ProjectSchema } },
        description: "Updated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const body = c.req.valid("json");
    const existing = await assertProjectAccess(projectId, wsId, userId, role);

    // Snapshot-fields (зашиваются в scheduled_messages при activate) можно
    // менять только в draft. Contact-settings влияют на ещё-не-созданные
    // контакты, их можно менять в любой момент.
    const touchedSnapshot =
      body.name !== undefined ||
      body.accountsMode !== undefined ||
      body.accountsSelected !== undefined ||
      body.messages !== undefined;
    if (touchedSnapshot && existing.status !== "draft") {
      throw new HTTPException(400, {
        message:
          "Name/accounts/messages can be edited only in draft. Use contact-settings fields anytime.",
      });
    }

    // stages можно править в любом статусе — это атрибут канбана,
    // не уходит в snapshot scheduled_messages. Остальные ограничены above.
    const [row] = await db
      .update(projects)
      .set({
        ...pickDefined(body, [
          "name",
          "stages",
          "accountsMode",
          "accountsSelected",
          "messages",
          "contactDefaultOwnerIds",
          "contactDefaults",
          // agency text/enum-поля — прямое копирование (null валиден).
          "phase",
          "brief",
          "tov",
          "constraints",
          "advertiserData",
        ]),
        // numeric/timestamp требуют конверсии — pickDefined не годится.
        ...(body.budgetAmount !== undefined && {
          budgetAmount:
            body.budgetAmount === null ? null : String(body.budgetAmount),
        }),
        ...(body.periodStart !== undefined && {
          periodStart: body.periodStart ? new Date(body.periodStart) : null,
        }),
        ...(body.periodEnd !== undefined && {
          periodEnd: body.periodEnd ? new Date(body.periodEnd) : null,
        }),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId))
      .returning();
    return c.json(serializeProject(row!));
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/projects/{projectId}",
    tags: ["outreach"],
    request: { params: WsProjectParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const { projectId } = c.req.valid("param");
    const result = await db
      .delete(projects)
      .where(
        and(
          eq(projects.id, projectId),
          eq(projects.workspaceId, wsId),
        ),
      )
      .returning({ id: projects.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "project not found" });
    }
    return c.body(null, 204);
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/activate",
    tags: ["outreach"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: { "application/json": { schema: ProjectSchema } },
        description: "Activated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    if (project.status !== "draft") {
      throw new HTTPException(400, {
        message: "Only draft projects can be activated",
      });
    }
    if (project.messages.length === 0) {
      throw new HTTPException(400, { message: "Add at least one message" });
    }

    const accountIds = await resolveProjectAccountIds(wsId, project);
    if (accountIds.length === 0) {
      throw new HTTPException(400, {
        message: "No active outreach accounts available",
      });
    }

    const allLeads = await db
      .select()
      .from(projectItems)
      .where(eq(projectItems.projectId, project.id))
      .orderBy(asc(projectItems.createdAt));
    if (allLeads.length === 0) {
      throw new HTTPException(400, { message: "List has no leads" });
    }

    // Agency: жёсткий гейт готовности контактов (этап 16.8). Скоуп — только
    // лонглист (shortlistedAt IS NULL): отобранные в шортлист уже прошли аутрич
    // и не считаются/не получают повторный опенер (совпадает с тем, что видит
    // экран). BD-проекты не трогаем.
    if (project.kind === "agency") {
      const placements = await db
        .select({
          hasAdmin: sql<boolean>`exists (select 1 from ${channelAdmins} where ${channelAdmins.channelId} = ${channels.id})`,
          // Бесплатная личка канала: есть DM-группа (синкается на скане) и
          // отправка бесплатна. has_dm НЕ используем — его пишет репликатор
          // асинхронно, а direct_messages_chat_id кладёт сам sync.
          hasDm: sql<boolean>`coalesce(${channels.meta} ->> 'direct_messages_chat_id', '0') <> '0'`,
          dmStar: sql<
            number | null
          >`(${channels.meta} ->> 'outgoing_paid_message_star_count')::int`,
          methodSet: sql<boolean>`(${channels.meta} -> 'contact_method' ->> 'kind') is not null`,
        })
        .from(projectItems)
        .leftJoin(channels, eq(channels.id, projectItems.channelId))
        .where(
          and(
            eq(projectItems.projectId, project.id),
            eq(projectItems.kind, "placement"),
            isNull(projectItems.shortlistedAt),
            // Отказавшихся (available=false) в гейт не считаем (этап 16.10).
            sql`${projectItems.available} is distinct from false`,
          ),
        );
      // Готовность = совпадает с Placement.contactReady (см. campaigns.ts):
      // привязан админ ИЛИ бесплатная личка канала.
      const unready = placements.filter(
        (p) => !(p.hasAdmin || p.methodSet || (p.hasDm && p.dmStar === 0)),
      ).length;
      if (unready > 0) {
        throw new HTTPException(400, {
          message: `Нельзя запустить аутрич: каналов без контакта — ${unready}. Найдите контакт или уберите их из лонглиста.`,
        });
      }
    }

    // Список лидов в рассылку. Agency: prepareAgencyLeads (дедуп по админу +
    // {{каналы}} + только лонглист, без already-contacted на первом запуске).
    // BD: identity-дедуп по lower(username) (defense-in-depth от дублей).
    let leads: SchedulingLead[];
    if (project.kind === "agency") {
      const longlist = allLeads
        .filter((l) => l.shortlistedAt === null && l.available !== false)
        .map((l) => ({
          id: l.id,
          username: l.username,
          tgUserId: l.tgUserId,
          properties: (l.properties ?? {}) as Record<string, unknown>,
        }));
      leads = await prepareAgencyLeads({
        projectId: project.id,
        leads: longlist,
        skipContacted: false,
      });
    } else {
      const seen = new Set<string>();
      leads = [];
      for (const l of allLeads) {
        const key = l.username ? `u:${l.username.toLowerCase()}` : null;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        leads.push({
          id: l.id,
          username: l.username,
          tgUserId: l.tgUserId,
          properties: (l.properties ?? {}) as Record<string, unknown>,
        });
      }
    }

    const tgUserIds = leads
      .map((l) => l.tgUserId)
      .filter((x): x is string => x !== null);
    const priorByTgUserId = await resolveStickyByTgUserIds(wsId, tgUserIds);
    const warmTgUserIds = await resolveWarmTgUserIds(wsId, tgUserIds);

    const activatedAt = new Date();
    const rows = buildScheduledRows({
      wsId,
      project,
      accountIds,
      leads,
      baseTime: activatedAt,
      priorByTgUserId,
      warmTgUserIds,
    });

    await db.transaction(async (tx) => {
      // postgres-js биндит каждое значение как отдельный $N; лимит ~65k
      // параметров на query. Чанкуем по 1000 строк (× ~10 cols = 10k params).
      const CHUNK = 1000;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await tx.insert(scheduledMessages).values(rows.slice(i, i + CHUNK));
      }
      await tx
        .update(projects)
        .set({
          status: "active",
          activatedAt,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, project.id));
    });

    const refreshed = await assertProjectAccess(projectId, wsId, userId, role);
    return c.json(serializeProject(refreshed));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/pause",
    tags: ["outreach"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: { "application/json": { schema: ProjectSchema } },
        description: "Paused",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    if (project.status !== "active") {
      throw new HTTPException(400, {
        message: "Only active projects can be paused",
      });
    }
    // Pending scheduled_messages не трогаем — worker (фаза 3b) проверит
    // sequence.status='active' при выборке. Resume вернёт sequence в active
    // и worker подтянет всё, что должно было уйти за время паузы.
    await db
      .update(projects)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(projects.id, project.id));
    const refreshed = await assertProjectAccess(projectId, wsId, userId, role);
    return c.json(serializeProject(refreshed));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/resume",
    tags: ["outreach"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: { "application/json": { schema: ProjectSchema } },
        description: "Resumed",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    if (project.status !== "paused") {
      throw new HTTPException(400, {
        message: "Only paused projects can be resumed",
      });
    }
    await db
      .update(projects)
      .set({ status: "active", updatedAt: new Date() })
      .where(eq(projects.id, project.id));
    const refreshed = await assertProjectAccess(projectId, wsId, userId, role);
    return c.json(serializeProject(refreshed));
  },
);

// Завершить проект вручную. Из active/paused → done + cancel всех pending
// сообщений (иначе они зависли бы навсегда — worker не берёт done).
// Канбан и quick-send остаются доступны как чтение (см. /items guard).
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/complete",
    tags: ["outreach"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: { "application/json": { schema: ProjectSchema } },
        description: "Completed",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    if (project.status !== "active" && project.status !== "paused") {
      throw new HTTPException(400, {
        message: "Only active or paused projects can be completed",
      });
    }
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(scheduledMessages)
        .set({ status: "cancelled", error: "project completed" })
        .where(
          and(
            eq(scheduledMessages.projectId, project.id),
            eq(scheduledMessages.status, "pending"),
          ),
        );
      await tx
        .update(projects)
        .set({ status: "done", completedAt: now, updatedAt: now })
        .where(eq(projects.id, project.id));
    });
    // Соседние вкладки/менеджеры с открытым этим проектом увидят cancel
    // pending'ов и смену статуса без F5 (как worker делает на каждое sent).
    emitProjectChanged(project.id);
    const refreshed = await assertProjectAccess(projectId, wsId, userId, role);
    return c.json(serializeProject(refreshed));
  },
);

// Архивировать done-проект — скрыть из listing'а. Из done → archived.
// Активные/paused архивировать нельзя: сначала «Завершить». Из draft —
// «Удалить». archived проекты не возвращаются в GET /projects.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/archive",
    tags: ["outreach"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: { "application/json": { schema: ProjectSchema } },
        description: "Archived",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    if (project.status !== "done") {
      throw new HTTPException(400, {
        message: "Only completed projects can be archived",
      });
    }
    await db
      .update(projects)
      .set({ status: "archived", updatedAt: new Date() })
      .where(eq(projects.id, project.id));
    const refreshed = await assertProjectAccess(projectId, wsId, userId, role);
    return c.json(serializeProject(refreshed));
  },
);

// Переоткрыть финализированный клиентом медиаплан: обнуляем clientFinalizedAt,
// клиент снова может менять решения по своей magic-link. На случай «клиент
// финализировал, но позвонил и передумал». Идемпотентно.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/unfinalize",
    tags: ["agency"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: { "application/json": { schema: ProjectSchema } },
        description: "Media plan reopened for client editing",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    await db
      .update(projects)
      .set({ clientFinalizedAt: null, updatedAt: new Date() })
      .where(eq(projects.id, project.id));
    const refreshed = await assertProjectAccess(projectId, wsId, userId, role);
    return c.json(serializeProject(refreshed));
  },
);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/leads",
    tags: ["outreach"],
    request: {
      params: WsProjectParam,
      query: z.object({
        limit: z.coerce.number().int().min(1).max(1000).default(100),
        offset: z.coerce.number().int().min(0).default(0),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              total: z.number().int(),
              totalCount: z.number().int(),
              repliedCount: z.number().int(),
              leads: z.array(LeadProgressSchema),
            }),
          },
        },
        description: "Leads with progress",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const { limit, offset } = c.req.valid("query");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    const totalCount = project.messages.length;

    // Фильтр лидов внутри проекта: admin видит всё, member — только лиды,
    // у которых scheduled_messages.account_id ∈ его аккаунтов. Draft-проекты
    // (без scheduled) member'у пустые — это OK: настройку ведёт admin, member
    // включается после активации, когда лиды распределены.
    const memberFilter =
      role === "admin"
        ? undefined
        : sql`EXISTS (
            SELECT 1 FROM scheduled_messages sm
            WHERE sm.item_id = ${projectItems.id}
              AND sm.account_id IN ${myAccountIdsSql(wsId, userId)}
          )`;

    // repliedAgg + leadRows независимы — параллелим. repliedCount по всему
    // списку (не пагинированному) для шапки «N ответили из M».
    const [repliedCount, leadRows] = await Promise.all([
      db.$count(
        projectItems,
        and(
          eq(projectItems.projectId, project.id),
          isNotNull(projectItems.repliedAt),
          memberFilter,
        ),
      ),
      db
        .select({
          id: projectItems.id,
          username: projectItems.username,
          tgUserId: projectItems.tgUserId,
          properties: projectItems.properties,
          repliedAt: projectItems.repliedAt,
          contactId: projectItems.contactId,
          unreadCount: sql<number>`coalesce(${contacts.unreadCount}, 0)::int`,
          nextStep: nextStepSql,
          stageId: projectItems.stageId,
          importId: projectItems.importId,
          total: sql<number>`count(*) OVER ()::int`,
        })
        .from(projectItems)
        .leftJoin(contacts, eq(contacts.id, projectItems.contactId))
        .where(and(eq(projectItems.projectId, project.id), memberFilter))
        .orderBy(asc(projectItems.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    if (leadRows.length === 0) {
      return c.json({ total: 0, totalCount, repliedCount, leads: [] });
    }

    // Все scheduled_messages для этих лидов одним запросом, агрегируем в JS.
    // Колонки sentAt/readAt/error per scheduled_message нужны для UI-таблицы
    // лидов (донор-style), accountId — чтобы показать через какой аккаунт
    // рассылается этому лиду.
    const sched = await db
      .select({
        itemId: scheduledMessages.itemId,
        accountId: scheduledMessages.accountId,
        messageIdx: scheduledMessages.messageIdx,
        status: scheduledMessages.status,
        sendAt: scheduledMessages.sendAt,
        sentAt: scheduledMessages.sentAt,
        readAt: scheduledMessages.readAt,
        error: scheduledMessages.error,
      })
      .from(scheduledMessages)
      .where(
        and(
          eq(scheduledMessages.projectId, projectId),
          inArray(
            scheduledMessages.itemId,
            leadRows.map((l) => l.id),
          ),
        ),
      );

    // Sticky-предсказание для draft-лидов (без scheduled_messages):
    // тот же резолвер, что в /activate — гарантирует, что UI совпадёт с
    // реальным распределением при активации.
    const byLead = Map.groupBy(sched, (s) => s.itemId);
    const tgUserIdsNeedingSticky = leadRows
      .filter((l) => l.tgUserId && !byLead.has(l.id))
      .map((l) => l.tgUserId!);
    const stickyByTgUserId = await resolveStickyByTgUserIds(
      wsId,
      tgUserIdsNeedingSticky,
    );

    // Account info — один SELECT по объединённому множеству:
    // (фактические из scheduled) ∪ (sticky-предсказания из contacts).
    const accountIds = [
      ...new Set([
        ...sched.map((s) => s.accountId),
        ...stickyByTgUserId.values(),
      ]),
    ];
    const accountRows = accountIds.length
      ? await db
          .select({
            id: outreachAccounts.id,
            firstName: outreachAccounts.firstName,
            tgUsername: outreachAccounts.externalUsername,
            phoneNumber: outreachAccounts.phoneNumber,
            hasPremium: outreachAccounts.hasPremium,
          })
          .from(outreachAccounts)
          .where(inArray(outreachAccounts.id, accountIds))
      : [];
    const accountById = new Map(accountRows.map((a) => [a.id, a]));

    return c.json({
      total: leadRows[0]?.total ?? 0,
      totalCount,
      repliedCount,
      leads: leadRows.map((l) => {
        const items = byLead.get(l.id) ?? [];
        // Аккаунт берём из первого scheduled_message — все сообщения этого
        // лида ходят через один аккаунт (см. activate logic). Если scheduled
        // ещё нет (draft) — пробуем sticky-предсказание.
        const scheduledAccountId = items[0]?.accountId ?? null;
        const stickyAccountId = l.tgUserId
          ? stickyByTgUserId.get(l.tgUserId) ?? null
          : null;
        const accountId = scheduledAccountId ?? stickyAccountId;
        const account = accountId
          ? accountById.get(accountId) ?? null
          : null;
        const accountSource: "scheduled" | "sticky" | null = scheduledAccountId
          ? "scheduled"
          : stickyAccountId
            ? "sticky"
            : null;
        const messages = items
          .toSorted((a, b) => a.messageIdx - b.messageIdx)
          .map((s) => ({
            messageIdx: s.messageIdx,
            status: s.status,
            sentAt: s.sentAt?.toISOString() ?? null,
            readAt: s.readAt?.toISOString() ?? null,
            scheduledAt: s.sendAt?.toISOString() ?? null,
            error: s.error,
          }));
        return {
          id: l.id,
          username: l.username,
          tgUserId: l.tgUserId,
          properties: l.properties,
          account,
          accountSource,
          messages,
          repliedAt: l.repliedAt?.toISOString() ?? null,
          contactId: l.contactId,
          unreadCount: l.unreadCount,
          nextStep: l.nextStep,
          stageId: l.stageId,
          importId: l.importId,
        };
      }),
    });
  },
);

// Перенос карточки между стадиями канбана (drag-drop). Принимает stageId
// — id из project.stages[*].id или null (вернуть в «Без стадии»). Сервер
// валидирует что stageId существует в текущем project.stages.
app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}",
    tags: ["outreach"],
    request: {
      params: WsProjectParam.extend({
        itemId: z.string().min(1).max(64),
      }),
      body: {
        content: { "application/json": { schema: MoveItemBody } },
        required: true,
      },
    },
    responses: { 204: { description: "Moved" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, itemId } = c.req.valid("param");
    const { stageId } = c.req.valid("json");

    const project = await assertProjectAccess(projectId, wsId, userId, role);
    if (project.status === "done") {
      throw new HTTPException(400, {
        message: "Проект завершён — карточки заморожены",
      });
    }
    if (
      stageId !== null &&
      !(project.stages as ProjectStage[]).some((s) => s.id === stageId)
    ) {
      throw new HTTPException(400, { message: "unknown stage" });
    }

    const result = await db
      .update(projectItems)
      .set({ stageId })
      .where(
        and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)),
      )
      .returning({ id: projectItems.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "item not found" });
    }
    return c.body(null, 204);
  },
);

// Удаление лида из проекта. Разрешено только в draft — на этом этапе
// scheduled_messages ещё не созданы, ни одна отправка не ушла. После активации
// (active/paused/done) удаление запрещено: лид мог получить первое сообщение,
// и удалить его молча — потерять историю операции.
app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}",
    tags: ["outreach"],
    request: {
      params: WsProjectParam.extend({
        itemId: z.string().min(1).max(64),
      }),
    },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, itemId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    if (project.status !== "draft") {
      throw new HTTPException(400, {
        message: "Удалять лидов можно только в черновом проекте",
      });
    }
    const result = await db
      .delete(projectItems)
      .where(
        and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)),
      )
      .returning({ id: projectItems.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "item not found" });
    }
    return c.body(null, 204);
  },
);

// Sequence analytics: агрегаты sent/read/replied + timeseries.
//
// `period`: окно (дни). Влияет только на timeseries; total-метрики — за всё время.
// `grouping`: `day` / `week` / `month` — bucket для timeseries (date_trunc).
// `viewMode`:
//   - "eventDate" (по дате события): sent в день когда отправили, read когда
//     лид прочитал, replied когда лид ответил. Удобно для «когда у нас
//     активность вообще».
//   - "sendDate" (по дате отправки): read и replied отнесены к дню sentAt
//     самого исходящего, к которому относится событие. Удобно для cohort-
//     анализа «насколько эффективна была отправка такого-то дня».
const AnalyticsPointSchema = z
  .object({
    date: z.iso.date(),
    sent: z.number().int(),
    read: z.number().int(),
    replied: z.number().int(),
  })
  .openapi("OutreachAnalyticsPoint");

const GroupingSchema = z.enum(["day", "week", "month"]);
const ViewModeSchema = z.enum(["eventDate", "sendDate"]);

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/analytics",
    tags: ["outreach"],
    request: {
      params: WsProjectParam,
      query: z.object({
        period: z.coerce.number().int().min(1).max(365).default(30),
        grouping: GroupingSchema.default("day"),
        viewMode: ViewModeSchema.default("eventDate"),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              totalSent: z.number().int(),
              totalRead: z.number().int(),
              totalReplied: z.number().int(),
              totalLeads: z.number().int(),
              grouping: GroupingSchema,
              viewMode: ViewModeSchema,
              series: z.array(AnalyticsPointSchema),
            }),
          },
        },
        description: "Project analytics aggregates + timeseries",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const { period, grouping, viewMode } = c.req.valid("query");

    // grouping валидирован zod'ом до 'day'/'week'/'month' — кладём inline,
    // чтобы date_trunc-выражение в SELECT и GROUP BY были БУКВАЛЬНО одинаковые.
    // Через параметр postgres-js биндит как $1, и Postgres считает date_trunc($1)
    // и date_trunc($2) разными expression'ами → 42803.
    const gKw = sql.raw(`'${grouping}'`);

    const since = new Date(Date.now() - period * 86_400_000);

    // sent buckets — всегда по sentAt.
    const sentTrunc = sql`date_trunc(${gKw}, ${scheduledMessages.sentAt})`;
    // read/replied buckets — выбор по viewMode:
    //   eventDate → группируем по readAt / repliedAt
    //   sendDate  → группируем по sentAt самого исходящего
    const readTrunc =
      viewMode === "sendDate"
        ? sql`date_trunc(${gKw}, ${scheduledMessages.sentAt})`
        : sql`date_trunc(${gKw}, ${scheduledMessages.readAt})`;

    // Все 6 запросов независимы — поднимаем параллельно. Access-check + total
    // агрегаты + per-bucket series.
    //
    // replied bucket: в sendDate-режиме относим к дню первого sentAt лида
    // (упрощение MVP — точнее было бы "последний sentAt до repliedAt").
    let repliedQuery: Promise<{ bucket: Date; replied: number }[]>;
    if (viewMode === "sendDate") {
      const sub = db
        .select({
          itemId: scheduledMessages.itemId,
          firstSentAt: sql<Date>`min(${scheduledMessages.sentAt})`.as(
            "first_sent_at",
          ),
        })
        .from(scheduledMessages)
        .innerJoin(
          projectItems,
          eq(projectItems.id, scheduledMessages.itemId),
        )
        .where(
          and(
            eq(scheduledMessages.projectId, projectId),
            isNotNull(scheduledMessages.sentAt),
            isNotNull(projectItems.repliedAt),
            gte(scheduledMessages.sentAt, since),
          ),
        )
        .groupBy(scheduledMessages.itemId)
        .as("sub");
      const subTrunc = sql`date_trunc(${gKw}, sub.first_sent_at)`;
      repliedQuery = db
        .select({
          bucket: sql<Date>`${subTrunc}`,
          replied: sql<number>`count(*)::int`,
        })
        .from(sub)
        .groupBy(subTrunc);
    } else {
      const repTrunc = sql`date_trunc(${gKw}, ${projectItems.repliedAt})`;
      repliedQuery = db
        .select({
          bucket: sql<Date>`${repTrunc}`,
          replied: sql<number>`count(*)::int`,
        })
        .from(projectItems)
        .where(
          and(
            eq(projectItems.projectId, projectId),
            isNotNull(projectItems.repliedAt),
            gte(projectItems.repliedAt, since),
          ),
        )
        .groupBy(repTrunc);
    }

    const [accessRows, aggRows, leadsAggRows, sentRows, readRows, repliedRows] =
      await Promise.all([
        db
          .select({ id: projects.id })
          .from(projects)
          .where(
            and(
              eq(projects.id, projectId),
              projectAccessClause(wsId, userId, role),
            ),
          )
          .limit(1),
        db
          .select({
            sent: sql<number>`count(*) FILTER (WHERE ${scheduledMessages.status} = 'sent')::int`,
            read: sql<number>`count(*) FILTER (WHERE ${scheduledMessages.readAt} IS NOT NULL)::int`,
          })
          .from(scheduledMessages)
          .where(eq(scheduledMessages.projectId, projectId)),
        db
          .select({
            total: sql<number>`count(*)::int`,
            replied: sql<number>`count(*) FILTER (WHERE ${projectItems.repliedAt} IS NOT NULL)::int`,
          })
          .from(projectItems)
          .where(eq(projectItems.projectId, projectId)),
        db
          .select({
            bucket: sql<Date>`${sentTrunc}`,
            sent: sql<number>`count(*)::int`,
          })
          .from(scheduledMessages)
          .where(
            and(
              eq(scheduledMessages.projectId, projectId),
              eq(scheduledMessages.status, "sent"),
              gte(scheduledMessages.sentAt, since),
            ),
          )
          .groupBy(sentTrunc),
        db
          .select({
            bucket: sql<Date>`${readTrunc}`,
            read: sql<number>`count(*)::int`,
          })
          .from(scheduledMessages)
          .where(
            and(
              eq(scheduledMessages.projectId, projectId),
              isNotNull(scheduledMessages.readAt),
              gte(
                viewMode === "sendDate"
                  ? scheduledMessages.sentAt
                  : scheduledMessages.readAt,
                since,
              ),
            ),
          )
          .groupBy(readTrunc),
        repliedQuery,
      ]);
    if (!accessRows[0]) {
      throw new HTTPException(404, { message: "project not found" });
    }
    const agg = aggRows[0];
    const leadsAgg = leadsAggRows[0];

    // Bucket-ключ — UTC ISO-date "YYYY-MM-DD" (date_trunc возвращает Date в UTC).
    const bucketKey = (d: Date | string): string => {
      const dt = typeof d === "string" ? new Date(d) : d;
      return dt.toISOString().slice(0, 10);
    };
    const byBucket = new Map<
      string,
      { sent: number; read: number; replied: number }
    >();
    for (const r of sentRows) {
      const k = bucketKey(r.bucket);
      const e = byBucket.get(k) ?? { sent: 0, read: 0, replied: 0 };
      e.sent = r.sent;
      byBucket.set(k, e);
    }
    for (const r of readRows) {
      const k = bucketKey(r.bucket);
      const e = byBucket.get(k) ?? { sent: 0, read: 0, replied: 0 };
      e.read = r.read;
      byBucket.set(k, e);
    }
    for (const r of repliedRows) {
      const k = bucketKey(r.bucket);
      const e = byBucket.get(k) ?? { sent: 0, read: 0, replied: 0 };
      e.replied = r.replied;
      byBucket.set(k, e);
    }

    // Dense series — последовательно перечисляем bucket'ы в окне period.
    // Для day — ровно period шагов; для week/month — округляем границы.
    const series = densifySeries(period, grouping, byBucket);

    return c.json({
      totalSent: agg?.sent ?? 0,
      totalRead: agg?.read ?? 0,
      totalReplied: leadsAgg?.replied ?? 0,
      totalLeads: leadsAgg?.total ?? 0,
      grouping,
      viewMode,
      series,
    });
  },
);

function densifySeries(
  period: number,
  grouping: "day" | "week" | "month",
  byBucket: Map<string, { sent: number; read: number; replied: number }>,
): { date: string; sent: number; read: number; replied: number }[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const out: ReturnType<typeof densifySeries> = [];
  if (grouping === "day") {
    for (let i = period - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      const e = byBucket.get(key) ?? { sent: 0, read: 0, replied: 0 };
      out.push({ date: key, ...e });
    }
  } else if (grouping === "week") {
    // ISO-week start: Monday. Postgres date_trunc('week') тоже даёт Monday.
    const startOfWeek = (d: Date): Date => {
      const dow = d.getUTCDay() || 7; // Sun=7
      const r = new Date(d);
      r.setUTCDate(d.getUTCDate() - (dow - 1));
      r.setUTCHours(0, 0, 0, 0);
      return r;
    };
    const weeksBack = Math.ceil(period / 7);
    const lastMonday = startOfWeek(today);
    for (let i = weeksBack - 1; i >= 0; i--) {
      const d = new Date(lastMonday.getTime() - i * 7 * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      const e = byBucket.get(key) ?? { sent: 0, read: 0, replied: 0 };
      out.push({ date: key, ...e });
    }
  } else {
    // month
    const monthsBack = Math.ceil(period / 30);
    const startOfMonth = (y: number, m: number): Date => {
      const d = new Date(Date.UTC(y, m, 1));
      d.setUTCHours(0, 0, 0, 0);
      return d;
    };
    const cur = startOfMonth(today.getUTCFullYear(), today.getUTCMonth());
    for (let i = monthsBack - 1; i >= 0; i--) {
      const d = new Date(cur);
      d.setUTCMonth(cur.getUTCMonth() - i);
      const key = d.toISOString().slice(0, 10);
      const e = byBucket.get(key) ?? { sent: 0, read: 0, replied: 0 };
      out.push({ date: key, ...e });
    }
  }
  return out;
}

// Preview-helper: один случайный лид из листа sequence для предпросмотра
// {{}}-подстановок в редакторе сообщения. Возвращает minimal payload —
// идентификатор + properties; sequence detail-page использует его в
// `substituteVariables` чтобы показать «как будет выглядеть текст для лида».
const SampleLeadSchema = z
  .object({
    id: z.string(),
    username: z.string().nullable(),
    properties: z.record(z.string(), z.string()),
  })
  .openapi("OutreachSampleLead");

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/sample-lead",
    tags: ["outreach"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: {
          "application/json": { schema: SampleLeadSchema.nullable() },
        },
        description: "Random lead from project (or null if empty)",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    // count + OFFSET вместо ORDER BY random() — Postgres делает full sort
    // на каждый клик «Другой лид»; на больших проектах это заметно.
    const [cntRow] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(projectItems)
      .where(eq(projectItems.projectId, project.id));
    const cnt = cntRow?.cnt ?? 0;
    if (cnt === 0) return c.json(null);
    const [row] = await db
      .select({
        id: projectItems.id,
        username: projectItems.username,
        properties: projectItems.properties,
      })
      .from(projectItems)
      .where(eq(projectItems.projectId, project.id))
      .limit(1)
      .offset(Math.floor(Math.random() * cnt));
    if (!row) return c.json(null);
    return c.json({
      id: row.id,
      username: row.username,
      properties: row.properties,
    });
  },
);

function serializeProject(
  row: typeof projects.$inferSelect,
  unreadCount = 0,
) {
  return {
    id: row.id,
    trackId: row.trackId,
    name: row.name,
    status: row.status,
    phase: row.phase,
    brief: row.brief,
    budgetAmount: row.budgetAmount === null ? null : Number(row.budgetAmount),
    periodStart: row.periodStart?.toISOString() ?? null,
    periodEnd: row.periodEnd?.toISOString() ?? null,
    tov: row.tov,
    constraints: row.constraints,
    advertiserData: row.advertiserData,
    stages: row.stages,
    accountsMode: row.accountsMode,
    accountsSelected: row.accountsSelected,
    messages: row.messages,
    contactDefaultOwnerIds: row.contactDefaultOwnerIds,
    contactDefaults: row.contactDefaults,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    clientFinalizedAt: row.clientFinalizedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    unreadCount,
  };
}

// SSE-стрим обновлений sequence — фронт открывает EventSource, на каждое
// изменение в scheduled_messages этой sequence (sent/failed/cancelled +
// reply от listener'а) приходит уведомление, фронт инвалидирует кэш и
// перетягивает leads endpoint. Не openapi — EventSource не работает с
// типизированным клиентом, и schema особо не нужна.
//
// Auth работает через assertMember на /v1/workspaces/{wsId}/* (тот же middleware
// что у openapi-роутов). EventSource шлёт cookie если withCredentials:true +
// CORS allow-credentials в app.ts.
app.get(
  "/v1/workspaces/:wsId/projects/:projectId/stream",
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const projectId = c.req.param("projectId");
    if (!projectId) throw new HTTPException(400, { message: "projectId required" });
    // Verify sequence доступна юзеру до открытия стрима (RBAC).
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(
          eq(projects.id, projectId),
          projectAccessClause(wsId, userId, role),
        ),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "project not found" });

    return streamSSE(c, async (stream) => {
      let unsub = () => {};
      stream.onAbort(() => {
        unsub();
      });
      // События от пуш-шины — отправляем «changed» сигнал, фронт сам решает что
      // перетягивать. Можно было бы слать payload, но тогда сервер должен знать
      // полную форму lead-progress'а — лишнее связывание; пусть фронт читает свой
      // же endpoint.
      unsub = subscribeProject(projectId, () => {
        // writeSSE может бросить если клиент уже отключился между abort'ом и
        // emit'ом — глушим, иначе unhandled rejection.
        stream.writeSSE({ event: "changed", data: "1" }).catch(() => {});
      });
      // Heartbeat: иначе reverse-proxies (nginx 60s, cloudflare 100s) идлят
      // соединение. Браузер на close сам реконнектит, но между переподключениями
      // юзер увидит лаг 5-30 секунд. try/catch обязательно — sleep НЕ
      // отменяется на abort, после wake-up можем оказаться в закрытом stream
      // → writeSSE throws → unhandled rejection → Bun уронит процесс.
      try {
        while (!stream.aborted) {
          await stream.writeSSE({ event: "ping", data: "" });
          await stream.sleep(25_000);
        }
      } catch {
        // stream закрылся, выходим тихо
      }
    });
  },
);

export default app;
