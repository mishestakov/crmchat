import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, desc, eq, ilike, or, sql, count } from "drizzle-orm";
import { db } from "../db/client.ts";
import { platformActiveChannels, platformActiveSync } from "../db/schema.ts";
import { ilikeContains } from "../lib/ilike.ts";
import type { SessionVars } from "../middleware/require-session.ts";

// Справочник «Каналы Яндекса» (см. specs/yt-platform-active.md): поиск/фильтры
// по каналам, уже крутящимся на рекл-платформах Яндекса (CPC=tgads/CPA=
// cpa_network) + дата последнего синка. Зеркало страницы РКН: датасет один на
// всех — путь глобальный (/v1/platform-active, только requireSession), синк
// гонит внешний python-джоб, воркспейсы ничего не синкают.
//
// Одна запись = одна строка-источник (без мержа CPC/CPA): source-specific
// статусы показываются как есть, «оба» — косметика на потом.

const PlatformActiveRecordSchema = z
  .object({
    sourceKey: z.string(),
    source: z.string(), // cpc | cpa
    platform: z.string(),
    username: z.string().nullable(),
    link: z.string().nullable(),
    ownerLogin: z.string().nullable(),
    lastPostDate: z.string().nullable(),
    recentPostsCount: z.number().int(),
    recentViews: z.number().int(),
    botStatus: z.string().nullable(),
    isActive: z.boolean().nullable(),
    isCpv: z.boolean().nullable(),
    moderationStatus: z.string().nullable(),
  })
  .openapi("PlatformActiveRecord");

const PlatformActiveListSchema = z
  .object({
    records: z.array(PlatformActiveRecordSchema),
    // Всего под текущим фильтром (для пагинации).
    filteredTotal: z.number().int(),
    // Платформы/системы с количеством — чипы-фильтры.
    platforms: z.array(
      z.object({ platform: z.string(), count: z.number().int() }),
    ),
    sources: z.array(z.object({ source: z.string(), count: z.number().int() })),
    // Мета синка: когда обновлялось и не упал ли последний синк.
    lastSyncAt: z.iso.datetime().nullable(),
    lastStatus: z.string().nullable(),
    registryTotal: z.number().int(),
    pageSize: z.number().int(),
  })
  .openapi("PlatformActiveList");

const PAGE_SIZE = 50;

// Фасеты (GROUP BY по всей таблице) меняются только при синке — кэшируем по
// lastSyncAt, чтобы не пересчитывать на каждый ввод в поиск (как у РКН).
let facetsCache: {
  key: string;
  platforms: { platform: string; count: number }[];
  sources: { source: string; count: number }[];
} | null = null;

const app = new OpenAPIHono<{ Variables: SessionVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/platform-active",
    tags: ["platform-active"],
    request: {
      query: z.object({
        q: z.string().max(200).optional(),
        platform: z.string().max(32).optional(),
        source: z.string().max(8).optional(),
        // Только допущенные к CPV (маркер качества). stringbool, а не
        // coerce.boolean: последний делает "false"/"0" истинными (Boolean(str)).
        cpv: z.stringbool().optional(),
        page: z.coerce.number().int().min(1).default(1),
      }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: PlatformActiveListSchema } },
        description: "Platform-active channels page",
      },
    },
  }),
  async (c) => {
    const { q, platform, source, cpv, page } = c.req.valid("query");
    const term = q?.trim();
    const esc = term ? ilikeContains(term) : null;
    const where = and(
      platform ? eq(platformActiveChannels.platform, platform) : undefined,
      source ? eq(platformActiveChannels.source, source) : undefined,
      cpv ? eq(platformActiveChannels.isCpv, true) : undefined,
      esc
        ? or(
            ilike(platformActiveChannels.username, esc),
            ilike(platformActiveChannels.link, esc),
            ilike(platformActiveChannels.ownerLogin, esc),
          )
        : undefined,
    );

    const [meta] = await db.select().from(platformActiveSync).limit(1);
    const cacheKey = meta?.lastSyncAt?.toISOString() ?? "none";
    const [records, countRows, facets] = await Promise.all([
      db
        .select({
          sourceKey: platformActiveChannels.sourceKey,
          source: platformActiveChannels.source,
          platform: platformActiveChannels.platform,
          username: platformActiveChannels.username,
          link: platformActiveChannels.link,
          ownerLogin: platformActiveChannels.ownerLogin,
          lastPostDate: platformActiveChannels.lastPostDate,
          recentPostsCount: platformActiveChannels.recentPostsCount,
          recentViews: platformActiveChannels.recentViews,
          botStatus: platformActiveChannels.botStatus,
          isActive: platformActiveChannels.isActive,
          isCpv: platformActiveChannels.isCpv,
          moderationStatus: platformActiveChannels.moderationStatus,
        })
        .from(platformActiveChannels)
        .where(where)
        // Самые крупные/активные сверху — дефолтный порядок справочника.
        .orderBy(
          desc(platformActiveChannels.recentViews),
          platformActiveChannels.sourceKey,
        )
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      db
        .select({ filteredTotal: count() })
        .from(platformActiveChannels)
        .where(where) as Promise<{ filteredTotal: number }[]>,
      facetsCache?.key === cacheKey
        ? Promise.resolve(facetsCache)
        : Promise.all([
            db
              .select({
                platform: platformActiveChannels.platform,
                count: sql<number>`count(*)::int`,
              })
              .from(platformActiveChannels)
              .groupBy(platformActiveChannels.platform)
              .orderBy(desc(sql`count(*)`)),
            db
              .select({
                source: platformActiveChannels.source,
                count: sql<number>`count(*)::int`,
              })
              .from(platformActiveChannels)
              .groupBy(platformActiveChannels.source)
              .orderBy(desc(sql`count(*)`)),
          ]).then(([platforms, sources]) => {
            facetsCache = { key: cacheKey, platforms, sources };
            return facetsCache;
          }),
    ]);

    return c.json({
      records,
      filteredTotal: countRows[0]?.filteredTotal ?? 0,
      platforms: facets.platforms,
      sources: facets.sources,
      lastSyncAt: meta?.lastSyncAt?.toISOString() ?? null,
      lastStatus: meta?.lastStatus ?? null,
      registryTotal: meta?.total ?? 0,
      pageSize: PAGE_SIZE,
    });
  },
);

export default app;
