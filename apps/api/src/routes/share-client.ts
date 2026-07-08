import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, asc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { computeDealPricing } from "@repo/core";
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
  readTaggedMessages,
} from "../lib/channel-history.ts";
import { getOutreachWorkerClient } from "../lib/outreach-account-client.ts";
import { respondWithCreativeMedia } from "../lib/creative-media-response.ts";
import {
  CreativeMediaSchema,
  mapCreativeMediaList,
  extractFormattedText,
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
        platform: z.enum(["telegram", "youtube", "tiktok", "dzen", "max"]),
        memberCount: z.number().int().nullable(),
        avgReach: z.number().nullable(),
        err: z.number().nullable(),
      })
      .nullable(),
    // Цена, которую видит клиент: посчитанная цепочка ценообразования (поля
    // блогера × множители кампании), ДО НДС (clientNoVat) — база прогнозного CPV,
    // как в «рыбе». Не закупка. С-НДС-срез — настройка дашборда (Задача 3).
    price: z.number().nullable(),
    // Прогноз охвата (снапшот на согласовании, менеджер может править) — знаменатель
    // прогнозного CPV, главного фильтра клиента. null → не зафиксировали.
    forecastViews: z.number().int().nullable(),
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
    // Бюджет кампании (клиентский) — чтобы клиент видел, попадаем ли в него.
    budget: z.number().nullable(),
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

// Цена клиенту ДО НДС (clientNoVat) из строки размещения × множителей проекта.
// Единый расчёт для обоих клиентских эндпоинтов (шортлист + отчёт), чтобы цена
// не разъехалась между ними. Numeric-колонки БД приходят строками → Number().
// Показываем до НДС — база прогнозного CPV (как в «рыбе»/внутреннем отчёте);
// с-НДС-срез — настройка клиентского дашборда (Задача 3).
function clientPriceNoVat(
  proj: {
    akPercent: string;
    vatEnabled: boolean;
    vatRate: string;
    ordEnabled: boolean;
    splitEnabled: boolean;
  },
  row: {
    priceAmount: string | null;
    surchargePercent: string | null;
    bloggerVat: boolean;
    createShare: string | null;
  },
): number | null {
  if (row.priceAmount === null) return null;
  return Math.round(
    computeDealPricing({
      cost: Number(row.priceAmount),
      surchargePercent:
        row.surchargePercent === null ? 0 : Number(row.surchargePercent),
      bloggerVat: row.bloggerVat,
      akPercent: Number(proj.akPercent),
      vat: proj.vatEnabled,
      vatRate: Number(proj.vatRate),
      ord3: proj.ordEnabled,
      splitEnabled: proj.splitEnabled,
      createShare: row.createShare === null ? null : Number(row.createShare),
    }).clientNoVat,
  );
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

    // project (шапка+множители) и rows зависят только от share.projectId — параллельно.
    const [[project], rows] = await Promise.all([
      db
        .select({
          name: projects.name,
          brief: projects.brief,
          budgetAmount: projects.budgetAmount,
          finalizedAt: projects.clientFinalizedAt,
          clientName: tracks.name,
          agencyName: workspaces.name,
          akPercent: projects.akPercent,
          vatEnabled: projects.vatEnabled,
          vatRate: projects.vatRate,
          ordEnabled: projects.ordEnabled,
          splitEnabled: projects.splitEnabled,
        })
        .from(projects)
        .innerJoin(tracks, eq(tracks.id, projects.trackId))
        .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
        .where(eq(projects.id, share.projectId))
        .limit(1),
      // Только шортлист (shortlisted_at NOT NULL) — то, что агентство отобрало.
      db
        .select({
          id: projectItems.id,
          priceAmount: projectItems.priceAmount,
          surchargePercent: projectItems.surchargePercent,
          bloggerVat: projectItems.bloggerVat,
          createShare: projectItems.createShare,
          forecastViews: projectItems.forecastViews,
          clientStatus: projectItems.clientStatus,
          clientStatusComment: projectItems.clientStatusComment,
          channelTitle: channels.title,
          channelUsername: channels.username,
          channelPlatform: channels.platform,
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
            sql`${projectItems.shortlistedAt} IS NOT NULL`,
          ),
        )
        .orderBy(asc(projectItems.createdAt)),
    ]);
    if (!project) throw new HTTPException(404, { message: "not found" });

    return c.json({
      campaignName: project.name,
      clientName: project.clientName,
      agencyName: project.agencyName,
      brief: project.brief,
      budget:
        project.budgetAmount === null ? null : Number(project.budgetAmount),
      finalizedAt: project.finalizedAt?.toISOString() ?? null,
      placements: rows.map((r) => ({
        id: r.id,
        channel: r.channelId
          ? {
              title: r.channelTitle ?? "—",
              username: r.channelUsername,
              platform: r.channelPlatform!,
              memberCount: r.channelMembers,
              avgReach: r.channelAvgReach,
              err: r.channelErr,
            }
          : null,
        // Цена для клиента — посчитанная цепочка (Срез А), не закупка. Legacy
        // clientPrice-оверрайд снят: клиент видит настоящую цену.
        price: clientPriceNoVat(project, r),
        forecastViews: r.forecastViews,
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
    // Нельзя финализировать, пока хоть одно размещение шортлиста не отмечено
    // (pending). Защита бэка к фронт-гейту — клиент должен решить по каждому.
    const [pending] = await db
      .select({ id: projectItems.id })
      .from(projectItems)
      .where(
        and(
          eq(projectItems.projectId, share.projectId),
          sql`${projectItems.shortlistedAt} IS NOT NULL`,
          eq(projectItems.clientStatus, "pending"),
        ),
      )
      .limit(1);
    if (pending) {
      throw new HTTPException(409, {
        message: "Сначала отметьте все размещения: подходит или не подходит",
      });
    }
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
          eq(outreachAccounts.platform, "telegram"),
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

// ── Фаза B: клиентское согласование креативов ───────────────────────────────
// Креатив = помеченное сообщение блогера (текст + медиа). Клиент видит «как будет
// выглядеть» и жмёт Согласовать / На правки. Медиа тянем с TDLib on-demand в
// норм-разрешении (downloadToBytes), файлы не храним.

// В списке клиент видит и ждущие решения, и уже одобренные/на-правках — чтобы
// согласованные креативы не «исчезали» (стадия выглядела бы непройденной).
// Действовать (одобрить/на правки) клиент может ТОЛЬКО из client_review —
// отдельный, более узкий гейт ниже на decision-эндпоинте.
const CLIENT_CREATIVE_VISIBLE = [
  "client_review",
  "approved",
  "revising",
] as const;
const CLIENT_CREATIVE_STATUSES = ["client_review"] as const;

const ClientCreativeSchema = z
  .object({
    placementId: z.string(),
    channelTitle: z.string(),
    text: z.string(),
    media: z.array(CreativeMediaSchema),
    status: z.enum(["client_review", "approved", "revising"]),
    comment: z.string().nullable(),
  })
  .openapi("ClientCreative");

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/share/{token}/creatives",
    tags: ["share-client"],
    request: { params: TokenParam },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ creatives: z.array(ClientCreativeSchema) }),
          },
        },
        description: "Креативы на согласование клиентом",
      },
    },
  }),
  async (c) => {
    const { token } = c.req.valid("param");
    const share = await resolveShare(token);
    const rows = await db
      .select({
        id: projectItems.id,
        channelTitle: channels.title,
        stepMessages: projectItems.stepMessages,
        status: projectItems.creativeStatus,
        comment: projectItems.creativeClientComment,
        snapshot: projectItems.creativeSnapshot,
      })
      .from(projectItems)
      .leftJoin(channels, eq(channels.id, projectItems.channelId))
      .where(
        and(
          eq(projectItems.projectId, share.projectId),
          sql`${projectItems.shortlistedAt} IS NOT NULL`,
          sql`${projectItems.stepMessages} -> 'creative' IS NOT NULL`,
          inArray(projectItems.creativeStatus, CLIENT_CREATIVE_VISIBLE),
        ),
      )
      .orderBy(asc(projectItems.createdAt));

    const creatives: z.infer<typeof ClientCreativeSchema>[] = [];
    for (const r of rows) {
      const ref = r.stepMessages?.creative;
      if (!ref) continue;
      // Стабильный креатив (клиент уже решил) неизменен → отдаём из снимка, не
      // читая TG. client_review ещё может поменяться (блогер правит) — всегда
      // живьём.
      const stable = r.status === "approved" || r.status === "revising";
      let text: string;
      let media: z.infer<typeof CreativeMediaSchema>[];
      if (stable && r.snapshot) {
        text = r.snapshot.text;
        media = r.snapshot.media;
      } else {
        const client = await getOutreachWorkerClient({
          id: ref.accountId,
          workspaceId: share.workspaceId,
        });
        const msgs = client ? await readTaggedMessages(client, ref) : [];
        text = msgs
          .map((m) => extractFormattedText(m.content).text)
          .filter((t) => t.length > 0)
          .join("\n");
        media = mapCreativeMediaList(msgs);
        // Снимок складываем из уже прочитанного — без лишних TG-вызовов — только
        // если креатив стабилен и реально прочитан (не морозим пустой/недоступный).
        if (stable && msgs.length > 0) {
          void db
            .update(projectItems)
            .set({ creativeSnapshot: { text, media } })
            .where(eq(projectItems.id, r.id))
            .catch(() => {});
        }
      }
      creatives.push({
        placementId: r.id,
        channelTitle: r.channelTitle ?? "—",
        text,
        media,
        status: r.status as "client_review" | "approved" | "revising",
        comment: r.comment,
      });
    }
    return c.json({ creatives });
  },
);

// Отдача медиа креатива (плейн-роут — бинарь). Скачиваем on-demand в норм-
// разрешении, не храним. idx — индекс сообщения в альбоме креатива.
app.get(
  "/v1/share/:token/placements/:placementId/creative-media/:idx",
  async (c) => {
    const token = c.req.param("token");
    const placementId = c.req.param("placementId");
    const idx = Number(c.req.param("idx"));
    const share = await resolveShare(token);
    const [row] = await db
      .select({ stepMessages: projectItems.stepMessages })
      .from(projectItems)
      .where(
        and(
          eq(projectItems.id, placementId),
          eq(projectItems.projectId, share.projectId),
          sql`${projectItems.shortlistedAt} IS NOT NULL`,
        ),
      )
      .limit(1);
    const ref = row?.stepMessages?.creative;
    if (!ref) throw new HTTPException(404, { message: "not found" });
    const client = await getOutreachWorkerClient({
      id: ref.accountId,
      workspaceId: share.workspaceId,
    });
    if (!client) throw new HTTPException(404, { message: "not found" });
    return respondWithCreativeMedia(client, ref, idx);
  },
);

const CreativeDecisionBody = z
  .object({
    status: z.enum(["approved", "revising"]),
    comment: z.string().max(2000).nullable().optional(),
  })
  .openapi("CreativeDecision");

app.openapi(
  createRoute({
    method: "post",
    path: "/v1/share/{token}/placements/{placementId}/creative-decision",
    tags: ["share-client"],
    request: {
      params: PlacementTokenParam,
      body: {
        content: { "application/json": { schema: CreativeDecisionBody } },
        required: true,
      },
    },
    responses: { 204: { description: "Creative decision saved" } },
  }),
  async (c) => {
    const { token, placementId } = c.req.valid("param");
    const { status, comment } = c.req.valid("json");
    const share = await resolveShare(token);
    const [row] = await db
      .update(projectItems)
      .set({ creativeStatus: status, creativeClientComment: comment ?? null })
      .where(
        and(
          eq(projectItems.id, placementId),
          eq(projectItems.projectId, share.projectId),
          sql`${projectItems.shortlistedAt} IS NOT NULL`,
          inArray(projectItems.creativeStatus, CLIENT_CREATIVE_STATUSES),
        ),
      )
      .returning({ id: projectItems.id });
    if (!row) throw new HTTPException(404, { message: "creative not found" });
    return c.body(null, 204);
  },
);

// Шаг 3 клиента — отчёт: вышедшие посты (postUrl задан) + собранные метрики +
// мини-превью (как карточка у менеджера). Цена — посчитанная клиентская до НДС
// (та же цепочка, что в шортлисте). Появляется, когда есть публикации.
const ClientReportItemSchema = z
  .object({
    id: z.string(),
    channel: z
      .object({
        title: z.string(),
        username: z.string().nullable(),
        platform: z.enum(["telegram", "youtube", "tiktok", "dzen", "max"]),
      })
      .nullable(),
    postUrl: z.string().nullable(),
    publishedAt: z.iso.datetime().nullable(),
    views: z.number().int().nullable(),
    likes: z.number().int().nullable(),
    comments: z.number().int().nullable(),
    shares: z.number().int().nullable(),
    price: z.number().nullable(),
    // Мини-превью вышедшего поста: обложка (URL у провайдеров / data-URI из
    // base64-тамбнейла у TG) + текст.
    preview: z
      .object({ cover: z.string().nullable(), text: z.string().nullable() })
      .nullable(),
  })
  .openapi("ClientReportItem");

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/share/{token}/report",
    tags: ["share-client"],
    request: { params: TokenParam },
    responses: {
      200: {
        content: {
          "application/json": {
            schema: z.object({ items: z.array(ClientReportItemSchema) }),
          },
        },
        description: "Client report: published posts + collected metrics",
      },
    },
  }),
  async (c) => {
    const { token } = c.req.valid("param");
    const share = await resolveShare(token);
    // proj (множители) и rows зависят только от share.projectId — тянем параллельно.
    const [[proj], rows] = await Promise.all([
      db
        .select({
          akPercent: projects.akPercent,
          vatEnabled: projects.vatEnabled,
          vatRate: projects.vatRate,
          ordEnabled: projects.ordEnabled,
          splitEnabled: projects.splitEnabled,
        })
        .from(projects)
        .where(eq(projects.id, share.projectId))
        .limit(1),
      db
        .select({
          id: projectItems.id,
          priceAmount: projectItems.priceAmount,
          surchargePercent: projectItems.surchargePercent,
          bloggerVat: projectItems.bloggerVat,
          createShare: projectItems.createShare,
          postUrl: projectItems.postUrl,
          publishedAt: projectItems.publishedAt,
          scheduledAt: projectItems.scheduledAt,
          views: projectItems.metricsViews,
          likes: projectItems.metricsLikes,
          comments: projectItems.metricsComments,
          shares: projectItems.metricsShares,
          postSnapshot: projectItems.postSnapshot,
          channelTitle: channels.title,
          channelUsername: channels.username,
          channelPlatform: channels.platform,
          channelId: channels.id,
        })
        .from(projectItems)
        .leftJoin(channels, eq(channels.id, projectItems.channelId))
        .where(
          and(
            eq(projectItems.projectId, share.projectId),
            // Только реально вышедшие размещения медиаплана: одобрено клиентом +
            // в шортлисте + есть ссылка на пост (как отчёт менеджера в WrapupPhase).
            // Иначе отклонённое/недошортлиженное с проставленным post_url утекло бы
            // в клиентский отчёт и итоги.
            eq(projectItems.clientStatus, "approved"),
            sql`${projectItems.shortlistedAt} IS NOT NULL`,
            sql`${projectItems.postUrl} IS NOT NULL`,
          ),
        )
        .orderBy(asc(projectItems.createdAt)),
    ]);
    if (!proj) throw new HTTPException(404, { message: "not found" });

    return c.json({
      items: rows.map((r) => {
        const snap = r.postSnapshot;
        const cover = snap?.coverUrl
          ? snap.coverUrl
          : snap?.thumbB64
            ? `data:image/jpeg;base64,${snap.thumbB64}`
            : null;
        const price = clientPriceNoVat(proj, r);
        return {
          id: r.id,
          channel: r.channelId
            ? {
                title: r.channelTitle ?? "—",
                username: r.channelUsername,
                platform: r.channelPlatform!,
              }
            : null,
          postUrl: r.postUrl,
          publishedAt: (r.publishedAt ?? r.scheduledAt)?.toISOString() ?? null,
          views: r.views,
          likes: r.likes,
          comments: r.comments,
          shares: r.shares,
          price,
          preview: snap ? { cover, text: snap.text ?? null } : null,
        };
      }),
    });
  },
);

export default app;
