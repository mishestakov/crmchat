import { eq, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { channels } from "../../db/schema.ts";
import {
  fetchDzenPostMetrics,
  fetchDzenProfile,
  parseDzenPostId,
} from "./dzen.ts";
import {
  fetchTiktokProfile,
  fetchTiktokVideoMetrics,
  parseTiktokVideoId,
  resolveTiktokShortlink,
} from "./tiktok.ts";
import {
  fetchYoutubeProfile,
  fetchYoutubeVideoMetrics,
  parseYoutubeVideoId,
} from "./youtube.ts";
import { parseChannelInput } from "@repo/core";
import type { ChannelProfile, VideoMetrics } from "./types.ts";
import type { PostSnapshot } from "../td-message.ts";

export type { ChannelProfile } from "./types.ts";

// Платформы с внешним HTTP-провайдером (не TDLib). Telegram синкается своим
// путём в channels.ts (syncChannelFromTg).
export const PROVIDER_PLATFORMS = ["youtube", "tiktok", "dzen"] as const;
export type ProviderPlatform = (typeof PROVIDER_PLATFORMS)[number];

export function isProviderPlatform(p: string): p is ProviderPlatform {
  return (PROVIDER_PLATFORMS as readonly string[]).includes(p);
}

// Платформа канала по строке ввода (построчное добавление в лонглист): ссылка
// youtube/tiktok → провайдер, иначе (t.me / @username / голое имя) → telegram.
export function detectChannelPlatform(
  input: string,
): "telegram" | ProviderPlatform {
  if (/youtube\.com|youtu\.be/i.test(input)) return "youtube";
  if (/tiktok\.com/i.test(input)) return "tiktok";
  if (/dzen\.ru|zen\.yandex\.ru/i.test(input)) return "dzen";
  return "telegram";
}

// Единый резолвер «адрес канала → платформа + идентификатор». Одна точка истины
// для CSV-импорта (и потенциально placements/bulk): платформа из домена, для TG
// — публичный @username (с дерайвом t.me-ссылки) или приватная инвайт-ссылка;
// для провайдеров — сама ссылка. null = мусор/пустая строка.
export function resolveChannelIdentifier(raw: string): {
  platform: "telegram" | ProviderPlatform;
  username: string | null;
  link: string | null;
} | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const platform = detectChannelPlatform(trimmed);
  if (platform !== "telegram") {
    return { platform, username: null, link: trimmed };
  }
  const { username, inviteLink } = parseChannelInput(trimmed);
  if (username) {
    return { platform, username, link: `https://t.me/${username}` };
  }
  if (inviteLink) return { platform, username: null, link: inviteLink };
  return null;
}

// Метрики вышедшего поста YouTube/TikTok по ссылке: парсим videoId (TikTok-
// шортлинк резолвим через 302), бьём по конкретному видео, собираем снимок-
// карточку (общая витрина PostSnapshot, как у TG; поля без провайдер-аналога
// занулены). Общий путь для metrics-worker (съём статистики) и capture-post
// (вставка ссылки на пост). Бросает — вызывающий маппит в 4xx/error.
export async function fetchProviderPost(
  platform: ProviderPlatform,
  url: string,
): Promise<{
  effectiveUrl: string;
  metrics: VideoMetrics;
  snapshot: PostSnapshot;
}> {
  let effectiveUrl = url;
  let videoId =
    platform === "youtube"
      ? parseYoutubeVideoId(url)
      : platform === "dzen"
        ? parseDzenPostId(url)
        : parseTiktokVideoId(url);
  if (!videoId && platform === "tiktok") {
    effectiveUrl = await resolveTiktokShortlink(url);
    videoId = parseTiktokVideoId(effectiveUrl);
  }
  if (!videoId) {
    throw new Error(`не удалось извлечь id видео из ссылки: ${url}`);
  }
  const metrics =
    platform === "youtube"
      ? await fetchYoutubeVideoMetrics(videoId)
      : platform === "dzen"
        ? await fetchDzenPostMetrics(videoId)
        : await fetchTiktokVideoMetrics(videoId);
  const snapshot: PostSnapshot = {
    platform,
    text: metrics.title ?? "",
    entities: [],
    thumbB64: null,
    thumbW: null,
    thumbH: null,
    coverUrl: metrics.coverUrl,
    url: effectiveUrl,
    media: null,
    views: metrics.views,
    forwards: null,
    reactions: [],
    capturedAt: new Date().toISOString(),
  };
  return { effectiveUrl, metrics, snapshot };
}

// Под какой ключ в meta кладём платформо-сырьё (meta.yt / meta.tt).
const META_KEY: Record<ProviderPlatform, string> = { youtube: "yt", tiktok: "tt", dzen: "dz" };

async function fetchProfile(
  platform: ProviderPlatform,
  input: string,
  now: number,
): Promise<ChannelProfile> {
  if (platform === "youtube") return fetchYoutubeProfile(input, now);
  if (platform === "dzen") return fetchDzenProfile(input, now);
  return fetchTiktokProfile(input, now);
}

// Pull карточки YouTube/TikTok-канала и запись в БД. Зеркалит syncChannelFromTg:
// типизированные колонки + meta (merge) + synced_at. properties/admins не
// трогаем. Кэш = synced_at (TTL-гейт — на стороне вызова, см. /sync). Аватар у
// YT/TikTok — URL (у TikTok с TTL), храним в meta.avatarUrl, рефрешим синком.
export async function syncChannelFromProvider(
  channel: typeof channels.$inferSelect,
): Promise<typeof channels.$inferSelect> {
  if (!isProviderPlatform(channel.platform)) {
    throw new Error(`syncChannelFromProvider: неподдерживаемая платформа ${channel.platform}`);
  }
  // Что скармливаем провайдеру: @handle, ссылка или внешний id — что есть.
  // link первым: канонический URL парсится обоими провайдерами. username после
  // первого синка — голый @handle без «@» (YouTube его не принимает → падал
  // re-sync), externalId TikTok'а — числовой id, embed его не ест.
  const input = channel.link ?? channel.username ?? channel.externalId;
  if (!input) throw new Error("у канала нет username/link/external_id для резолва");

  const p = await fetchProfile(channel.platform, input, Date.now());
  const { reach } = p;

  // avg_reach (медиана просмотров) + err (ER в %) — кросс-платформенный
  // контракт meta, который уже читают список каналов, медиаплан и клиентский
  // портал. Совпадает с тем, что пишет TG-путь (channels.ts metricsFromMessages).
  // Остальные поля — доп. сигнал для карточки канала.
  const metaPatch: Record<string, unknown> = {
    avg_reach: reach.medianViews,
    err: reach.engagementRate == null ? null : Math.round(reach.engagementRate * 1000) / 10,
    verified: p.verified,
    avatarUrl: p.avatarUrl,
    lastPostAt: reach.lastPostAt,
    // Лента карточки + тематика (YouTube topicCategories). Обложки — ссылки на
    // CDN площадки (не байты); у TikTok с TTL → освежаются этим же синком.
    topics: p.topics,
    recent_videos: p.recentVideos,
    [META_KEY[channel.platform]]: p.raw,
  };

  const [updated] = await db
    .update(channels)
    .set({
      externalId: p.externalId ?? channel.externalId,
      title: p.title || channel.title,
      description: p.description,
      username: p.username ?? channel.username,
      link: p.link ?? channel.link,
      memberCount: p.audience,
      meta: sql`${channels.meta} || ${JSON.stringify(metaPatch)}::jsonb`,
      syncedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(channels.id, channel.id))
    .returning();
  return updated!;
}
