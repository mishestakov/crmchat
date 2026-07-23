// Жизненный цикл проекта: readiness-чеклист, activate (pre-schedule рассылки),
// pause/resume/complete/archive/unfinalize.
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import {
  channels,
  projectItems,
  projects,
  scheduledMessages,
} from "../../db/schema.ts";
import { emitProjectChanged } from "../../lib/events.ts";
import { channelRknBlockedSql } from "../../lib/rkn-registry.ts";
import { autoAddressableSql, contactReadySql } from "../../lib/contact-sql.ts";
import { assertProjectAccess } from "../../lib/projects-access.ts";
import {
  countMaxLeadsAmong,
  isRknProbeEnabled,
  resolveProjectAccountIds,
  resolveProjectMaxAccountIds,
  scheduleLeads,
} from "../../lib/project-scheduling.ts";
import { type WorkspaceVars } from "../../middleware/assert-member.ts";
import { WsProjectParam, ProjectSchema, serializeProject } from "./shared.ts";

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

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
  manual: number;
  eligible: number;
}> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      noContact: sql<number>`(count(*) filter (where not ${contactReadySql}))::int`,
      // «Уже работает» больше не отбраковка (бейдж, не гейт) — из воронки убрано.
      noRkn: sql<number>`(count(*) filter (where ${contactReadySql} and ${channelRknBlockedSql}))::int`,
      // «Вручную» — готов (способ задан), но авто-опенер не уйдёт: личка
      // канала/группа/внешний способ без @username и max-пира. Отдельно от
      // eligible, чтобы «Готовы к отправке» не обещал отправку тем, кого
      // планировщик молча пропустит (prepareLeads гейтит по адресуемости).
      manual: sql<number>`(count(*) filter (where ${contactReadySql} and ${channelRknBlockedSql} is not true and not ${autoAddressableSql}))::int`,
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
  const manual = row?.manual ?? 0;
  // eligible = остаток партиции (корзины взаимоисключающие) — не отдельный
  // count-фильтр, чтобы не гонять EXISTS-предикаты лишний раз.
  return {
    total,
    noContact,
    noRkn,
    manual,
    eligible: total - noContact - noRkn - manual,
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
              // «Вручную» (личка канала/группа/внешний способ): готовы, но
              // авто-опенер им не уйдёт — менеджер пишет сам.
              leadsManual: z.number().int(),
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
    // Проверочный РКН-опенер задан → сегмент «нет РКН» уходит в рассылку (проб-
    // вопрос), а не откладывается: сворачиваем noRkn в eligible, иначе проект
    // только из no-РКН каналов был бы незапускаем (eligible=0).
    const rknProbe = isRknProbeEnabled(project.opener);
    return c.json({
      leadsTotal: readiness.total,
      leadsEligible: rknProbe
        ? readiness.eligible + readiness.noRkn
        : readiness.eligible,
      leadsNoContact: readiness.noContact,
      leadsNoRkn: rknProbe ? 0 : readiness.noRkn,
      leadsManual: readiness.manual,
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

export default app;
