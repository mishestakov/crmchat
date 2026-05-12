import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import { and, asc, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  contactCreationTrigger,
  contacts,
  DEFAULT_OUTREACH_STAGES,
  messageTemplates,
  outreachAccounts,
  outreachAccountsMode,
  projectItems,
  projects,
  stageTemplates,
  tgChats,
  tracks,
  projectStatus,
  scheduledMessages,
  scheduledMessageStatus,
  type ProjectMessage,
  type ProjectStage,
} from "../db/schema.ts";
import { contactTgUserIdSql } from "../lib/contact-sql.ts";
import { pickDefined } from "../lib/pick-defined.ts";
import { subscribeProject } from "../lib/outreach-events.ts";
import {
  assertProjectAccess,
  projectAccessClause,
} from "../lib/projects-access.ts";
import { substituteVariables } from "../lib/substitute-variables.ts";
import { assertRole, type WorkspaceVars } from "../middleware/assert-member.ts";

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
const AccountsModeSchema = z.enum(outreachAccountsMode.enumValues);
const ContactCreationTriggerSchema = z.enum(contactCreationTrigger.enumValues);

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
    stages: z.array(StageSchema),
    accountsMode: AccountsModeSchema,
    accountsSelected: z.array(z.string()),
    messages: z.array(MessageSchema),
    contactCreationTrigger: ContactCreationTriggerSchema,
    contactDefaultOwnerIds: z.array(z.string()),
    contactDefaults: z.record(z.string(), z.unknown()),
    activatedAt: z.iso.datetime().nullable(),
    completedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
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
  })
  .openapi("CreateProject");

const UpdateProjectBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    stages: z.array(StageSchema).optional(),
    accountsMode: AccountsModeSchema.optional(),
    accountsSelected: z.array(z.string()).optional(),
    messages: z.array(MessageSchema).optional(),
    contactCreationTrigger: ContactCreationTriggerSchema.optional(),
    contactDefaultOwnerIds: z.array(z.string()).optional(),
    contactDefaults: z.record(z.string(), z.unknown()).optional(),
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
    phone: z.string().nullable(),
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
    const rows = await db
      .select()
      .from(projects)
      .where(projectAccessClause(wsId, userId, role))
      .orderBy(asc(projects.createdAt));
    return c.json(rows.map(serializeProject));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects",
    tags: ["outreach"],
    middleware: [assertRole("admin")] as const,
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

    const [row] = await db
      .insert(projects)
      .values({
        workspaceId: wsId,
        trackId: body.trackId,
        name: body.name,
        stages: initialStages,
        messages: initialMessages,
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
    middleware: [assertRole("admin")] as const,
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
          "contactCreationTrigger",
          "contactDefaultOwnerIds",
          "contactDefaults",
        ]),
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
    middleware: [assertRole("admin")] as const,
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
    middleware: [assertRole("admin")] as const,
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

    // Аккаунты: фильтр по mode + статус active. Banned/frozen/unauthorized/offline
    // сейчас не должен использоваться worker'ом. UI юзеру при selected'е не даст
    // выбрать неактивные, но прийти могут устаревшие IDs — отфильтруем здесь.
    const accountRows = await db
      .select({ id: outreachAccounts.id })
      .from(outreachAccounts)
      .where(
        and(
          eq(outreachAccounts.workspaceId, wsId),
          eq(outreachAccounts.status, "active"),
        ),
      );
    const accountIds =
      project.accountsMode === "all"
        ? accountRows.map((a) => a.id)
        : accountRows
            .map((a) => a.id)
            .filter((id) => project.accountsSelected.includes(id));
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
    // Defense-in-depth: identity-приоритет username > phone. Один и тот же
    // TG-юзер не должен получить N сообщений из-за того, что в CSV у него
    // были разные форматы phone-колонки.
    const seen = new Set<string>();
    const leads: typeof allLeads = [];
    for (const l of allLeads) {
      const key = l.username
        ? `u:${l.username.toLowerCase()}`
        : `p:${l.phone ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      leads.push(l);
    }

    const activatedAt = new Date();
    // Для каждого message i: cumulativeOffsetMs = сумма delays[0..i] в ms.
    // delay у первого сообщения (idx=0) — это пауза от момента активации.
    const offsetsMs = cumulativeOffsetsMs(project.messages);

    // Sticky lead → account: «с каким аккаунтом блогер общался, с тем и
    // продолжает». Round-robin — только для новых лидов без истории.
    //
    // Источники в порядке приоритета:
    //   1. contacts.primary_account_id — first-write-wins sticky на уровне
    //      контакта (заполняется при импорте DM, первой исходящей и первом
    //      входящем; см. schema.ts contacts.primaryAccountId).
    //   2. scheduledMessages — legacy путь по последнему sent. Закрывает
    //      аккаунты, у которых ещё нет contact-записи (TG-юзер только
    //      получил холодную, не ответил, не импортировался).
    const tgUserIds = leads
      .map((l) => l.tgUserId)
      .filter((x): x is string => x !== null);
    const priorByTgUserId = await resolveStickyByTgUserIds(wsId, tgUserIds);

    // Warm-set для альтернативного текста первого сообщения: peer
    // отвечал нам хоть раз через любой аккаунт воркспейса
    // (tg_chats.has_inbound=true). Один запрос на батч.
    const warmTgUserIds = new Set<string>();
    if (tgUserIds.length > 0) {
      const warmRows = await db
        .selectDistinct({ peerUserId: tgChats.peerUserId })
        .from(tgChats)
        .innerJoin(outreachAccounts, eq(tgChats.accountId, outreachAccounts.id))
        .where(
          and(
            eq(outreachAccounts.workspaceId, wsId),
            eq(tgChats.hasInbound, true),
            inArray(tgChats.peerUserId, tgUserIds),
          ),
        );
      for (const r of warmRows) warmTgUserIds.add(r.peerUserId);
    }

    const remaining = tgUserIds.filter((id) => !priorByTgUserId.has(id));
    if (remaining.length > 0) {
      // DISTINCT ON (tg_user_id) ORDER BY tg_user_id, sentAt DESC — отдаёт
      // последний sent для каждого tg-юзера одним проходом, без JS first-wins.
      const priors = await db
        .selectDistinctOn([projectItems.tgUserId], {
          tgUserId: projectItems.tgUserId,
          accountId: scheduledMessages.accountId,
        })
        .from(scheduledMessages)
        .innerJoin(
          projectItems,
          eq(scheduledMessages.itemId, projectItems.id),
        )
        .where(
          and(
            eq(scheduledMessages.workspaceId, wsId),
            eq(scheduledMessages.status, "sent"),
            inArray(projectItems.tgUserId, remaining),
          ),
        )
        .orderBy(projectItems.tgUserId, desc(scheduledMessages.sentAt));
      for (const p of priors) {
        if (p.tgUserId) priorByTgUserId.set(p.tgUserId, p.accountId);
      }
    }

    let rrIdx = 0;
    const rows = leads.flatMap((lead) => {
      const prior = lead.tgUserId
        ? priorByTgUserId.get(lead.tgUserId)
        : undefined;
      const accountId = prior ?? accountIds[rrIdx % accountIds.length]!;
      if (!prior) rrIdx++;
      const isWarm = lead.tgUserId
        ? warmTgUserIds.has(lead.tgUserId)
        : false;
      return project.messages.map((msg, msgIdx) => {
        // Warm-альтернатива применяется только к первому сообщению (idx=0)
        // и только если в шаблоне реально что-то набито (пустая строка ≠
        // «использовать warm»). Остальные шаги всегда text.
        const warmText = msg.warmText?.trim();
        const template =
          msgIdx === 0 && isWarm && warmText ? warmText : msg.text;
        return {
          workspaceId: wsId,
          projectId: project.id,
          itemId: lead.id,
          accountId,
          messageIdx: msgIdx,
          text: substituteVariables(template, {
            username: lead.username,
            phone: lead.phone,
            properties: lead.properties,
          }),
          sendAt: new Date(activatedAt.getTime() + offsetsMs[msgIdx]!),
        };
      });
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
    middleware: [assertRole("admin")] as const,
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
    middleware: [assertRole("admin")] as const,
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

    // repliedAgg + leadRows независимы — параллелим. repliedCount по всему
    // списку (не пагинированному) для шапки «N ответили из M».
    const [repliedCount, leadRows] = await Promise.all([
      db.$count(
        projectItems,
        and(
          eq(projectItems.projectId, project.id),
          isNotNull(projectItems.repliedAt),
        ),
      ),
      db
        .select({
          id: projectItems.id,
          username: projectItems.username,
          phone: projectItems.phone,
          tgUserId: projectItems.tgUserId,
          properties: projectItems.properties,
          repliedAt: projectItems.repliedAt,
          contactId: projectItems.contactId,
          stageId: projectItems.stageId,
          importId: projectItems.importId,
          total: sql<number>`count(*) OVER ()::int`,
        })
        .from(projectItems)
        .where(eq(projectItems.projectId, project.id))
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
            tgUsername: outreachAccounts.tgUsername,
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
          phone: l.phone,
          tgUserId: l.tgUserId,
          properties: l.properties,
          account,
          accountSource,
          messages,
          repliedAt: l.repliedAt?.toISOString() ?? null,
          contactId: l.contactId,
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
    phone: z.string().nullable(),
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
        phone: projectItems.phone,
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
      phone: row.phone,
      properties: row.properties,
    });
  },
);

// Sticky-резолвер: для набора tg_user_id возвращает Map → primary_account_id
// из contacts. Используется в /activate (резолв sticky перед round-robin) и
// в /leads (sticky-предсказание для draft-sequence — UI должен совпадать с
// фактическим распределением на activate).
async function resolveStickyByTgUserIds(
  wsId: string,
  tgUserIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (tgUserIds.length === 0) return map;
  const rows = await db
    .select({
      tgUserId: contactTgUserIdSql,
      accountId: contacts.primaryAccountId,
    })
    .from(contacts)
    .where(
      and(
        eq(contacts.workspaceId, wsId),
        isNotNull(contacts.primaryAccountId),
        inArray(contactTgUserIdSql, tgUserIds),
      ),
    );
  for (const r of rows) {
    if (r.tgUserId && r.accountId) map.set(r.tgUserId, r.accountId);
  }
  return map;
}


function serializeProject(row: typeof projects.$inferSelect) {
  return {
    id: row.id,
    trackId: row.trackId,
    name: row.name,
    status: row.status,
    stages: row.stages,
    accountsMode: row.accountsMode,
    accountsSelected: row.accountsSelected,
    messages: row.messages,
    contactCreationTrigger: row.contactCreationTrigger,
    contactDefaultOwnerIds: row.contactDefaultOwnerIds,
    contactDefaults: row.contactDefaults,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function cumulativeOffsetsMs(messages: ProjectMessage[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const m of messages) {
    acc += delayToMs(m.delay);
    out.push(acc);
  }
  return out;
}

function delayToMs(delay: { period: string; value: number }): number {
  const v = delay.value;
  switch (delay.period) {
    case "minutes":
      return v * 60_000;
    case "hours":
      return v * 3_600_000;
    case "days":
      return v * 86_400_000;
    default:
      return 0;
  }
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
