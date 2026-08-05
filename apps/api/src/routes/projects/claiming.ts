// Закрепление лидов за менеджером (разбор неразобранных).
//
// Продуктовый смысл: база проекта разбирается поштучно, каждый менеджер со
// своей скоростью — раздачи поровну на старте нет, «хвостов» у отстающих не
// копится. Единица закрепления — КАНАЛ (строка проекта), как и вердикт
// квалификации: контакт на этапе разбора часто ещё не резолвнут, группировать
// по нему нельзя (у половины строк contact_id NULL). Защита от «двое пишут
// одному админу» — не жёсткая связка, а подсветка: бейджи «уже писали» и
// «админ у X» в очереди.
//
// Гонка «двое взяли верхнего» решается на уровне БД: пачка забирается одним
// UPDATE по подзапросу с FOR UPDATE SKIP LOCKED — конкурирующие клики
// разбирают очередь без дублей и без ожидания чужих локов.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { projectItems, projects, users } from "../../db/schema.ts";
import { userDisplayNameSql } from "../../lib/contact-sql.ts";
import { isCrmEnabled } from "../../lib/crm-client.ts";
import { pullCrmDelta } from "../../lib/crm-pull.ts";
import { emitProjectChanged } from "../../lib/events.ts";
import { assertProjectAccess } from "../../lib/projects-access.ts";
import { type WorkspaceVars } from "../../middleware/assert-member.ts";
import { WsProjectParam, WsProjectItemParam } from "./shared.ts";

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

const ClaimResultSchema = z
  .object({
    // Сколько каналов закрепили. 0 у claim-next = свободных больше нет.
    claimed: z.number().int(),
    itemIds: z.array(z.string()),
  })
  .openapi("LeadClaimResult");

// «Отщипнуть объём на день»: забор пачкой каналов.
const ClaimNextBody = z
  .object({ count: z.number().int().min(1).max(100).default(1) })
  .openapi("ClaimNextBody");

// Per-role видимости здесь сознательно НЕТ: разбор — общий пул проекта,
// доступный всем его участникам. Фильтр по scheduled_messages (как memberFilter
// в /leads) для pending-лидов противоречив по построению — до вердикта
// отправок не существует, member не смог бы забрать ничего. Роли в разборе
// определим вместе с tenancy-реворком (workspace_members / owner-based RBAC).

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/claim-next",
    tags: ["outreach"],
    request: {
      params: WsProjectParam,
      body: {
        content: { "application/json": { schema: ClaimNextBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: ClaimResultSchema } },
        description: "Следующие свободные каналы закреплены за вызывающим",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const { projectId } = c.req.valid("param");
    const { count } = c.req.valid("json");
    await assertProjectAccess(projectId, wsId, userId, c.get("workspaceRole"));

    // Один set-based UPDATE: подзапрос выбирает первые по порядку заливки
    // свободные неразобранные строки (created_at — батч заливки; внутри батча
    // id — стабильный, но произвольный). Исключённые из рассылки (skipped)
    // не раздаём — разбирать канал, которому не напишем, трата времени.
    // SKIP LOCKED: параллельный клик другого менеджера не ждёт и не
    // дублирует — просто берёт следующие.
    const picked = db
      .select({ id: projectItems.id })
      .from(projectItems)
      .where(
        and(
          eq(projectItems.projectId, projectId),
          eq(projectItems.qualification, "pending"),
          isNull(projectItems.assignedTo),
          isNull(projectItems.skippedAt),
        ),
      )
      .orderBy(asc(projectItems.createdAt), asc(projectItems.id))
      .limit(count)
      .for("update", { skipLocked: true });

    const rows = await db
      .update(projectItems)
      .set({ assignedTo: userId, assignedAt: new Date() })
      .where(inArray(projectItems.id, picked))
      .returning({ id: projectItems.id });

    if (rows.length > 0) emitProjectChanged(projectId);
    return c.json({ claimed: rows.length, itemIds: rows.map((r) => r.id) });
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/claim",
    tags: ["outreach"],
    request: { params: WsProjectItemParam },
    responses: {
      200: {
        content: { "application/json": { schema: ClaimResultSchema } },
        description: "Канал закреплён за вызывающим",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const { projectId, itemId } = c.req.valid("param");
    await assertProjectAccess(projectId, wsId, userId, c.get("workspaceRole"));

    const rows = await db
      .update(projectItems)
      .set({ assignedTo: userId, assignedAt: new Date() })
      .where(
        and(
          eq(projectItems.id, itemId),
          eq(projectItems.projectId, projectId),
          eq(projectItems.qualification, "pending"),
          isNull(projectItems.assignedTo),
          isNull(projectItems.skippedAt),
        ),
      )
      .returning({ id: projectItems.id });
    if (rows.length > 0) {
      emitProjectChanged(projectId);
      return c.json({ claimed: 1, itemIds: [itemId] });
    }

    // Не забрали — говорим честно почему: занят (кем) / уже разобран / нет.
    const [row] = await db
      .select({
        qualification: projectItems.qualification,
        // NULL — строка свободна (значит, не взялась из-за skipped). Имя — по
        // общему правилу userDisplayNameSql; «занимается null» не показываем.
        holder: sql<string | null>`CASE
          WHEN ${projectItems.assignedTo} IS NULL THEN NULL
          ELSE coalesce(${userDisplayNameSql}, 'другой менеджер')
        END`,
      })
      .from(projectItems)
      .leftJoin(users, eq(users.id, projectItems.assignedTo))
      .where(
        and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "item not found" });
    throw new HTTPException(409, {
      message:
        row.qualification !== "pending"
          ? "Лид уже разобран"
          : row.holder
            ? `Только что забрал ${row.holder}`
            : "Канал исключён из рассылки",
    });
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/unclaim",
    tags: ["outreach"],
    request: { params: WsProjectItemParam },
    responses: {
      200: {
        content: { "application/json": { schema: ClaimResultSchema } },
        description: "Своё закрепление снято (только с неразобранного)",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const { projectId, itemId } = c.req.valid("param");
    await assertProjectAccess(projectId, wsId, userId, c.get("workspaceRole"));

    // Отпустить можно только СВОЁ и только неразобранное: по вынесенному
    // вердикту закрепление — уже факт «кто ведёт», его не снимаем.
    const rows = await db
      .update(projectItems)
      .set({ assignedTo: null, assignedAt: null })
      .where(
        and(
          eq(projectItems.id, itemId),
          eq(projectItems.projectId, projectId),
          eq(projectItems.assignedTo, userId),
          eq(projectItems.qualification, "pending"),
        ),
      )
      .returning({ id: projectItems.id });
    if (rows.length > 0) {
      emitProjectChanged(projectId);
      return c.json({ claimed: 1, itemIds: [itemId] });
    }

    // Ничего не сняли — объясняем почему, а не молчим 200-кой: пока менеджер
    // тянулся к «отпустить», коллега мог вынести вердикт (закрепление
    // переехало на него) — кнопка без объяснения выглядела бы сломанной.
    const [row] = await db
      .select({ qualification: projectItems.qualification })
      .from(projectItems)
      .where(
        and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "item not found" });
    throw new HTTPException(409, {
      message:
        row.qualification !== "pending"
          ? "Лид уже разобран — закрепление остаётся за автором вердикта"
          : "Лид уже не за вами",
    });
  },
);

// --- пулл лидов из корп-CRM -------------------------------------------------

const CrmPullResponse = z
  .object({
    seen: z.number().int(),
    created: z.number().int(),
    updated: z.number().int(),
    skippedNoLink: z.number().int(),
    failed: z.number().int(),
    // Дельта упёрлась в лимит CRM (1000) — есть недочитанное, нужен ещё клик.
    truncated: z.boolean(),
  })
  .openapi("CrmPullResult");

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/crm-pull",
    tags: ["outreach"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: { "application/json": { schema: CrmPullResponse } },
        description:
          "Дельта тикетов CRM с последней сверки подтянута в проект",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const { projectId } = c.req.valid("param");
    const project = await assertProjectAccess(
      projectId,
      wsId,
      userId,
      c.get("workspaceRole"),
    );
    if (!isCrmEnabled()) {
      throw new HTTPException(412, { message: "CRM не настроена (нет токена)" });
    }

    // Курсор двигаем на время НАЧАЛА пулла: изменения, случившиеся во время
    // прогона, попадут в следующую дельту (перекрытие безопасно — пулл
    // идемпотентен: известные тикеты обновляются, дубли не создаются).
    // При частичном провале (failed > 0: полный GET тикета упал) курсор НЕ
    // двигаем — иначе недочитанный тикет выпадает из дельты навсегда, а так
    // следующий клик перечитает то же окно (лишняя работа — только апдейты).
    // Обрезанная дельта (лимит CRM 1000, offset'а нет) — курсор только до
    // правого края ОБРАБОТАННОГО окна: прыжок на startedAt навсегда выкинул
    // бы всё за первой тысячей; так база дочитывается окнами, клик за кликом.
    const startedAt = new Date();
    const { maxModifiedOn, ...result } = await pullCrmDelta({
      wsId,
      projectId,
      userId,
      since: project.crmPulledAt,
    });
    const cursor = result.truncated ? maxModifiedOn : startedAt;
    if (result.failed === 0 && cursor) {
      await db
        .update(projects)
        .set({ crmPulledAt: cursor, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
    }

    if (result.created > 0 || result.updated > 0) emitProjectChanged(projectId);
    return c.json(result);
  },
);

export default app;
