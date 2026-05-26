import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  channelAdmins,
  channels,
  contacts,
  outreachAccounts,
  placementClientStatus,
  placementContractStatus,
  placementCreativeStatus,
  placementMetricsStatus,
  projectItems,
  projects,
  scheduledMessages,
} from "../db/schema.ts";
import { assertProjectAccess } from "../lib/projects-access.ts";
import {
  resolveStickyByTgUserIds,
  resolveProjectAccountIds,
} from "../lib/project-scheduling.ts";
import { substituteVariables } from "../lib/substitute-variables.ts";
import { pickDefined } from "../lib/pick-defined.ts";
import { extractUsername } from "../lib/tg-username.ts";
import { type WorkspaceVars } from "../middleware/assert-member.ts";

// Agency-кампания переиспользует projects (kind='agency') + project_items
// (kind='placement'). Базовые операции над кампанией (создание, бриф, phase,
// активация аутрича, цепочка) живут в projects.ts. Здесь — медиаплан:
// размещения (placements). Аутрич по лонглисту шлёт worker через те же
// scheduled_messages; получатель — админ канала (item.contact_id/username,
// проставляются при добавлении размещения).
//
// Stage:
//   longlist  — shortlisted_at IS NULL  (ещё опрашиваем)
//   shortlist — shortlisted_at NOT NULL (собран, ушёл клиенту на согласование)

const WsProjectParam = z.object({
  wsId: z.string().min(1).max(64),
  projectId: z.string().min(1).max(64),
});
const PlacementParam = WsProjectParam.extend({
  placementId: z.string().min(1).max(64),
});

const ClientStatusSchema = z.enum(placementClientStatus.enumValues);
// Статус коммуникации с блогером — производный из scheduled_messages + ответа.
const ChainStatusSchema = z.enum([
  "not_sent",
  "sent",
  "read",
  "replied",
  "declined",
]);

const PlacementSchema = z
  .object({
    id: z.string(),
    channel: z
      .object({
        id: z.string(),
        title: z.string(),
        username: z.string().nullable(),
        memberCount: z.number().int().nullable(),
      })
      .nullable(),
    adminContactId: z.string().nullable(),
    adminUsername: z.string().nullable(),
    hasRecipient: z.boolean(),
    // Аккаунт, через который идёт аутрич этому блогеру (после активации).
    account: z
      .object({
        id: z.string(),
        firstName: z.string().nullable(),
        tgUsername: z.string().nullable(),
      })
      .nullable(),
    chainStatus: ChainStatusSchema,
    // Компактная аутрич-сводка для одного статус-столбца в таблице.
    outreach: z.object({
      totalSteps: z.number().int(), // запланировано сообщений (= шагов цепочки)
      sentCount: z.number().int(), // отправлено
      read: z.boolean(), // прочитано хотя бы одно
      lastSentAt: z.iso.datetime().nullable(),
    }),
    available: z.boolean().nullable(),
    priceAmount: z.number().nullable(),
    forecastViews: z.number().int().nullable(),
    forecastErr: z.number().nullable(),
    clientStatus: ClientStatusSchema,
    clientStatusComment: z.string().nullable(),
    shortlistedAt: z.iso.datetime().nullable(),
    repliedAt: z.iso.datetime().nullable(),
    // production (фаза 5)
    finalOfferSentAt: z.iso.datetime().nullable(),
    contractStatus: z.enum(placementContractStatus.enumValues),
    creativeStatus: z.enum(placementCreativeStatus.enumValues),
    creativeRound: z.number().int(),
    scheduledAt: z.iso.datetime().nullable(),
    erid: z.string().nullable(),
    eridAdvertiserData: z.string().nullable(),
    postUrl: z.string().nullable(),
    publishedAt: z.iso.datetime().nullable(),
    actReceivedAt: z.iso.datetime().nullable(),
    // отчёт (фаза 6) — снимок метрик поста через TDLib
    metricsStatus: z.enum(placementMetricsStatus.enumValues),
    metricsViews: z.number().int().nullable(),
    metricsForwards: z.number().int().nullable(),
    metricsReactions: z.number().int().nullable(),
    metricsCollectedAt: z.iso.datetime().nullable(),
    metricsError: z.string().nullable(),
    postSnapshot: z
      .object({
        text: z.string(),
        thumbB64: z.string().nullable(),
        thumbW: z.number().int().nullable(),
        thumbH: z.number().int().nullable(),
      })
      .nullable(),
    createdAt: z.iso.datetime(),
  })
  .openapi("Placement");

const CreatePlacementBody = z
  .object({
    channelId: z.string().min(1).max(64),
  })
  .openapi("CreatePlacement");

const UpdatePlacementBody = z
  .object({
    available: z.boolean().nullable().optional(),
    priceAmount: z.number().nonnegative().nullable().optional(),
    forecastViews: z.number().int().nonnegative().nullable().optional(),
    forecastErr: z.number().nonnegative().nullable().optional(),
    clientStatus: ClientStatusSchema.optional(),
    // true → добавить в шортлист (проставить shortlisted_at=now), false → вернуть
    // в лонглист (сбросить). Явная кнопка «В шортлист» у менеджера.
    shortlisted: z.boolean().optional(),
    // production (фаза 5)
    contractStatus: z.enum(placementContractStatus.enumValues).optional(),
    creativeStatus: z.enum(placementCreativeStatus.enumValues).optional(),
    creativeRound: z.number().int().min(0).optional(),
    scheduledAt: z.iso.datetime().nullable().optional(),
    erid: z.string().max(200).nullable().optional(),
    eridAdvertiserData: z.string().max(500).nullable().optional(),
    postUrl: z.string().max(500).nullable().optional(),
    publishedAt: z.iso.datetime().nullable().optional(),
    actReceivedAt: z.iso.datetime().nullable().optional(),
  })
  .openapi("UpdatePlacement");

const app = new OpenAPIHono<{ Variables: WorkspaceVars }>();

// Производный статус цепочки. repliedAt и факт отправки — источник истины
// аутрича; available=false — ручная отметка отказа.
function chainStatus(
  repliedAt: Date | null,
  available: boolean | null,
  sentCount: number,
  read: boolean,
): z.infer<typeof ChainStatusSchema> {
  if (repliedAt) return "replied";
  if (available === false) return "declined";
  if (read) return "read";
  if (sentCount > 0) return "sent";
  return "not_sent";
}

// Аутрич-сводка по item'ам из scheduled_messages, одним запросом.
async function outreachByItem(itemIds: string[]) {
  const map = new Map<
    string,
    {
      totalSteps: number;
      sentCount: number;
      read: boolean;
      lastSentAt: Date | null;
      accountId: string | null;
    }
  >();
  if (itemIds.length === 0) return map;
  const rows = await db
    .select({
      itemId: scheduledMessages.itemId,
      accountId: scheduledMessages.accountId,
      status: scheduledMessages.status,
      sentAt: scheduledMessages.sentAt,
      readAt: scheduledMessages.readAt,
    })
    .from(scheduledMessages)
    .where(inArray(scheduledMessages.itemId, itemIds));
  for (const r of rows) {
    const e = map.get(r.itemId) ?? {
      totalSteps: 0,
      sentCount: 0,
      read: false,
      lastSentAt: null as Date | null,
      accountId: null as string | null,
    };
    e.totalSteps += 1;
    if (r.status === "sent") e.sentCount += 1;
    if (r.readAt) e.read = true;
    if (r.sentAt && (!e.lastSentAt || r.sentAt > e.lastSentAt)) {
      e.lastSentAt = r.sentAt;
    }
    e.accountId ??= r.accountId;
    map.set(r.itemId, e);
  }
  return map;
}

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements",
    tags: ["campaigns"],
    request: {
      params: WsProjectParam,
      query: z.object({
        // longlist (опрос, shortlisted_at IS NULL) | shortlist (собранные) | all
        stage: z.enum(["longlist", "shortlist", "all"]).default("all"),
      }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: z.array(PlacementSchema) } },
        description: "Placements (медиаплан)",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const { stage } = c.req.valid("query");
    await assertProjectAccess(projectId, wsId, userId, role);

    const stageClause =
      stage === "longlist"
        ? sql`${projectItems.shortlistedAt} IS NULL`
        : stage === "shortlist"
          ? sql`${projectItems.shortlistedAt} IS NOT NULL`
          : undefined;

    const rows = await db
      .select(placementColumns())
      .from(projectItems)
      .leftJoin(channels, eq(channels.id, projectItems.channelId))
      .leftJoin(contacts, eq(contacts.id, projectItems.contactId))
      .where(
        and(
          eq(projectItems.projectId, projectId),
          eq(projectItems.kind, "placement"),
          stageClause,
        ),
      )
      .orderBy(asc(projectItems.createdAt));

    const outreach = await outreachByItem(rows.map((r) => r.id));
    const accounts = await loadAccounts(
      [...outreach.values()].map((o) => o.accountId),
    );
    return c.json(rows.map((r) => serializePlacement(r, outreach, accounts)));
  },
);

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements",
    tags: ["campaigns"],
    request: {
      params: WsProjectParam,
      body: {
        content: { "application/json": { schema: CreatePlacementBody } },
        required: true,
      },
    },
    responses: {
      201: {
        content: { "application/json": { schema: PlacementSchema } },
        description: "Created",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const { channelId } = c.req.valid("json");
    await assertProjectAccess(projectId, wsId, userId, role);

    const [channel] = await db
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.id, channelId), eq(channels.workspaceId, wsId)))
      .limit(1);
    if (!channel) throw new HTTPException(404, { message: "channel not found" });

    const admin = await resolveAdminRecipient(channelId);
    const [row] = await db
      .insert(projectItems)
      .values({
        workspaceId: wsId,
        projectId,
        kind: "placement",
        channelId,
        contactId: admin.contactId,
        username: admin.username,
        tgUserId: admin.tgUserId,
      })
      .returning();

    const placement = await loadPlacement(row!.id);
    return c.json(placement!, 201);
  },
);

// Массовое добавление: по одному URL/@username на строку. Канал, которого нет
// в базе, заводим болванкой (title=@username) — реальные title/подписчики
// подтянет ленивый sync при первом открытии ChannelDrawer. Получателя
// (контакт админа) резолвим, если он уже привязан; нет — размещение без
// получателя (привязать можно в сайдбаре канала).
const BulkPlacementsBody = z
  .object({
    identifiers: z.array(z.string().min(1).max(200)).min(1).max(300),
  })
  .openapi("BulkPlacements");

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements/bulk",
    tags: ["campaigns"],
    request: {
      params: WsProjectParam,
      body: {
        content: { "application/json": { schema: BulkPlacementsBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({
              added: z.number().int(),
              channelsCreated: z.number().int(),
              skippedInvalid: z.number().int(),
              skippedDuplicate: z.number().int(),
            }),
          },
        },
        description: "Bulk add result",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const { identifiers } = c.req.valid("json");
    await assertProjectAccess(projectId, wsId, userId, role);

    const parsed = identifiers.map(extractUsername);
    const skippedInvalid = parsed.filter((u) => u === null).length;
    const usernames = [...new Set(parsed.filter((u): u is string => u !== null))];

    let added = 0;
    let channelsCreated = 0;
    let skippedDuplicate = 0;

    for (const uname of usernames) {
      // find-or-create канал (username unique по ws+platform, case-insensitive).
      let [ch] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(
          and(
            eq(channels.workspaceId, wsId),
            eq(channels.platform, "telegram"),
            sql`lower(${channels.username}) = ${uname}`,
          ),
        )
        .limit(1);
      if (!ch) {
        const [created] = await db
          .insert(channels)
          .values({
            workspaceId: wsId,
            title: `@${uname}`,
            username: uname,
            platform: "telegram",
            createdBy: userId,
          })
          .onConflictDoNothing()
          .returning({ id: channels.id });
        if (created) {
          ch = created;
          channelsCreated++;
        } else {
          // Параллельная вставка тем же username — берём существующий.
          [ch] = await db
            .select({ id: channels.id })
            .from(channels)
            .where(
              and(
                eq(channels.workspaceId, wsId),
                eq(channels.platform, "telegram"),
                sql`lower(${channels.username}) = ${uname}`,
              ),
            )
            .limit(1);
        }
      }
      if (!ch) continue;

      const [existing] = await db
        .select({ id: projectItems.id })
        .from(projectItems)
        .where(
          and(
            eq(projectItems.projectId, projectId),
            eq(projectItems.channelId, ch.id),
            eq(projectItems.kind, "placement"),
          ),
        )
        .limit(1);
      if (existing) {
        skippedDuplicate++;
        continue;
      }

      const admin = await resolveAdminRecipient(ch.id);
      await db.insert(projectItems).values({
        workspaceId: wsId,
        projectId,
        kind: "placement",
        channelId: ch.id,
        contactId: admin.contactId,
        username: admin.username,
        tgUserId: admin.tgUserId,
      });
      added++;
    }

    return c.json({ added, channelsCreated, skippedInvalid, skippedDuplicate });
  },
);

app.openapi(
  createRoute({
    method: "patch",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
    tags: ["campaigns"],
    request: {
      params: PlacementParam,
      body: {
        content: { "application/json": { schema: UpdatePlacementBody } },
        required: true,
      },
    },
    responses: {
      200: {
        content: { "application/json": { schema: PlacementSchema } },
        description: "Updated",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, placementId } = c.req.valid("param");
    const body = c.req.valid("json");
    await assertProjectAccess(projectId, wsId, userId, role);

    const [updated] = await db
      .update(projectItems)
      .set({
        ...(body.available !== undefined && { available: body.available }),
        ...(body.priceAmount !== undefined && {
          priceAmount:
            body.priceAmount === null ? null : String(body.priceAmount),
        }),
        ...(body.forecastViews !== undefined && {
          forecastViews: body.forecastViews,
        }),
        ...(body.forecastErr !== undefined && {
          forecastErr:
            body.forecastErr === null ? null : String(body.forecastErr),
        }),
        // Смена статуса менеджером — это новое решение: сбрасываем коммент
        // (он принадлежал прежнему статусу клиента) и обновляем отметку
        // времени, чтобы comment/at не рассинхронизировались со статусом.
        ...(body.clientStatus !== undefined && {
          clientStatus: body.clientStatus,
          clientStatusComment: null,
          clientStatusAt: new Date(),
        }),
        ...(body.shortlisted !== undefined && {
          shortlistedAt: body.shortlisted ? new Date() : null,
        }),
        // production: enum/text/int — прямое копирование (null валиден).
        ...pickDefined(body, [
          "contractStatus",
          "creativeStatus",
          "creativeRound",
          "erid",
          "eridAdvertiserData",
          "postUrl",
        ]),
        ...(body.scheduledAt !== undefined && {
          scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        }),
        ...(body.publishedAt !== undefined && {
          publishedAt: body.publishedAt ? new Date(body.publishedAt) : null,
        }),
        ...(body.actReceivedAt !== undefined && {
          actReceivedAt: body.actReceivedAt
            ? new Date(body.actReceivedAt)
            : null,
        }),
      })
      .where(
        and(
          eq(projectItems.id, placementId),
          eq(projectItems.projectId, projectId),
          eq(projectItems.kind, "placement"),
        ),
      )
      .returning({ id: projectItems.id });
    if (!updated) throw new HTTPException(404, { message: "placement not found" });

    const placement = await loadPlacement(placementId);
    return c.json(placement!);
  },
);

app.openapi(
  createRoute({
    method: "delete",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}",
    tags: ["campaigns"],
    request: { params: PlacementParam },
    responses: { 204: { description: "Deleted" } },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId, placementId } = c.req.valid("param");
    await assertProjectAccess(projectId, wsId, userId, role);
    const result = await db
      .delete(projectItems)
      .where(
        and(
          eq(projectItems.id, placementId),
          eq(projectItems.projectId, projectId),
          eq(projectItems.kind, "placement"),
        ),
      )
      .returning({ id: projectItems.id });
    if (result.length === 0) {
      throw new HTTPException(404, { message: "placement not found" });
    }
    return c.body(null, 204);
  },
);

// Подтверждение — разовая рассылка approved-блогерам «вы выбраны». БЕЗ
// follow-up-пингов. Отправку НЕ делаем здесь синхронно: кладём по одному
// scheduled_messages на блогера, и тот же worker, что шлёт BD-цепочки,
// отправляет их с human-flow (typing, паузы), проверяя status/cooldown
// аккаунта. Аккаунт — sticky (тот же менеджер блогеру) либо round-robin по
// активным. msg_idx=1000 — маркер вне лонглист-цепочки: worker не запланирует
// после него follow-up (в project.messages нет такого шага).
const FINAL_OFFER_MSG_IDX = 1000;

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/final-offer",
    tags: ["campaigns"],
    request: {
      params: WsProjectParam,
      body: {
        content: {
          "application/json": {
            schema: z.object({ text: z.string().min(1).max(4000) }),
          },
        },
        required: true,
      },
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ scheduled: z.number().int() }),
          },
        },
        description: "Queued for worker",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    const { text } = c.req.valid("json");
    const project = await assertProjectAccess(projectId, wsId, userId, role);

    // approved + в шортлисте + есть кого адресовать (worker резолвит
    // username → tg_user_id лениво, так что username достаточно).
    const rows = await db
      .select({
        id: projectItems.id,
        username: projectItems.username,
        tgUserId: projectItems.tgUserId,
        properties: projectItems.properties,
      })
      .from(projectItems)
      .where(
        and(
          eq(projectItems.projectId, projectId),
          eq(projectItems.kind, "placement"),
          eq(projectItems.clientStatus, "approved"),
          isNotNull(projectItems.shortlistedAt),
          sql`(${projectItems.username} IS NOT NULL OR ${projectItems.tgUserId} IS NOT NULL)`,
        ),
      );
    if (rows.length === 0) {
      throw new HTTPException(400, {
        message: "Нет одобренных блогеров с контактом для рассылки",
      });
    }

    // active-аккаунты проекта (round-robin) + sticky-continuity.
    const accountIds = await resolveProjectAccountIds(wsId, project);
    if (accountIds.length === 0) {
      throw new HTTPException(400, {
        message: "Нет активных Telegram-аккаунтов для рассылки",
      });
    }
    const tgUserIds = rows
      .map((r) => r.tgUserId)
      .filter((x): x is string => x !== null);
    const sticky = await resolveStickyByTgUserIds(wsId, tgUserIds);

    let rr = 0;
    const now = new Date();
    const scheduled = rows.map((pl) => {
      const stickyAcc = pl.tgUserId ? sticky.get(pl.tgUserId) : undefined;
      // sticky берём только если аккаунт ещё активен; иначе round-robin.
      const accountId =
        stickyAcc && accountIds.includes(stickyAcc)
          ? stickyAcc
          : accountIds[rr++ % accountIds.length]!;
      return {
        workspaceId: wsId,
        projectId,
        itemId: pl.id,
        accountId,
        messageIdx: FINAL_OFFER_MSG_IDX,
        text: substituteVariables(text, {
          username: pl.username,
          properties: pl.properties as Record<string, string>,
        }),
        sendAt: now,
      };
    });

    await db.transaction(async (tx) => {
      const CHUNK = 1000;
      for (let i = 0; i < scheduled.length; i += CHUNK) {
        await tx.insert(scheduledMessages).values(scheduled.slice(i, i + CHUNK));
      }
      await tx
        .update(projectItems)
        .set({ finalOfferSentAt: now })
        .where(
          inArray(
            projectItems.id,
            rows.map((r) => r.id),
          ),
        );
      // Worker берёт pending только при project.status='active'.
      if (project.status !== "active") {
        await tx
          .update(projects)
          .set({
            status: "active",
            activatedAt: project.activatedAt ?? now,
            updatedAt: now,
          })
          .where(eq(projects.id, projectId));
      }
    });

    return c.json({ scheduled: scheduled.length });
  },
);

// Фаза «Отчёт»: ставит в очередь снятие метрик для всех опубликованных
// размещений (есть post_url). metrics-worker разбирает pending по 1 за tick
// (троттл 10с/100 в час) — TDLib openChat+viewMessages, не bulk-pull.
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/workspaces/{wsId}/projects/{projectId}/collect-metrics",
    tags: ["campaigns"],
    request: { params: WsProjectParam },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ queued: z.number().int() }),
          },
        },
        description: "Queued for metrics-worker",
      },
    },
  }),
  async (c) => {
    const wsId = c.get("workspaceId");
    const userId = c.get("userId");
    const role = c.get("workspaceRole");
    const { projectId } = c.req.valid("param");
    await assertProjectAccess(projectId, wsId, userId, role);

    // Только одобренный шортлист с постом — ровно то, что показывает экран
    // отчёта. Без этого фильтра воркер жёг бы часовой лимит на размещения,
    // которых в отчёте не видно (не-approved / не-shortlist с post_url).
    const queued = await db
      .update(projectItems)
      .set({ metricsStatus: "pending", metricsError: null })
      .where(
        and(
          eq(projectItems.projectId, projectId),
          eq(projectItems.kind, "placement"),
          eq(projectItems.clientStatus, "approved"),
          isNotNull(projectItems.shortlistedAt),
          isNotNull(projectItems.postUrl),
        ),
      )
      .returning({ id: projectItems.id });
    if (queued.length === 0) {
      throw new HTTPException(400, {
        message: "Нет опубликованных постов для снятия статистики",
      });
    }
    return c.json({ queued: queued.length });
  },
);

// Получатель аутрича по каналу = первый привязанный админ-контакт. Нет
// админа → размещение без получателя (цепочку не запустить, пока контакт не
// привязан в сайдбаре канала).
async function resolveAdminRecipient(channelId: string) {
  const [admin] = await db
    .select({ contactId: channelAdmins.contactId, props: contacts.properties })
    .from(channelAdmins)
    .innerJoin(contacts, eq(contacts.id, channelAdmins.contactId))
    .where(eq(channelAdmins.channelId, channelId))
    .limit(1);
  const p = (admin?.props ?? {}) as Record<string, unknown>;
  return {
    contactId: admin?.contactId ?? null,
    username: (p.telegram_username as string | undefined) ?? null,
    tgUserId: (p.tg_user_id as string | undefined) ?? null,
  };
}

// Колонки placement-строки (общие для list/load).
function placementColumns() {
  return {
    id: projectItems.id,
    available: projectItems.available,
    priceAmount: projectItems.priceAmount,
    forecastViews: projectItems.forecastViews,
    forecastErr: projectItems.forecastErr,
    clientStatus: projectItems.clientStatus,
    clientStatusComment: projectItems.clientStatusComment,
    shortlistedAt: projectItems.shortlistedAt,
    repliedAt: projectItems.repliedAt,
    finalOfferSentAt: projectItems.finalOfferSentAt,
    contractStatus: projectItems.contractStatus,
    creativeStatus: projectItems.creativeStatus,
    creativeRound: projectItems.creativeRound,
    scheduledAt: projectItems.scheduledAt,
    erid: projectItems.erid,
    eridAdvertiserData: projectItems.eridAdvertiserData,
    postUrl: projectItems.postUrl,
    publishedAt: projectItems.publishedAt,
    actReceivedAt: projectItems.actReceivedAt,
    metricsStatus: projectItems.metricsStatus,
    metricsViews: projectItems.metricsViews,
    metricsForwards: projectItems.metricsForwards,
    metricsReactions: projectItems.metricsReactions,
    metricsCollectedAt: projectItems.metricsCollectedAt,
    metricsError: projectItems.metricsError,
    postSnapshot: projectItems.postSnapshot,
    createdAt: projectItems.createdAt,
    contactId: projectItems.contactId,
    username: projectItems.username,
    tgUserId: projectItems.tgUserId,
    channelId: channels.id,
    channelTitle: channels.title,
    channelUsername: channels.username,
    channelMembers: channels.memberCount,
    adminUsername: sql<
      string | null
    >`${contacts.properties} ->> 'telegram_username'`,
  };
}

async function loadAccounts(ids: (string | null)[]) {
  const real = [...new Set(ids.filter((x): x is string => x !== null))];
  const map = new Map<
    string,
    { id: string; firstName: string | null; tgUsername: string | null }
  >();
  if (real.length === 0) return map;
  const rows = await db
    .select({
      id: outreachAccounts.id,
      firstName: outreachAccounts.firstName,
      tgUsername: outreachAccounts.tgUsername,
    })
    .from(outreachAccounts)
    .where(inArray(outreachAccounts.id, real));
  for (const a of rows) map.set(a.id, a);
  return map;
}

async function loadPlacement(itemId: string) {
  const [row] = await db
    .select(placementColumns())
    .from(projectItems)
    .leftJoin(channels, eq(channels.id, projectItems.channelId))
    .leftJoin(contacts, eq(contacts.id, projectItems.contactId))
    .where(eq(projectItems.id, itemId))
    .limit(1);
  if (!row) return null;
  const outreach = await outreachByItem([itemId]);
  const accounts = await loadAccounts(
    [...outreach.values()].map((o) => o.accountId),
  );
  return serializePlacement(row, outreach, accounts);
}

function serializePlacement(
  row: {
    id: string;
    available: boolean | null;
    priceAmount: string | null;
    forecastViews: number | null;
    forecastErr: string | null;
    clientStatus: (typeof placementClientStatus.enumValues)[number];
    clientStatusComment: string | null;
    shortlistedAt: Date | null;
    repliedAt: Date | null;
    finalOfferSentAt: Date | null;
    contractStatus: (typeof placementContractStatus.enumValues)[number];
    creativeStatus: (typeof placementCreativeStatus.enumValues)[number];
    creativeRound: number;
    scheduledAt: Date | null;
    erid: string | null;
    eridAdvertiserData: string | null;
    postUrl: string | null;
    publishedAt: Date | null;
    actReceivedAt: Date | null;
    metricsStatus: (typeof placementMetricsStatus.enumValues)[number];
    metricsViews: number | null;
    metricsForwards: number | null;
    metricsReactions: number | null;
    metricsCollectedAt: Date | null;
    metricsError: string | null;
    postSnapshot: {
      text: string;
      thumbB64: string | null;
      thumbW: number | null;
      thumbH: number | null;
    } | null;
    createdAt: Date;
    contactId: string | null;
    username: string | null;
    tgUserId: string | null;
    channelId: string | null;
    channelTitle: string | null;
    channelUsername: string | null;
    channelMembers: number | null;
    adminUsername: string | null;
  },
  outreachMap: Awaited<ReturnType<typeof outreachByItem>>,
  accountMap: Awaited<ReturnType<typeof loadAccounts>>,
) {
  const o = outreachMap.get(row.id) ?? {
    totalSteps: 0,
    sentCount: 0,
    read: false,
    lastSentAt: null,
    accountId: null,
  };
  const account = o.accountId ? accountMap.get(o.accountId) ?? null : null;
  return {
    id: row.id,
    channel: row.channelId
      ? {
          id: row.channelId,
          title: row.channelTitle ?? "—",
          username: row.channelUsername,
          memberCount: row.channelMembers,
        }
      : null,
    adminContactId: row.contactId,
    adminUsername: row.adminUsername,
    // Есть кого адресовать аутричем/оффером (worker резолвит username→tgUserId
    // лениво) — UI считает получателей по этому флагу, как и backend.
    hasRecipient: row.username !== null || row.tgUserId !== null,
    account,
    chainStatus: chainStatus(row.repliedAt, row.available, o.sentCount, o.read),
    outreach: {
      totalSteps: o.totalSteps,
      sentCount: o.sentCount,
      read: o.read,
      lastSentAt: o.lastSentAt?.toISOString() ?? null,
    },
    available: row.available,
    priceAmount: row.priceAmount === null ? null : Number(row.priceAmount),
    forecastViews: row.forecastViews,
    forecastErr: row.forecastErr === null ? null : Number(row.forecastErr),
    clientStatus: row.clientStatus,
    clientStatusComment: row.clientStatusComment,
    shortlistedAt: row.shortlistedAt?.toISOString() ?? null,
    repliedAt: row.repliedAt?.toISOString() ?? null,
    finalOfferSentAt: row.finalOfferSentAt?.toISOString() ?? null,
    contractStatus: row.contractStatus,
    creativeStatus: row.creativeStatus,
    creativeRound: row.creativeRound,
    scheduledAt: row.scheduledAt?.toISOString() ?? null,
    erid: row.erid,
    eridAdvertiserData: row.eridAdvertiserData,
    postUrl: row.postUrl,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    actReceivedAt: row.actReceivedAt?.toISOString() ?? null,
    metricsStatus: row.metricsStatus,
    metricsViews: row.metricsViews,
    metricsForwards: row.metricsForwards,
    metricsReactions: row.metricsReactions,
    metricsCollectedAt: row.metricsCollectedAt?.toISOString() ?? null,
    metricsError: row.metricsError,
    postSnapshot: row.postSnapshot,
    createdAt: row.createdAt.toISOString(),
  };
}

export default app;
