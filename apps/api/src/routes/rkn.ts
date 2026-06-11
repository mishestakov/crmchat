import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { and, desc, ilike, or, sql, count, eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { rknRecords, rknSync } from "../db/schema.ts";
import { ilikeContains } from "../lib/ilike.ts";
import type { SessionVars } from "../middleware/require-session.ts";

// Страница словаря РКН: поиск по реестру (главный сценарий — проверить
// блогера, которого ещё нет в CRM) + дата последнего синка. Реестр один на
// всех — путь глобальный (/v1/rkn, только requireSession), синк один на
// процесс, воркспейсы ничего своего не синкают.

const RknRecordSchema = z
  .object({
    uid: z.string(),
    network: z.string(),
    url: z.string(),
    title: z.string().nullable(),
    status: z.string(),
  })
  .openapi("RknRecord");

const RknListSchema = z
  .object({
    records: z.array(RknRecordSchema),
    // Всего под текущим фильтром (для пагинации).
    filteredTotal: z.number().int(),
    // Сети с количеством записей — чипы-фильтры.
    networks: z.array(
      z.object({ network: z.string(), count: z.number().int() }),
    ),
    // Мета синка: когда обновлялось и не упал ли последний синк.
    lastSyncAt: z.iso.datetime().nullable(),
    lastStatus: z.string().nullable(),
    registryTotal: z.number().int(),
    // Размер страницы — фронт считает пагинацию от него, не хардкодит.
    pageSize: z.number().int(),
  })
  .openapi("RknList");

const PAGE_SIZE = 50;

// networks-агрегат (GROUP BY по 200k) меняется только при синке — кэшируем
// по lastSyncAt, чтобы не пересчитывать на каждый ввод в поиск.
let networksCache: {
  key: string;
  data: { network: string; count: number }[];
} | null = null;

const app = new OpenAPIHono<{ Variables: SessionVars }>();

app.openapi(
  createRoute({
    method: "get",
    path: "/v1/rkn",
    tags: ["rkn"],
    request: {
      query: z.object({
        q: z.string().max(200).optional(),
        network: z.string().max(64).optional(),
        page: z.coerce.number().int().min(1).default(1),
      }),
    },
    responses: {
      200: {
        content: { "application/json": { schema: RknListSchema } },
        description: "RKN registry page",
      },
    },
  }),
  async (c) => {
    const { q, network, page } = c.req.valid("query");
    const term = q?.trim();
    const esc = term ? ilikeContains(term) : null;
    const where = and(
      network ? eq(rknRecords.network, network) : undefined,
      esc
        ? or(ilike(rknRecords.url, esc), ilike(rknRecords.title, esc))
        : undefined,
    );

    const [meta] = await db.select().from(rknSync).limit(1);
    const cacheKey = meta?.lastSyncAt?.toISOString() ?? "none";
    const [records, countRows, networks] = await Promise.all([
      db
        .select({
          uid: rknRecords.uid,
          network: rknRecords.network,
          url: rknRecords.url,
          title: rknRecords.title,
          status: rknRecords.status,
        })
        .from(rknRecords)
        .where(where)
        .orderBy(rknRecords.url)
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      db
        .select({ filteredTotal: count() })
        .from(rknRecords)
        .where(where) as Promise<{ filteredTotal: number }[]>,
      networksCache?.key === cacheKey
        ? Promise.resolve(networksCache.data)
        : db
            .select({
              network: rknRecords.network,
              count: sql<number>`count(*)::int`,
            })
            .from(rknRecords)
            .groupBy(rknRecords.network)
            .orderBy(desc(sql`count(*)`))
            .then((data) => {
              networksCache = { key: cacheKey, data };
              return data;
            }),
    ]);

    return c.json({
      records,
      filteredTotal: countRows[0]?.filteredTotal ?? 0,
      networks,
      lastSyncAt: meta?.lastSyncAt?.toISOString() ?? null,
      lastStatus: meta?.lastStatus ?? null,
      registryTotal: meta?.total ?? 0,
      pageSize: PAGE_SIZE,
    });
  },
);

export default app;
