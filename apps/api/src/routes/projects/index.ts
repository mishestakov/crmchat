// Проекты: CRUD (list/create/get/patch/delete). Глобальный порядок регистрации
// роутов = порядок paths в openapi.json — сабапы (lifecycle/leads/analytics)
// подключаются строго в конце файла.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  DEFAULT_OUTREACH_STAGES,
  projects,
  stageTemplates,
  tracks,
  type ProjectStage,
} from "../../db/schema.ts";
import { pickDefined } from "../../lib/pick-defined.ts";
import { myAccountIdsSql } from "../../lib/outreach-access.ts";
import {
  assertProjectAccess,
  projectAccessClause,
} from "../../lib/projects-access.ts";
import { type WorkspaceVars } from "../../middleware/assert-member.ts";
import {
  AccountsModeSchema,
  OpenerSchema,
  PhaseSchema,
  ProjectSchema,
  StageSchema,
  WsProjectParam,
  serializeProject,
} from "./shared.ts";
import lifecycleApp from "./lifecycle.ts";
import leadsApp from "./leads.ts";
import analyticsApp from "./analytics.ts";

// Outreach-проект: рассылка по одному списку с N сообщениями и задержками.
// Активация = pre-schedule всех scheduled_messages с round-robin аккаунтом и
// snapshot'ом текста после {{}}-подстановок. Worker (фаза 3b) забирает pending
// scheduled_messages по sendAt + расписанию workspace.

const WsParam = z.object({ wsId: z.string().min(1).max(64) });

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
    // Ценовые настройки кампании (срез 3).
    akPercent: z.number().min(0).max(100).optional(),
    vatEnabled: z.boolean().optional(),
    vatRate: z.number().min(0).max(100).optional(),
    ordEnabled: z.boolean().optional(),
    splitEnabled: z.boolean().optional(),
  })
  .openapi("UpdateProject");

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
          // boolean-настройки цены — прямое копирование.
          "vatEnabled",
          "ordEnabled",
          "splitEnabled",
        ]),
        // numeric/timestamp требуют конверсии — pickDefined не годится.
        ...(body.budgetAmount !== undefined && {
          budgetAmount:
            body.budgetAmount === null ? null : String(body.budgetAmount),
        }),
        ...(body.akPercent !== undefined && {
          akPercent: String(body.akPercent),
        }),
        ...(body.vatRate !== undefined && {
          vatRate: String(body.vatRate),
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

// Склейка сабапов — порядок вызовов фиксирует порядок paths в openapi.json,
// не менять (контракт-дифф проверяется байт-в-байт).
app.route("/", lifecycleApp);
app.route("/", leadsApp);
app.route("/", analyticsApp);

export default app;
