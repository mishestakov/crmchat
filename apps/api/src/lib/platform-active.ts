import { sql } from "drizzle-orm";
import { z } from "@hono/zod-openapi";
import { db } from "../db/client.ts";
import { channels } from "../db/schema.ts";
import { channelMatchCandidatesSqlText } from "./channel-match-keys.ts";

// «Работает на платформе»: канал крутится у нас в CPC/CPA (суточный синк с YT в
// platform_active_channels). Симметричный матч по массиву отпечатков, поэтому
// канал, известный пока только по @username (external_id появляется лишь после
// открытия карточки), тоже находится. Это ИНФОРМ-сигнал, НЕ гейт: аутрич не
// блокируем (CPC/CPA-сигнал ненадёжен — админ мог смениться, у одного админа
// часть каналов активна), менеджер решает сам.

// Сводка активности канала на рекл-платформах Яндекса — питает обогащённый
// бейдж в списке лидов (состояние работает/простаивает/проблема + тултип).
export const PlatformActivitySchema = z.object({
  // Где крутится: cpc (Директ/tgads) и/или cpa (партнёрка). Канал может быть
  // сразу в обоих.
  sources: z.array(z.enum(["cpc", "cpa"])),
  // Свежесть за окно синка (60 дней): дата последнего поста + агрегаты.
  lastPostDate: z.string().nullable(), // YYYY-MM-DD
  recentPosts: z.number().int(),
  recentViews: z.number().int(),
  // Здоровье. CPC-only: is_active/is_cpv/bot_status. CPA-only: moderation_status.
  isActive: z.boolean().nullable(),
  isCpv: z.boolean().nullable(),
  moderationStatus: z.string().nullable(),
  botStatus: z.string().nullable(),
});
export type PlatformActivity = z.infer<typeof PlatformActivitySchema>;

// Сводка активности для набора каналов (страница лидов, ≤50) одним запросом.
// Почему не построчным подзапросом в SELECT списка лидов:
//  * count(*) OVER() в том запросе заставляет считать бейдж для ВСЕХ лидов
//    проекта, не только видимой страницы — тут считаем ровно для страницы;
//  * матч идёт через GIN-@> по одному элементу (pac.match_key содержит
//    кандидата) — планировщик берёт индекс. На `&&` с runtime-массивом он гнал
//    seqscan по 134k строк на каждый лид (прод: 25 лидов — 3.3 s).
// DISTINCT (channel, source_key) до агрегации: канал может совпасть с одной
// pac-строкой сразу по нескольким отпечаткам (username и external_id) — иначе
// суммы постов/показов задвоятся.
export async function fetchPlatformActivity(
  channelIds: string[],
): Promise<Map<string, PlatformActivity>> {
  const out = new Map<string, PlatformActivity>();
  if (channelIds.length === 0) return out;
  const rows = (await db.execute(sql`
    WITH ch_keys AS (
      SELECT DISTINCT ch.id AS channel_id, k AS match_key
      FROM ${channels} ch,
           unnest(${sql.raw(channelMatchCandidatesSqlText("ch"))}) AS k
      WHERE ch.id IN ${channelIds} AND k IS NOT NULL
    ),
    matched AS (
      SELECT DISTINCT ck.channel_id, pac.source_key,
             pac.source, pac.last_post_date, pac.recent_posts_count,
             pac.recent_views, pac.is_active, pac.is_cpv,
             pac.moderation_status, pac.bot_status
      FROM ch_keys ck
      JOIN platform_active_channels pac
        ON pac.match_key @> ARRAY[ck.match_key]
    )
    -- Агрегаты здоровья (max/bool_or) корректны, пока у канала ≤1 pac-строка на
    -- источник — обычный случай (source_key = cpc:chat_id / cpa:page уникален).
    -- Если канал совпадёт с 2+ строками ОДНОГО источника, max(moderation/bot) и
    -- bool_or(is_active) могут замаскировать «худший» сигнал благополучным.
    -- Осознанно принято: бейдж информационный (не гейт), а мультиматч на один
    -- источник — аномалия данных; «правильная» агрегация худшего непропорц-но.
    SELECT channel_id,
           array_agg(DISTINCT source ORDER BY source)  AS sources,
           max(last_post_date)::text                   AS last_post_date,
           coalesce(sum(recent_posts_count), 0)::int   AS recent_posts,
           coalesce(sum(recent_views), 0)::bigint      AS recent_views,
           bool_or(is_active)     AS is_active,
           bool_or(is_cpv)        AS is_cpv,
           max(moderation_status) AS moderation_status,
           max(bot_status)        AS bot_status
    FROM matched
    GROUP BY channel_id
  `)) as unknown as Array<{
    channel_id: string;
    sources: Array<"cpc" | "cpa">;
    last_post_date: string | null;
    recent_posts: number;
    recent_views: number | string;
    is_active: boolean | null;
    is_cpv: boolean | null;
    moderation_status: string | null;
    bot_status: string | null;
  }>;
  for (const r of rows) {
    out.set(r.channel_id, {
      sources: r.sources,
      lastPostDate: r.last_post_date,
      recentPosts: r.recent_posts,
      recentViews: Number(r.recent_views),
      isActive: r.is_active,
      isCpv: r.is_cpv,
      moderationStatus: r.moderation_status,
      botStatus: r.bot_status,
    });
  }
  return out;
}
