import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  channelSubscriptions,
  channels,
  outreachAccounts,
  projectItems,
  projects,
  projectShares,
  tracks,
  workspaces,
} from "../db/schema.ts";
import {
  mapChannelHistoryItems,
  readChannelPreview,
} from "../lib/channel-history.ts";
import { getOutreachWorkerClient } from "../lib/outreach-account-client.ts";
import {
  TdMediaThumbSchema,
  TdMessageEntitySchema,
} from "../lib/td-message.ts";
import { type SessionVars } from "../middleware/require-session.ts";

// Клиентский доступ по magic-link (без аккаунта/сессии). Доступ = знание
// токена. Каждый endpoint резолвит токен → projectId, валидирует (не отозван,
// не истёк). Клиент видит ТОЛЬКО свою кампанию (шортлист), без цен блогерам
// (спека §5.5) и без других кампаний/клиентов агентства.
//
// Монтируется на app напрямую (НЕ под requireSession/assertMember).

const TokenParam = z.object({ token: z.string().min(1).max(128) });
const PlacementTokenParam = TokenParam.extend({
  placementId: z.string().min(1).max(64),
});

const ClientPlacementSchema = z
  .object({
    id: z.string(),
    channel: z
      .object({
        title: z.string(),
        username: z.string().nullable(),
        memberCount: z.number().int().nullable(),
        avgReach: z.number().nullable(),
        err: z.number().nullable(),
      })
      .nullable(),
    // Цена, которую видит клиент: оверрайд clientPrice, иначе закупочная
    // (priceAmount). Менеджер задаёт clientPrice в кабинете, если хочет скрыть
    // реальную закупку; не задал — клиент видит закупочную (его осознанный выбор).
    price: z.number().nullable(),
    clientStatus: z.enum(["pending", "approved", "rejected"]),
    clientStatusComment: z.string().nullable(),
  })
  .openapi("ClientPlacement");

const ClientProjectSchema = z
  .object({
    campaignName: z.string(),
    clientName: z.string(),
    agencyName: z.string(),
    brief: z.string().nullable(),
    // Клиент финализировал медиаплан → решения заморожены, фронт переключается
    // в read-only. null = ещё правит.
    finalizedAt: z.iso.datetime().nullable(),
    placements: z.array(ClientPlacementSchema),
  })
  .openapi("ClientProject");

const app = new OpenAPIHono<{ Variables: SessionVars }>();

// Резолв токена → доступ. Обновляет last_seen_at. 401 если невалиден.
async function resolveShare(token: string) {
  const [share] = await db
    .select({
      id: projectShares.id,
      projectId: projectShares.projectId,
      workspaceId: projectShares.workspaceId,
    })
    .from(projectShares)
    .where(
      and(
        eq(projectShares.token, token),
        isNull(projectShares.revokedAt),
        or(
          isNull(projectShares.expiresAt),
          gt(projectShares.expiresAt, new Date()),
        ),
      ),
    )
    .limit(1);
  if (!share) {
    throw new HTTPException(401, { message: "Ссылка недействительна" });
  }
  // Fire-and-forget last_seen — не блокируем ответ. .catch обязателен: без
  // него транзиентная ошибка БД на этом UPDATE = unhandled rejection, а Node
  // 24 (--unhandled-rejections=throw) уронит весь процесс от анонимного трафика.
  void db
    .update(projectShares)
    .set({ lastSeenAt: new Date() })
    .where(eq(projectShares.id, share.id))
    .catch(() => {});
  return share;
}

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/share/{token}/project",
    tags: ["share-client"],
    request: { params: TokenParam },
    responses: {
      200: {
        content: { "application/json": { schema: ClientProjectSchema } },
        description: "Client view: campaign + shortlist",
      },
    },
  }),
  async (c) => {
    const { token } = c.req.valid("param");
    const share = await resolveShare(token);

    const [project] = await db
      .select({
        name: projects.name,
        brief: projects.brief,
        finalizedAt: projects.clientFinalizedAt,
        clientName: tracks.name,
        agencyName: workspaces.name,
      })
      .from(projects)
      .innerJoin(tracks, eq(tracks.id, projects.trackId))
      .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
      .where(eq(projects.id, share.projectId))
      .limit(1);
    if (!project) throw new HTTPException(404, { message: "not found" });

    // Только шортлист (shortlisted_at NOT NULL) — то, что агентство отобрало.
    const rows = await db
      .select({
        id: projectItems.id,
        priceAmount: projectItems.priceAmount,
        clientPrice: projectItems.clientPrice,
        clientStatus: projectItems.clientStatus,
        clientStatusComment: projectItems.clientStatusComment,
        channelTitle: channels.title,
        channelUsername: channels.username,
        channelMembers: channels.memberCount,
        channelAvgReach: sql<number | null>`(${channels.meta} ->> 'avg_reach')::int`,
        channelErr: sql<number | null>`(${channels.meta} ->> 'err')::float8`,
        channelId: channels.id,
      })
      .from(projectItems)
      .leftJoin(channels, eq(channels.id, projectItems.channelId))
      .where(
        and(
          eq(projectItems.projectId, share.projectId),
          eq(projectItems.kind, "placement"),
          sql`${projectItems.shortlistedAt} IS NOT NULL`,
        ),
      )
      .orderBy(asc(projectItems.createdAt));

    return c.json({
      campaignName: project.name,
      clientName: project.clientName,
      agencyName: project.agencyName,
      brief: project.brief,
      finalizedAt: project.finalizedAt?.toISOString() ?? null,
      placements: rows.map((r) => ({
        id: r.id,
        channel: r.channelId
          ? {
              title: r.channelTitle ?? "—",
              username: r.channelUsername,
              memberCount: r.channelMembers,
              avgReach: r.channelAvgReach,
              err: r.channelErr,
            }
          : null,
        // Цена для клиента: оверрайд clientPrice, иначе закупочная (совпадает).
        price: (() => {
          const eff = r.clientPrice ?? r.priceAmount;
          return eff === null ? null : Number(eff);
        })(),
        clientStatus: r.clientStatus,
        clientStatusComment: r.clientStatusComment,
      })),
    });
  },
);

// Единый эндпоинт решения клиента: статус (можно менять туда-обратно, в т.ч.
// вернуть в pending) + комментарий (можно оставить при любом решении). Заменяет
// approve/reject — клиенту достаточно «Подходит / Не подходит», а комментарий
// независим. Заменяемое решение: клиент передумал → шлём новый статус.
const DecisionBody = z
  .object({
    status: z.enum(["pending", "approved", "rejected"]),
    comment: z.string().max(2000).nullable().optional(),
  })
  .openapi("ShareDecision");

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/share/{token}/placements/{placementId}/decision",
    tags: ["share-client"],
    request: {
      params: PlacementTokenParam,
      body: { content: { "application/json": { schema: DecisionBody } }, required: true },
    },
    responses: { 204: { description: "Decision saved" } },
  }),
  async (c) => {
    const { token, placementId } = c.req.valid("param");
    const { status, comment } = c.req.valid("json");
    const share = await resolveShare(token);
    // Финализированный медиаплан заморожен: клиент больше не правит решения,
    // пока менеджер не переоткроет (clientFinalizedAt → null). 409, чтобы фронт
    // показал «уже финализировано» вместо тихого no-op.
    const [proj] = await db
      .select({ finalizedAt: projects.clientFinalizedAt })
      .from(projects)
      .where(eq(projects.id, share.projectId))
      .limit(1);
    if (proj?.finalizedAt) {
      throw new HTTPException(409, { message: "Медиаплан уже финализирован" });
    }
    const [row] = await db
      .update(projectItems)
      .set({
        clientStatus: status,
        clientStatusComment: comment ?? null,
        clientStatusAt: status === "pending" ? null : new Date(),
      })
      .where(
        and(
          eq(projectItems.id, placementId),
          eq(projectItems.projectId, share.projectId),
          eq(projectItems.kind, "placement"),
          sql`${projectItems.shortlistedAt} IS NOT NULL`,
        ),
      )
      .returning({ id: projectItems.id });
    if (!row) throw new HTTPException(404, { message: "placement not found" });
    return c.body(null, 204);
  },
);

// Клиент финализирует медиаплан: с этого момента решения заморожены (см.
// /decision → 409). Идемпотентно — повторный вызов просто обновляет дату.
// Расфинализировать может только менеджер из кабинета (POST .../unfinalize).
app.openapi(
  createRoute({
    method: "post",
    path: "/v1/share/{token}/finalize",
    tags: ["share-client"],
    request: { params: TokenParam },
    responses: { 204: { description: "Media plan finalized" } },
  }),
  async (c) => {
    const { token } = c.req.valid("param");
    const share = await resolveShare(token);
    await db
      .update(projects)
      .set({ clientFinalizedAt: new Date() })
      .where(eq(projects.id, share.projectId));
    return c.body(null, 204);
  },
);

const PreviewPostSchema = z
  .object({
    id: z.string(),
    date: z.iso.datetime(),
    text: z.string(),
    entities: z.array(TdMessageEntitySchema),
    mediaThumb: TdMediaThumbSchema.nullable(),
    views: z.number().nullable(),
    forwards: z.number().nullable(),
    replies: z.number().nullable(),
    reactions: z.array(z.object({ emoji: z.string(), count: z.number() })),
    isForwarded: z.boolean(),
  })
  .openapi("ClientChannelPost");

// Предпросмотр канала для клиента: лента с сервера (readChannelPreview).
// Читаем через аккаунт воркспейса — подписанный на канал (для приватных это
// единственный способ), иначе любой активный. Placement обязан быть в шортлисте
// этой кампании (scope по share.projectId + shortlistedAt — клиент не должен
// подсмотреть каналы, которые агентство ещё перебирает в лонглисте). [] на любую
// проблему — дровер не падает.
app.openapi(
  createRoute({
    method: "get",
    path: "/v1/share/{token}/placements/{placementId}/preview",
    tags: ["share-client"],
    request: {
      params: PlacementTokenParam,
      query: z.object({
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
    },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ messages: z.array(PreviewPostSchema) }),
          },
        },
        description: "Cached channel posts (only_local, no network)",
      },
    },
  }),
  async (c) => {
    const { token, placementId } = c.req.valid("param");
    const { limit } = c.req.valid("query");
    const share = await resolveShare(token);
    const [row] = await db
      .select({
        externalId: channels.externalId,
        channelId: channels.id,
        username: channels.username,
      })
      .from(projectItems)
      .innerJoin(channels, eq(channels.id, projectItems.channelId))
      .where(
        and(
          eq(projectItems.id, placementId),
          eq(projectItems.projectId, share.projectId),
          eq(projectItems.kind, "placement"),
          sql`${projectItems.shortlistedAt} IS NOT NULL`,
        ),
      )
      .limit(1);
    if (!row || !row.externalId) return c.json({ messages: [] });

    const [acc] = await db
      .select({ id: outreachAccounts.id })
      .from(outreachAccounts)
      .leftJoin(
        channelSubscriptions,
        and(
          eq(channelSubscriptions.accountId, outreachAccounts.id),
          eq(channelSubscriptions.channelId, row.channelId),
          eq(channelSubscriptions.status, "subscribed"),
        ),
      )
      .where(
        and(
          eq(outreachAccounts.workspaceId, share.workspaceId),
          eq(outreachAccounts.status, "active"),
        ),
      )
      // Подписанный на канал аккаунт — первым (у него выше шанс кэша).
      .orderBy(sql`(${channelSubscriptions.accountId} is null)`)
      .limit(1);
    if (!acc) return c.json({ messages: [] });

    const client = await getOutreachWorkerClient({
      id: acc.id,
      workspaceId: share.workspaceId,
    });
    if (!client) return c.json({ messages: [] });
    const msgs = await readChannelPreview(client, {
      chatId: Number(row.externalId),
      username: row.username,
      limit,
    });
    return c.json({ messages: mapChannelHistoryItems(msgs) });
  },
);

export default app;
