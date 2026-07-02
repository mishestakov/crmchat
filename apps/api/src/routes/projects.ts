import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { streamSSENoBuffer } from "../lib/sse.ts";
import { and, asc, eq, gte, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  channels,
  contacts,
  DEFAULT_OUTREACH_STAGES,
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
  tgChats,
  tgUsers,
  type ProjectStage,
} from "../db/schema.ts";
import { pickDefined } from "../lib/pick-defined.ts";
import { emitProjectChanged, subscribeProject } from "../lib/events.ts";
import {
  myAccountIdsSql,
  workspaceAccountIdsSql,
} from "../lib/outreach-access.ts";
import { channelIsRknSql, channelRknBlockedSql } from "../lib/rkn-registry.ts";
import {
  fetchPlatformActivity,
  PlatformActivitySchema,
} from "../lib/platform-active.ts";
import { contactReadySql } from "../lib/contact-sql.ts";
import {
  assertProjectAccess,
  projectAccessClause,
} from "../lib/projects-access.ts";
import {
  armLeadDunning,
  channelIdentifier,
  countMaxLeadsAmong,
  disarmLeadDunning,
  resolveProjectAccountIds,
  resolveProjectMaxAccountIds,
  resolveStickyByTgUserIds,
  scheduleLeads,
  scheduleUnscheduledLeads,
} from "../lib/project-scheduling.ts";
import { canFillDunning, ChannelRelationStatusSchema } from "@repo/core";
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

// Форма рассылки: опенер (проектный, первое касание) + пиналка (на воркспейсе).
const VariantSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("text"), text: z.string().min(1).max(4000) }),
  z.object({
    kind: z.literal("sticker"),
    setName: z.string().min(1).max(64),
    uniqueId: z.string().min(1).max(64),
  }),
]);
const OpenerSchema = z.object({
  // Пустой text допустим (draft без опенера); непустоту требует гейт /activate.
  text: z.string().max(4000),
  warmText: z.string().max(4000).nullable().optional(),
});
// Экспортируется для workspaces.ts — пиналка живёт на воркспейсе (одна на все
// проекты). В проекте остаётся только опенер.
export const DunningSchema = z
  .object({
    pings: z.array(VariantSchema),
    intervals: z.array(DelaySchema),
  })
  // Пул должен покрывать каданс с чередованием текст/котик (раздельно, с
  // graceful-добором) — иначе серия выйдет короче. Пустой каданс валиден.
  .refine(
    (d) =>
      canFillDunning(
        d.pings.filter((p) => p.kind === "text").length,
        d.pings.filter((p) => p.kind === "sticker").length,
        d.intervals.length,
      ),
    { error: "Не хватает текстов/котиков на каданс пиналки", path: ["pings"] },
  );

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
    // Опенер — проектный (первое касание). Пиналка живёт на воркспейсе.
    // Пустой text = кампания ещё не готова к запуску.
    opener: OpenerSchema,
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
    // Есть ли среди лидов проекта диалог с ручной пометкой «непрочитано»
    // (contacts.marked_unread) — точка в сайдбаре при unreadCount=0.
    // Та же семантика «только в list», что у unreadCount.
    hasMarkedUnread: z.boolean(),
  })
  .openapi("Project");

const CreateProjectBody = z
  .object({
    trackId: z.string().min(1).max(64),
    name: z.string().min(1).max(200),
    // Опциональный stage_template — стадии скопируются из шаблона. Если
    // не передан, используется DEFAULT_OUTREACH_STAGES (4 стадии).
    templateId: z.string().min(1).max(64).optional(),
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
    // Опенер пишется редактором проекта напрямую. Пиналка — на воркспейсе.
    opener: OpenerSchema.optional(),
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
    // Заход пиналки (0 — холодный авто-догон; ручной взвод пишет 1,2…). Бейдж и
    // «серия отстреляла» считаются по последнему раунду (§1.2 bd-autodogon).
    dunningRound: z.number().int(),
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

// Состояние лида для триажа списка — единый источник правды, фронт только
// группирует в корзины (нужно действие / в работе / не отправляем). Дефолт —
// needs_review (нужно действие): всё, что не попало в явное «система работает»
// (in_flight) или явный терминал (excluded/blocked_rkn),
// поднимаем человеку, а не хороним в «не отправляем» и не прячем в «в работе».
// «Уже работает на платформе» НЕ гейтим (CPC/CPA-сигнал ненадёжен: админ мог
// смениться, у одного админа часть каналов активна) — это бейдж на лиде,
// менеджер решает сам (channel.platformActivity).
const OUTREACH_STATES = [
  "replied", // ответил — живёт на канбане, не в триаже списка
  "excluded", // менеджер исключил вручную (терминал) → не отправляем
  "blocked_rkn", // >10k и не в реестре РКН (авто-терминал) → не отправляем
  "no_contact", // нет годного контакта → нужно действие (резолвер)
  "bot_manual", // админ-бот → нужно действие (открыть + Запустить бота)
  "not_private", // контакт — канал/группа, не private user → нужно действие (заменить)
  "not_scheduled", // годен, но scheduled-строк нет → нужно действие (Дослать)
  "in_flight", // система работает: ушло/ждём, догон в очереди (без фейлов)
  "needs_review", // всё прочее (фейл доставки/непредвиденное) → нужно действие (разобраться)
] as const;
type OutreachState = (typeof OUTREACH_STATES)[number];

function deriveOutreachState(l: {
  repliedAt: Date | null;
  skippedAt: Date | null;
  contactReady: boolean | null;
  channelRknBlocked: boolean | null;
  adminIsBot: boolean | null;
  messages: { status: string; error: string | null }[];
}): OutreachState {
  if (l.repliedAt) return "replied";
  if (l.skippedAt) return "excluded";
  if (l.channelRknBlocked) return "blocked_rkn";
  if (!l.contactReady) return "no_contact";

  const failedErrors = l.messages
    .filter((m) => m.status === "failed")
    .map((m) => m.error ?? "");
  const botFailed = failedErrors.some((e) => /BOT_SKIPPED/i.test(e));
  const notPrivateFailed = failedErrors.some((e) => /NOT_PRIVATE/i.test(e));

  if (l.adminIsBot || botFailed) return "bot_manual";
  if (notPrivateFailed) return "not_private";
  if (l.messages.length === 0) return "not_scheduled";

  const hasFailed = failedErrors.length > 0;
  const hasLive = l.messages.some(
    (m) => m.status === "pending" || m.status === "sent",
  );
  // Чистый in-flight: система работает, фейлов в цепочке нет.
  if (!hasFailed && hasLive) return "in_flight";

  // Permanent-фейл доставки (privacy/blocked/deactivated), частично упавшая
  // цепочка, непредвиденное на масштабе — человеку на разбор, не авто-терминал.
  return "needs_review";
}

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
    // Прогресс по фактическим отправкам лида (опенер + пинги пиналки) из
    // scheduled_messages: messageIdx=0 — опенер, ≥1 — пинги.
    messages: z.array(LeadMessageProgressSchema),
    repliedAt: z.iso.datetime().nullable(),
    // «Уже общались» с этим админом-контактом — справочный сигнал (не гейт):
    // прочитать прошлую переписку перед новым опенером и, возможно, написать
    // иначе. Cross-project: считается по tg_chats пира (peerUserId) через
    // аккаунты воркспейса, а не по текущему проекту — то есть загорится и если
    // общались в другом проекте/у другого клиента. talked = мы когда-либо ему
    // писали (lastOutboundAt); replied = он хоть раз ответил (has_inbound). null
    // — у лида нет tgUserId (MAX/stub без @). Фронт: replied→«был диалог»,
    // talked && !replied→«писали, тишина».
    contactHistory: z
      .object({ talked: z.boolean(), replied: z.boolean() })
      .nullable(),
    // Последнее сообщение в диалоге (любой стороны) — с привязанного контакта.
    // Для подсветки «жёлтый» (§1.4 bd-autodogon): застой считается от последней
    // активности в треде, чтобы ловить и «он молчит нам», и «он написал, а мы
    // сутки не отвечаем». null для лидов без contactId — там застой считается по
    // нашим sentAt из messages[].
    lastMessageAt: z.iso.datetime().nullable(),
    contactId: z.string().nullable(),
    // Непрочитанные входящие — счётчик с прицепленного контакта (если есть).
    // Для лидов без contactId всегда 0. Бэйдж на канбане; синхронизация через
    // contact-stream SSE — листенер на /kanban апдейтит лидов с этим contactId.
    unreadCount: z.number().int(),
    // Ручная пометка «непрочитано» с контакта (chat-level флаг TG) — бэйдж-
    // точка на канбане при unreadCount=0.
    markedUnread: z.boolean(),
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
    // Готов ли канал к рассылке — тот же предикат, что гейт /activate
    // (contactReadySql). Фильтр/подсветка «без контакта» в draft-списке.
    contactReady: z.boolean(),
    // Исключён из авто-рассылки (POST /items/{id}/skip). Бейдж + «Вернуть».
    skippedAt: z.iso.datetime().nullable(),
    // Состояние для триажа списка (см. deriveOutreachState). Фронт группирует
    // в корзины: нужно действие / в работе / не отправляем.
    outreachState: z.enum(OUTREACH_STATES),
    // Канал размещения — получатель аутрича резолвится от его админа. null
    // быть не должно (айтем = placement), но left-join → nullable.
    channel: z
      .object({
        id: z.string(),
        title: z.string(),
        username: z.string().nullable(),
        link: z.string().nullable(),
        platform: z.string(),
        // РКН-индикация в списках лидов: memberCount > 10k и !isRkn —
        // красная тревога «Нет РКН».
        memberCount: z.number().int().nullable(),
        isRkn: z.boolean(),
        // Активность канала на рекл-платформах Яндекса (CPC/CPA): источники,
        // свежесть постов, здоровье. null — не нашли. Информ-сигнал для бейджа
        // (работает/простаивает/проблема + тултип), НЕ гейт.
        platformActivity: PlatformActivitySchema.nullable(),
        // Глобальный статус взаимодействия по каналу — для бейджа на карточке
        // доски. Лента истории доске не нужна (она в сайдбаре, из Contact).
        relationStatus: ChannelRelationStatusSchema,
      })
      .nullable(),
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
    const markedUnreadSql = sql<boolean>`EXISTS (
      SELECT 1 FROM project_items pi
      JOIN contacts c ON c.id = pi.contact_id
      WHERE pi.project_id = projects.id
        AND c.marked_unread
        AND ${memberFilter}
    )`;

    const rows = await db
      .select({
        row: projects,
        unread: unreadSql.as("unread_count"),
        markedUnread: markedUnreadSql.as("has_marked_unread"),
      })
      .from(projects)
      .where(
        and(
          projectAccessClause(wsId, userId, role),
          ne(projects.status, "archived"),
        ),
      )
      .orderBy(asc(projects.createdAt));
    return c.json(
      rows.map((r) => serializeProject(r.row, r.unread, r.markedUnread)),
    );
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

    const [row] = await db
      .insert(projects)
      .values({
        workspaceId: wsId,
        trackId: body.trackId,
        name: body.name,
        stages: initialStages,
        // Опенер набивается в редакторе проекта; на старте — пустой (default).
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
      body.opener !== undefined;
    if (touchedSnapshot && existing.status !== "draft") {
      throw new HTTPException(400, {
        message:
          "Name/accounts/opener can be edited only in draft. Use contact-settings fields anytime.",
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
          // Редактор проекта пишет опенер напрямую.
          "opener",
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

// Готовность канала к рассылке = опенер уйдёт по @username ИЛИ задан ручной
// способ связи (группа/бесплатная личка — менеджер пишет сам, не авто-цепочкой).
// Опенер уйдёт админу по placement.username — это РОВНО то, что планирует
// prepareLeads (получатель денормализован на размещение через
// resolveAdminRecipient/healPlacementRecipients). Не используем
// exists(channel_admins): админ может быть привязан, но без публичного
// @username — тогда scheduler его молча пропустит, а гейт бы пропустил как
// Гейт квалификации лонглиста — общий для BD и agency. Разбивает лонглист
// (shortlistedAt IS NULL; у BD шортлиста нет → фильтр no-op) на
// взаимоисключающие корзины (в сумме = total):
//   noContact — нет контакта (аутричу некуда слать); чинится резолвером;
//   working   — уже работает у нас на платформе (CPC/CPA) → не пере-питчим;
//   noRkn     — контакт есть, не работает, но канал не в реестре РКН (>10к);
//   eligible  — годен к рассылке (контакт И не работает И РКН-ок).
// Приоритет причины: контакт → «уже работает» → РКН (партнёра не трогаем
// раньше, чем легальность). Отказавшихся (available=false) не считаем.
// Используется сводкой запуска и чек-листом готовности (/readiness).
async function longlistContactReadiness(projectId: string): Promise<{
  total: number;
  noContact: number;
  noRkn: number;
  eligible: number;
}> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      noContact: sql<number>`(count(*) filter (where not ${contactReadySql}))::int`,
      // «Уже работает» больше не отбраковка (бейдж, не гейт) — из воронки убрано.
      noRkn: sql<number>`(count(*) filter (where ${contactReadySql} and ${channelRknBlockedSql}))::int`,
    })
    .from(projectItems)
    .leftJoin(channels, eq(channels.id, projectItems.channelId))
    .where(
      and(
        eq(projectItems.projectId, projectId),
        isNull(projectItems.shortlistedAt),
        sql`${projectItems.available} is distinct from false`,
      ),
    );
  const total = row?.total ?? 0;
  const noContact = row?.noContact ?? 0;
  const noRkn = row?.noRkn ?? 0;
  // eligible = остаток партиции (корзины взаимоисключающие) — не отдельный
  // count-фильтр, чтобы не гонять EXISTS-предикаты лишний раз.
  return {
    total,
    noContact,
    noRkn,
    eligible: total - noContact - noRkn,
  };
}

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/readiness",
    tags: ["outreach"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              // Лонглист целиком (shortlistedAt null, не отказ).
              leadsTotal: z.number().int(),
              // Корзины квалификации (взаимоисключающие, в сумме = leadsTotal).
              // eligible реально уйдёт в рассылку; noContact/noRkn — отбраковка.
              leadsEligible: z.number().int(),
              leadsNoContact: z.number().int(),
              leadsNoRkn: z.number().int(),
              // Активные аккаунты, доступные проекту (резолв общий с /activate).
              accountsCount: z.number().int(),
              // Готовность опенера тем же гейтом, что /activate (opener.text
              // непустой). Фронт берёт отсюда, а не считает сам — иначе
              // чек-лист дрейфует от реального гейта запуска.
              chainReady: z.boolean(),
            }),
          },
        },
        description: "Чек-лист готовности к запуску (draft)",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    const [readiness, accountIds] = await Promise.all([
      longlistContactReadiness(project.id),
      resolveProjectAccountIds(wsId, project),
    ]);
    return c.json({
      leadsTotal: readiness.total,
      leadsEligible: readiness.eligible,
      leadsNoContact: readiness.noContact,
      leadsNoRkn: readiness.noRkn,
      accountsCount: accountIds.length,
      chainReady: project.opener.text.trim().length > 0,
    });
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
    // Готовность к старту — по опенеру (первое холодное касание).
    if (!project.opener.text.trim()) {
      throw new HTTPException(400, { message: "Add an opener message" });
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

    // Гейт квалификации НЕ блокирует запуск: отбракованных (без контакта /
    // без РКН) не планируем, а откладываем — они видны во вкладке
    // «Отбракованные» и обратимы (нашёлся контакт / зарегали РКН → ручной
    // прогон по новым). Фильтр по контакту/РКН живёт в prepareLeads (единый
    // чокпоинт для активации, доливки и прогона). Фронт показывает сводку
    // «N из M, отложено K» перед запуском (см. LaunchPanel).
    //
    // Лонглист → scheduled-строки общим конвейером (дедуп по админу + синтез
    // канало-vars + sticky/warm). Только не отобранные в шортлист и не
    // отказавшиеся; already-contacted на первом запуске не пропускаем. У BD
    // шортлиста нет → shortlistedAt всегда null (фильтр no-op).
    const longlist = allLeads
      .filter((l) => l.shortlistedAt === null && l.available !== false)
      .map((l) => ({
        id: l.id,
        username: l.username,
        tgUserId: l.tgUserId,
        // contactId нужен MAX-пути: из контакта резолвится пир получателя.
        contactId: l.contactId,
        properties: (l.properties ?? {}) as Record<string, unknown>,
      }));
    const activatedAt = new Date();
    const rows = await scheduleLeads({
      wsId,
      project,
      accountIds,
      leads: longlist,
      baseTime: activatedAt,
      skipContacted: false,
    });
    if (rows.length === 0) {
      // Частый edge-кейс: лиды есть, но это MAX-получатели, а активного
      // MAX-аккаунта в воркспейсе нет — каданс им не уходит. Сообщаем явно
      // (иначе менеджер видит «нет годных каналов» и не понимает причину).
      const maxAccounts = await resolveProjectMaxAccountIds(wsId, project);
      if (maxAccounts.length === 0) {
        const maxLeads = await countMaxLeadsAmong(longlist.map((l) => l.id));
        if (maxLeads > 0) {
          throw new HTTPException(400, {
            message: `Не запущено: ${maxLeads} получатель(ей) в MAX, но нет активного MAX-аккаунта. Подключите MAX-аккаунт и запустите снова.`,
          });
        }
      }
      throw new HTTPException(400, {
        message:
          "Нет годных каналов для запуска: все отбракованы (нет контакта или нет регистрации в РКН).",
      });
    }

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

    // Агрегаты + leadRows независимы — параллелим. repliedCount по всему
    // списку (не пагинированному) — для шапки «N ответили из M».
    const [repliedCount, leadRows] =
      await Promise.all([
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
          markedUnread: sql<boolean>`coalesce(${contacts.markedUnread}, false)`,
          // «Последнее сообщение в треде» в ЛЮБУЮ сторону — для подсветки застоя
          // («затихло N дней»). contacts.last_message_at двигается только на
          // входящем (его семантику менять нельзя — scheduling берёт его как
          // «последний ответ»), поэтому наше исходящее (включая РУЧНОЕ из чата)
          // подмешиваем из tg_chats: max(last_message_at, last_outbound_at) по
          // всем нашим аккаунтам, общавшимся с этим пиром. greatest игнорит NULL.
          // TODO(multi-member): входящее тут воркспейс-глобальное, а исходящее
          // скоупится к аккаунтам смотрящего (myAccountIdsSql). Пока tenancy
          // single-owner — это одно и то же. Когда появятся роли/мемберы, админ,
          // смотрящий лид мембера, не увидит исходящее мембера → ложное «затихло».
          // Тогда скоупить субквери на аккаунты ВОРКСПЕЙСА, а не смотрящего.
          // .mapWith(contacts.lastMessageAt): drizzle применяет timestamp-декодер
          // (строка драйвера → Date) только к КОЛОНКАМ, к сырому sql-выражению —
          // нет. Без этого greatest(...) приходит строкой и .toISOString() ниже
          // падает 500. Переиспользуем декодер самой колонки.
          lastMessageAt: sql<Date | null>`greatest(
            ${contacts.lastMessageAt},
            (select max(greatest(${tgChats.lastMessageAt}, ${tgChats.lastOutboundAt}))
             from ${tgChats}
             where ${tgChats.peerUserId} = ${projectItems.tgUserId}
               and ${tgChats.accountId} in ${myAccountIdsSql(wsId, userId)})
          )`.mapWith(contacts.lastMessageAt),
          // «Уже общались» — cross-project сигнал по пиру (tg_chats). Скоуп —
          // ВЕСЬ workspace (workspaceAccountIdsSql), а НЕ myAccountIdsSql как у
          // lastMessageAt выше: это командный сигнал «кто-либо из нас уже писал
          // этому контакту», совпадает с joinAdmins в channels.ts. При
          // single-owner скоупы идентичны; расходятся при делегациях/мультиюзере,
          // и тогда правильно видеть переписку коллег (иначе шлём второй холодный
          // опенер уже прогретому контакту). talked/replied — раздельные exists,
          // чтобы различать тир «писали, тишина» и «был диалог» (joinAdmins берёт
          // только has_inbound).
          alreadyTalked: sql<boolean>`exists (
            select 1 from ${tgChats}
            where ${tgChats.peerUserId} = ${projectItems.tgUserId}
              and ${tgChats.accountId} in ${workspaceAccountIdsSql(wsId)}
              and ${tgChats.lastOutboundAt} is not null)`,
          alreadyReplied: sql<boolean>`exists (
            select 1 from ${tgChats}
            where ${tgChats.peerUserId} = ${projectItems.tgUserId}
              and ${tgChats.accountId} in ${workspaceAccountIdsSql(wsId)}
              and ${tgChats.hasInbound} = true)`,
          nextStep: nextStepSql,
          stageId: projectItems.stageId,
          skippedAt: projectItems.skippedAt,
          channelId: channels.id,
          channelTitle: channels.title,
          channelUsername: channels.username,
          channelLink: channels.link,
          channelPlatform: channels.platform,
          channelMemberCount: channels.memberCount,
          channelRelationStatus: channels.relationStatus,
          channelIsRkn: channelIsRknSql,
          channelRknBlocked: channelRknBlockedSql,
          contactReady: contactReadySql,
          // Админ-получатель — бот: авторитетный сигнал tg_users.is_bot
          // (userTypeBot), для гейта «ручной способ» в триаже списка.
          adminIsBot: sql<boolean>`coalesce(${tgUsers.isBot}, false)`,
          total: sql<number>`count(*) OVER ()::int`,
        })
        .from(projectItems)
        .leftJoin(contacts, eq(contacts.id, projectItems.contactId))
        .leftJoin(channels, eq(channels.id, projectItems.channelId))
        .leftJoin(tgUsers, eq(tgUsers.userId, projectItems.tgUserId))
        .where(and(eq(projectItems.projectId, project.id), memberFilter))
        .orderBy(asc(projectItems.createdAt))
        .limit(limit)
        .offset(offset),
    ]);

    if (leadRows.length === 0) {
      return c.json({
        total: 0,
        repliedCount,
        leads: [],
      });
    }

    // Две независимые выборки по leadRows — параллельно (обе стартуют после
    // страницы лидов, друг от друга не зависят).
    //  • activityByChannel — активность на рекл-платформах (CPC/CPA), set-based
    //    для каналов страницы (см. fetchPlatformActivity).
    //  • sched — scheduled_messages этих лидов; sentAt/readAt/error нужны
    //    UI-таблице (донор-style), accountId — через какой аккаунт рассылается.
    const [activityByChannel, sched] = await Promise.all([
      fetchPlatformActivity([
        ...new Set(
          leadRows
            .map((l) => l.channelId)
            .filter((id): id is string => id !== null),
        ),
      ]),
      db
        .select({
          itemId: scheduledMessages.itemId,
          accountId: scheduledMessages.accountId,
          messageIdx: scheduledMessages.messageIdx,
          dunningRound: scheduledMessages.dunningRound,
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
        ),
    ]);

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
            dunningRound: s.dunningRound,
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
          contactHistory: l.tgUserId
            ? { talked: l.alreadyTalked, replied: l.alreadyReplied }
            : null,
          lastMessageAt: l.lastMessageAt?.toISOString() ?? null,
          contactId: l.contactId,
          unreadCount: l.unreadCount,
          markedUnread: l.markedUnread,
          nextStep: l.nextStep,
          stageId: l.stageId,
          contactReady: l.contactReady,
          skippedAt: l.skippedAt?.toISOString() ?? null,
          outreachState: deriveOutreachState({
            repliedAt: l.repliedAt,
            skippedAt: l.skippedAt,
            contactReady: l.contactReady,
            channelRknBlocked: l.channelRknBlocked,
            adminIsBot: l.adminIsBot,
            messages,
          }),
          channel: l.channelId
            ? {
                id: l.channelId,
                title: l.channelTitle ?? "",
                username: l.channelUsername,
                link: l.channelLink,
                platform: l.channelPlatform ?? "telegram",
                memberCount: l.channelMemberCount,
                isRkn: l.channelIsRkn ?? false,
                platformActivity: activityByChannel.get(l.channelId) ?? null,
                relationStatus: l.channelRelationStatus ?? "none",
              }
            : null,
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

// Исключение лида из авто-рассылки в идущем проекте — точечный стоп-кран
// вместо паузы всей кампании (в draft лида просто удаляют). Pending-строки
// удаляем (не cancel): лид возвращается в «незапланированное» состояние, и
// «Вернуть в рассылку» / явный запуск работают тем же путём, что доливка,
// без дублей (item, msg_idx). Уже отправленное (sent) не трогаем — история.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/skip",
    tags: ["outreach"],
    request: {
      params: WsProjectParam.extend({ itemId: z.string().min(1).max(64) }),
    },
    responses: { 204: { description: "Skipped" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, itemId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    if (project.status !== "active" && project.status !== "paused") {
      throw new HTTPException(400, {
        message: "Исключать из рассылки можно только в запущенном проекте",
      });
    }
    const result = await db
      .update(projectItems)
      .set({ skippedAt: new Date() })
      .where(
        and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)),
      )
      .returning({ id: projectItems.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "item not found" });
    }
    await db
      .delete(scheduledMessages)
      .where(
        and(
          eq(scheduledMessages.itemId, itemId),
          eq(scheduledMessages.status, "pending"),
        ),
      );
    emitProjectChanged(projectId);
    return c.body(null, 204);
  },
);

// Возврат скипнутого лида в рассылку. Если рассылка по списку ещё идёт
// (горячо) и цепочка лида не начата — опенер сразу встаёт в очередь; если
// список отыгран (холодно) — лид попадает под баннер «Запустить рассылку
// по новым» (то же правило, что у доливки).
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/unskip",
    tags: ["outreach"],
    request: {
      params: WsProjectParam.extend({ itemId: z.string().min(1).max(64) }),
    },
    responses: { 204: { description: "Unskipped" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, itemId } = c.req.valid("param");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    const result = await db
      .update(projectItems)
      .set({ skippedAt: null })
      .where(
        and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)),
      )
      .returning({ id: projectItems.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "item not found" });
    }
    if (project.status === "active" || project.status === "paused") {
      // model A: вернул лида в рассылку → опенер планируется сразу, без
      // холодного гейта (раньше требовался hasPendingOpeners).
      await scheduleUnscheduledLeads({ project, itemId });
    }
    emitProjectChanged(projectId);
    return c.body(null, 204);
  },
);

// Ручной вкл/выкл пиналки на лиде (этап C, кнопка в чате). Пиналка — режим
// on/off: «вкл» планирует новый заход серии пингов (round=max+1, первый пинг от
// последней активности), «выкл» гасит pending текущего захода. Доступно как раз
// для ответивших-и-замолчавших — менеджер видит переписку и решает допинать.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/dunning",
    tags: ["outreach"],
    request: {
      params: WsProjectParam.extend({ itemId: z.string().min(1).max(64) }),
      body: {
        content: {
          "application/json": {
            schema: z.object({ enabled: z.boolean() }).openapi("ToggleDunning"),
          },
        },
      },
    },
    responses: { 204: { description: "Toggled" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, itemId } = c.req.valid("param");
    const { enabled } = c.req.valid("json");
    const project = await assertProjectAccess(projectId, wsId, userId, role);
    if (project.status !== "active" && project.status !== "paused") {
      throw new HTTPException(400, {
        message: "Пиналку можно вкл/выкл только в запущенном проекте",
      });
    }
    // Скоуп: item должен принадлежать ЭТОМУ проекту. assertProjectAccess
    // проверяет только projectId из URL — без этой проверки по доступу к своему
    // проекту можно было бы взвести/погасить пиналку на чужом лиде (IDOR).
    const [item] = await db
      .select({ id: projectItems.id })
      .from(projectItems)
      .where(
        and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)),
      )
      .limit(1);
    if (!item) throw new HTTPException(404, { message: "item not found" });

    if (enabled) {
      const result = await armLeadDunning(itemId);
      if (result === "empty") {
        throw new HTTPException(400, {
          message: "Пиналка не настроена или нет истории отправок по лиду",
        });
      }
    } else {
      await disarmLeadDunning(itemId);
    }
    emitProjectChanged(projectId);
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
        channelTitle: channels.title,
        channelUsername: channels.username,
        channelLink: channels.link,
        channelPlatform: channels.platform,
      })
      .from(projectItems)
      .leftJoin(channels, eq(channels.id, projectItems.channelId))
      .where(eq(projectItems.projectId, project.id))
      .limit(1)
      .offset(Math.floor(Math.random() * cnt));
    if (!row) return c.json(null);
    // Дешёвое превью: канало-переменные синтезируем инлайн из канала сэмпла
    // (тем же channelIdentifier, что и prepareLeads). Это приближение —
    // {{каналы}} тут = один канал сэмпла, а при реальной отправке = склейка всех
    // каналов админа; для превью «как примерно будет» этого достаточно, без
    // лишних запросов prepareLeads на каждый клик «Другой лид».
    const channelVars: Record<string, string> = {};
    if (row.channelPlatform) {
      const { ident, link } = channelIdentifier({
        platform: row.channelPlatform,
        username: row.channelUsername,
        title: row.channelTitle,
        link: row.channelLink,
      });
      channelVars.каналы = ident;
      channelVars.канал = row.channelTitle ?? ident;
      if (link) channelVars.ссылка = link;
    }
    return c.json({
      id: row.id,
      username: row.username,
      properties: { ...row.properties, ...channelVars },
    });
  },
);

function serializeProject(
  row: typeof projects.$inferSelect,
  unreadCount = 0,
  hasMarkedUnread = false,
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
    opener: row.opener,
    activatedAt: row.activatedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    clientFinalizedAt: row.clientFinalizedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    unreadCount,
    hasMarkedUnread,
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

    return streamSSENoBuffer(c, async (stream) => {
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
