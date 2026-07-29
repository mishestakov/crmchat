// Квалификация лида + зеркалирование в корп-CRM Яндекса.
//
// Продуктовый смысл: до вердикта опенер не уходит. Раньше лид с найденным
// контактом сразу прыгал в рассылку, минуя оценку качества (накрутки, тематика,
// фрод) — этот шаг делает её явной. Вердикт же заводит тикет в CRM: «Годен» →
// Валидирован, «Дисквалификация» → одноимённый статус с причиной.
//
// Пишем в CRM синхронно, без очереди и воркера (MVP, см. specs/crm-integration.md):
// вызов ~300 мс, CRM внутренняя. Если не дошло — вердикт всё равно сохранён
// локально, ошибка лежит в crm_sync_error, а UI показывает «повторить».
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, eq, ne, sql } from "drizzle-orm";
import {
  CRM_DISQUALIFY_REASONS,
  CRM_STATE,
  CRM_STATE_NAME,
  crmResolutionName,
  crmTransitionOptions,
  parseCrmTransitionId,
} from "@repo/core";
import { db } from "../../db/client.ts";
import {
  channelAdmins,
  channels,
  contacts,
  projectItems,
  projects,
  users,
} from "../../db/schema.ts";
import { channelIsRknSql } from "../../lib/rkn-registry.ts";
import { assertProjectAccess } from "../../lib/projects-access.ts";
import {
  createIssue,
  executeTransition,
  getTransitions,
  isCrmEnabled,
} from "../../lib/crm-client.ts";
import { errMsg } from "../../lib/errors.ts";
import { buildIssueName, buildIssueText } from "../../lib/crm-issue-text.ts";
import { type WorkspaceVars } from "../../middleware/assert-member.ts";
import { WsProjectItemParam } from "./shared.ts";

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

const CrmStateSchema = z
  .object({
    issueId: z.number().int().nullable(),
    stateId: z.number().int().nullable(),
    stateName: z.string().nullable(),
    resolutionName: z.string().nullable(),
    syncedAt: z.iso.datetime().nullable(),
    syncError: z.string().nullable(),
  })
  .openapi("LeadCrmState");

const WEB_ORIGIN = (process.env.WEB_ORIGIN ?? "").replace(/\/$/, "");

// --- сбор данных для описания тикета ---------------------------------------

async function loadIssueInput(wsId: string, projectId: string, itemId: string) {
  const [row] = await db
    .select({
      itemId: projectItems.id,
      createdAt: projectItems.createdAt,
      crmIssueId: projectItems.crmIssueId,
      contactId: projectItems.contactId,
      channelId: projectItems.channelId,
      projectName: projects.name,
      channelTitle: channels.title,
      channelMembers: channels.memberCount,
      channelLink: channels.link,
      channelExternalId: channels.externalId,
      channelPlatform: channels.platform,
      channelRelation: channels.relationStatus,
      channelIsRkn: channelIsRknSql,
      contactProps: contacts.properties,
      contactNote: contacts.note,
    })
    .from(projectItems)
    .innerJoin(projects, eq(projects.id, projectItems.projectId))
    .leftJoin(channels, eq(channels.id, projectItems.channelId))
    .leftJoin(contacts, eq(contacts.id, projectItems.contactId))
    .where(
      and(
        eq(projectItems.id, itemId),
        eq(projectItems.projectId, projectId),
        eq(projectItems.workspaceId, wsId),
      ),
    )
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "item not found" });
  return row;
}

// Остальные каналы того же админа — в CRM тикет заведён на канал, и без этого
// блока не видно, что за одним человеком их несколько.
async function loadOtherChannels(
  contactId: string | null,
  exceptChannelId: string | null,
): Promise<{ title: string; memberCount: number | null }[]> {
  if (!contactId) return [];
  return db
    .select({ title: channels.title, memberCount: channels.memberCount })
    .from(channelAdmins)
    .innerJoin(channels, eq(channels.id, channelAdmins.channelId))
    .where(
      and(
        eq(channelAdmins.contactId, contactId),
        exceptChannelId ? ne(channels.id, exceptChannelId) : sql`true`,
      ),
    )
    .limit(20);
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** Создаёт тикет и доводит его до целевого статуса.
 *
 *  Три вызова: create (тикет рождается в «Открыт») → «В работу» → цель. Прыгать
 *  сразу в цель API позволяет, но мы этого не делаем: интерфейс CRM так не
 *  умеет, а пропуск «В работе» ломает их счётчики воронки. */
async function pushToCrm(args: {
  wsId: string;
  projectId: string;
  itemId: string;
  ownerLogin: string;
  targetTransitionId: string;
}): Promise<void> {
  const row = await loadIssueInput(args.wsId, args.projectId, args.itemId);
  const props = (row.contactProps ?? {}) as Record<string, unknown>;

  let issueId = row.crmIssueId;
  if (issueId === null) {
    const others = await loadOtherChannels(row.contactId, row.channelId);
    const text = buildIssueText({
      loadedAt: row.createdAt,
      channel: {
        title: row.channelTitle ?? "",
        memberCount: row.channelMembers,
        link: row.channelLink,
        externalId: row.channelExternalId,
        platform: row.channelPlatform ?? "telegram",
        relationStatus: row.channelRelation,
        isRkn: row.channelIsRkn ?? null,
      },
      admin: row.contactId
        ? {
            fullName: str(props.full_name),
            username: str(props.telegram_username),
            phone: str(props.phone),
            email: str(props.email),
            note: row.contactNote?.text ?? null,
          }
        : null,
      otherChannels: others,
      project: { name: row.projectName },
      leadUrl: WEB_ORIGIN
        ? `${WEB_ORIGIN}/w/${args.wsId}/projects/${args.projectId}/leads?lead=${args.itemId}`
        : null,
    });
    const created = await createIssue({
      name: buildIssueName(row.channelTitle ?? ""),
      text,
      ownerLogin: args.ownerLogin,
    });
    issueId = created.id;
    // Пишем id сразу, отдельным апдейтом: если следующий переход упадёт, тикет
    // уже существует и повтор не должен создать второй.
    await db
      .update(projectItems)
      .set({ crmIssueId: issueId, crmStateId: created.state_id })
      .where(eq(projectItems.id, args.itemId));
    await executeTransition(issueId, String(CRM_STATE.inWork));
  }

  const done = await executeTransition(issueId, args.targetTransitionId);
  await applyCrmState(args.itemId, done);
}

/** Единственная точка записи зеркала CRM на размещение. Раньше этот блок был
 *  скопирован в четырёх местах — любой новый триггер зеркалирования (авто-
 *  вердикты, смена стадии) породил бы пятую копию. */
async function applyCrmState(
  itemId: string,
  issue: { id?: number; state_id: number; resolution_id: number | null },
): Promise<void> {
  await db
    .update(projectItems)
    .set({
      ...(issue.id ? { crmIssueId: issue.id } : {}),
      crmStateId: issue.state_id,
      crmResolutionId: issue.resolution_id,
      crmSyncedAt: new Date(),
      crmSyncError: null,
    })
    .where(eq(projectItems.id, itemId));
}

/** Ошибка обращения к CRM: одинаково записывается на карточку из всех трёх
 *  путей (вердикт, ручной переход, чтение кнопок). Возвращает текст, чтобы
 *  вызывающий решил сам — глотать или отдавать 502. */
async function recordSyncError(itemId: string, e: unknown): Promise<string> {
  const msg = errMsg(e);
  await db
    .update(projectItems)
    .set({ crmSyncError: msg.slice(0, 500) })
    .where(eq(projectItems.id, itemId));
  return msg;
}

/** Логин менеджера в CRM. Без него владельца тикета не проставить, а тикет без
 *  владельца бесполезен для отчётности — поэтому вердикт блокируем. Но только
 *  при включённой интеграции: без токена вердикт остаётся локальным, и требовать
 *  логин было бы враньём (см. isCrmEnabled в crm-client). */
async function requireCrmLogin(userId: string): Promise<string> {
  if (!isCrmEnabled()) return "";
  const [me] = await db
    .select({ crmLogin: users.crmLogin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const login = me?.crmLogin?.trim();
  if (!login) {
    throw new HTTPException(400, {
      message: "Укажите свой логин в CRM в настройках профиля",
    });
  }
  return login;
}

async function readCrmState(itemId: string) {
  const [row] = await db
    .select({
      crmIssueId: projectItems.crmIssueId,
      crmStateId: projectItems.crmStateId,
      crmResolutionId: projectItems.crmResolutionId,
      crmSyncedAt: projectItems.crmSyncedAt,
      crmSyncError: projectItems.crmSyncError,
      qualReason: projectItems.qualReason,
    })
    .from(projectItems)
    .where(eq(projectItems.id, itemId))
    .limit(1);
  return row;
}

// --- вердикт квалификации --------------------------------------------------

const VerdictBody = z
  .object({
    verdict: z.enum(["qualified", "disqualified"]),
    // id перехода CRM ('703_578'), обязателен для дисквалификации.
    reason: z.string().max(32).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .openapi("QualifyLead");

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/qualify",
    tags: ["outreach"],
    request: {
      params: WsProjectItemParam,
      body: {
        content: { "application/json": { schema: VerdictBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: CrmStateSchema } },
        description: "Вердикт сохранён (crm.syncError непустой = в CRM не ушло)",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, itemId } = c.req.valid("param");
    const { verdict, reason, note } = c.req.valid("json");
    await assertProjectAccess(projectId, wsId, userId, role);

    if (verdict === "disqualified") {
      if (!reason) {
        throw new HTTPException(400, {
          message: "Для дисквалификации нужна причина",
        });
      }
      if (!CRM_DISQUALIFY_REASONS.some((r) => r.transitionId === reason)) {
        throw new HTTPException(400, { message: "Неизвестная причина" });
      }
    }

    const ownerLogin = await requireCrmLogin(userId);

    const updated = await db
      .update(projectItems)
      .set({
        qualification: verdict,
        qualReason: verdict === "disqualified" ? (reason ?? null) : null,
        qualNote: note ?? null,
        qualifiedBy: userId,
        qualifiedAt: new Date(),
      })
      .where(
        and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)),
      )
      .returning({ id: projectItems.id });
    if (updated.length === 0) {
      throw new HTTPException(404, { message: "item not found" });
    }

    await syncVerdict(wsId, projectId, itemId, ownerLogin, verdict, reason);
    return c.json(await serializeCrm(itemId));
  },
);

/** Отправка вердикта в CRM. Ошибку не бросаем: локальный вердикт уже сохранён,
 *  и терять его из-за недоступной CRM неправильно — кладём текст в
 *  crm_sync_error, UI покажет «повторить». */
async function syncVerdict(
  wsId: string,
  projectId: string,
  itemId: string,
  ownerLogin: string,
  verdict: "qualified" | "disqualified",
  reason: string | null | undefined,
): Promise<void> {
  if (!isCrmEnabled()) return;
  const target =
    verdict === "qualified" ? String(CRM_STATE.validated) : (reason as string);
  try {
    await pushToCrm({
      wsId,
      projectId,
      itemId,
      ownerLogin,
      targetTransitionId: target,
    });
  } catch (e) {
    await recordSyncError(itemId, e);
  }
}

async function serializeCrm(itemId: string) {
  const row = await readCrmState(itemId);
  const resolutionId = row?.crmResolutionId ?? null;
  return {
    issueId: row?.crmIssueId ?? null,
    stateId: row?.crmStateId ?? null,
    stateName:
      row?.crmStateId != null ? (CRM_STATE_NAME[row.crmStateId] ?? null) : null,
    resolutionName:
      resolutionId != null && row?.qualReason
        ? crmResolutionName(row.qualReason)
        : null,
    syncedAt: row?.crmSyncedAt?.toISOString() ?? null,
    syncError: row?.crmSyncError ?? null,
  };
}

// --- повтор неудачной отправки ---------------------------------------------

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/crm-retry",
    tags: ["outreach"],
    request: { params: WsProjectItemParam },
    responses: {
      200: {
        content: { "application/json": { schema: CrmStateSchema } },
        description: "Повторная отправка вердикта в CRM",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, itemId } = c.req.valid("param");
    await assertProjectAccess(projectId, wsId, userId, role);
    const ownerLogin = await requireCrmLogin(userId);

    const [row] = await db
      .select({
        qualification: projectItems.qualification,
        qualReason: projectItems.qualReason,
      })
      .from(projectItems)
      .where(eq(projectItems.id, itemId))
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "item not found" });
    if (row.qualification === "pending") {
      throw new HTTPException(400, { message: "Вердикт ещё не вынесен" });
    }

    await syncVerdict(
      wsId,
      projectId,
      itemId,
      ownerLogin,
      row.qualification,
      row.qualReason,
    );
    return c.json(await serializeCrm(itemId));
  },
);

// --- смена статуса в CRM из карточки лида ----------------------------------

const TransitionBody = z
  .object({ transitionId: z.string().min(1).max(32) })
  .openapi("CrmTransition");

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/crm-transition",
    tags: ["outreach"],
    request: {
      params: WsProjectItemParam,
      body: {
        content: { "application/json": { schema: TransitionBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: CrmStateSchema } },
        description: "Статус в CRM изменён",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, itemId } = c.req.valid("param");
    const { transitionId } = c.req.valid("json");
    await assertProjectAccess(projectId, wsId, userId, role);

    const [row] = await db
      .select({
        crmIssueId: projectItems.crmIssueId,
        crmStateId: projectItems.crmStateId,
      })
      .from(projectItems)
      .where(
        and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "item not found" });
    if (row.crmIssueId === null || !isCrmEnabled()) {
      throw new HTTPException(400, { message: "Тикет в CRM ещё не заведён" });
    }
    // Легальность проверяем у себя: сервер CRM граф НЕ валидирует и примет
    // любой переход, так что 400 от него мы бы не получили.
    const legal = crmTransitionOptions(row.crmStateId);
    if (legal.length && !legal.some((o) => o.transitionId === transitionId)) {
      throw new HTTPException(400, {
        message: "Такой переход недоступен из текущего статуса",
      });
    }

    try {
      const done = await executeTransition(row.crmIssueId, transitionId);
      await applyCrmState(itemId, {
        ...done,
        // CRM иногда не возвращает резолюцию в ответе — достаём из составного
        // id перехода ("8_562" → 562).
        resolution_id:
          done.resolution_id ?? parseCrmTransitionId(transitionId).resolutionId,
      });
    } catch (e) {
      throw new HTTPException(502, {
        message: `CRM: ${await recordSyncError(itemId, e)}`,
      });
    }
    return c.json(await serializeCrm(itemId));
  },
);

// --- живые кнопки для карточки ---------------------------------------------

const CrmButtonsSchema = z
  .object({
    stateId: z.number().int().nullable(),
    stateName: z.string().nullable(),
    options: z.array(
      z.object({ transitionId: z.string(), label: z.string() }),
    ),
  })
  .openapi("CrmButtons");

// Тянем переходы из CRM, а не из константы: если там добавят причину отказа,
// менеджер увидит её сразу, без передеплоя. Константа остаётся для экранов,
// где тикета ещё нет (таб квалификации).
app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/items/{itemId}/crm-transitions",
    tags: ["outreach"],
    request: { params: WsProjectItemParam },
    responses: {
      200: {
        content: { "application/json": { schema: CrmButtonsSchema } },
        description: "Доступные переходы тикета",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, itemId } = c.req.valid("param");
    await assertProjectAccess(projectId, wsId, userId, role);

    const [row] = await db
      .select({
        crmIssueId: projectItems.crmIssueId,
        crmStateId: projectItems.crmStateId,
      })
      .from(projectItems)
      .where(
        and(eq(projectItems.id, itemId), eq(projectItems.projectId, projectId)),
      )
      .limit(1);
    if (!row) throw new HTTPException(404, { message: "item not found" });
    if (row.crmIssueId === null || !isCrmEnabled()) {
      return c.json({ stateId: null, stateName: null, options: [] });
    }

    try {
      const live = await getTransitions(row.crmIssueId);
      // Заодно освежаем зеркало — карточку открыли, статус мог уехать в CRM.
      const stateId = Number(live.current.id.split("_")[0]);
      // Пишем только при реальном расхождении: открытие карточки — путь
      // чтения, а безусловный UPDATE переписывал бы строку на каждый просмотр.
      if (stateId !== row.crmStateId) {
        await db
          .update(projectItems)
          .set({ crmStateId: stateId, crmSyncedAt: new Date() })
          .where(eq(projectItems.id, itemId));
      }
      return c.json({
        stateId,
        stateName: live.current.name,
        options: live.transitions.map((t) => ({
          transitionId: String(t.id),
          label: t.resolution_name
            ? `${t.name} · ${t.resolution_name}`
            : t.name,
        })),
      });
    } catch (e) {
      // CRM недоступна — карточку не роняем, отдаём кнопки из константы. Но
      // ошибку не проглатываем: чаще всего это протухший токен, и молчание
      // здесь означает, что менеджер увидит рабочий интерфейс, нажмёт кнопку и
      // получит 502 без единого следа о причине.
      console.error(
        `[crm] transitions issue=${row.crmIssueId}: ${await recordSyncError(itemId, e)}`,
      );
      return c.json({
        stateId: row.crmStateId,
        stateName: null,
        options: crmTransitionOptions(row.crmStateId),
      });
    }
  },
);

export default app;
