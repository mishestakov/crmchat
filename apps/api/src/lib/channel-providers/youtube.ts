import { computeReach } from "./reach.ts";
import type { ChannelProfile, ProviderVideo, VideoMetrics } from "./types.ts";

// YouTube Data API v3 по API-ключу (без OAuth). Прототип:
// scripts/youtube-probe.mjs. Резолв канала через forHandle/forUsername/UC-id —
// НЕ через search (стоит 100 ед. квоты). Подписчики приходят ОКРУГЛЁННО,
// dislikeCount скрыт Google (всегда отсутствует). Окно охвата: одна страница
// uploads-плейлиста (≤50, без пагинации) → videos.list. Итого ~3 ед. квоты.

const API = "https://www.googleapis.com/youtube/v3";

type YtTarget =
  | { by: "id"; value: string }
  | { by: "handle"; value: string }
  | { by: "username"; value: string };

// Разбор ссылки/хэндла на канал. Возвращает null для video-ссылок и мусора —
// площадка в нашей модели = канал, не отдельное видео. (Имя с префиксом, чтобы
// не путать с parseChannelInput из @repo/core — у того TG-семантика.)
function parseYoutubeChannelInput(raw: string): YtTarget | null {
  const s = raw.trim();
  if (/^UC[\w-]{22}$/.test(s)) return { by: "id", value: s };
  if (s.startsWith("@")) return { by: "handle", value: s };

  let u: URL;
  try {
    u = new URL(s.includes("://") ? s : `https://${s}`);
  } catch {
    // не ссылка и не UC-id → трактуем как голый хэндл
    return { by: "handle", value: `@${s.replace(/^@/, "")}` };
  }
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] === "channel" && parts[1]) return { by: "id", value: parts[1] };
  if (parts[0] === "user" && parts[1])
    return { by: "username", value: parts[1] };
  if (parts[0]?.startsWith("@")) return { by: "handle", value: parts[0] };
  if (parts[0] === "c" && parts[1]) return { by: "handle", value: `@${parts[1]}` };
  return null;
}

async function ytApi(
  path: string,
  params: Record<string, string>,
  key: string,
): Promise<{ items?: unknown[] }> {
  const url = new URL(`${API}/${path}`);
  url.search = new URLSearchParams({ ...params, key }).toString();
  const res = await fetch(url);
  const json = (await res.json()) as {
    items?: unknown[];
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(`YouTube API ${res.status}: ${json?.error?.message ?? res.statusText}`);
  }
  return json;
}

// Фильтр channels.list по типу таргета. forHandle/forUsername принимаются на
// полном part-запросе — отдельный resolve-вызов не нужен.
function channelFilter(target: YtTarget): Record<string, string> {
  if (target.by === "id") return { id: target.value };
  if (target.by === "handle") return { forHandle: target.value };
  return { forUsername: target.value };
}

type YtChannel = {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    customUrl?: string;
    country?: string;
    publishedAt?: string;
    thumbnails?: { medium?: { url?: string }; default?: { url?: string } };
  };
  statistics?: {
    subscriberCount?: string;
    hiddenSubscriberCount?: boolean;
    viewCount?: string;
    videoCount?: string;
  };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
};

type YtVideo = {
  id: string;
  snippet?: { publishedAt?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
};

export async function fetchYoutubeProfile(
  input: string,
  now: number,
): Promise<ChannelProfile> {
  const key = process.env.YOUTUBE_KEY;
  if (!key) throw new Error("YOUTUBE_KEY не задан в окружении");

  const target = parseYoutubeChannelInput(input);
  if (!target) {
    throw new Error(`не похоже на ссылку/хэндл YouTube-канала: ${input}`);
  }

  // Один channels.list: фильтр (id/forHandle/forUsername) + полный part.
  const chRes = await ytApi(
    "channels",
    { part: "snippet,statistics,contentDetails", ...channelFilter(target) },
    key,
  );
  const ch = chRes.items?.[0] as YtChannel | undefined;
  if (!ch) throw new Error(`YouTube-канал не найден: ${input}`);

  const sn = ch.snippet ?? {};
  const st = ch.statistics ?? {};

  // Окно охвата: последние ≤50 видео из uploads-плейлиста → их метрики.
  const videos: ProviderVideo[] = [];
  const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
  if (uploads) {
    const pl = await ytApi(
      "playlistItems",
      { part: "contentDetails", playlistId: uploads, maxResults: "50" },
      key,
    );
    const ids = (pl.items ?? [])
      .map((i) => (i as { contentDetails?: { videoId?: string } }).contentDetails?.videoId)
      .filter((v): v is string => Boolean(v));
    if (ids.length > 0) {
      const vidRes = await ytApi(
        "videos",
        { part: "snippet,statistics", id: ids.join(",") },
        key,
      );
      for (const raw of vidRes.items ?? []) {
        const v = raw as YtVideo;
        const views = Number(v.statistics?.viewCount);
        const published = v.snippet?.publishedAt;
        if (!Number.isFinite(views) || !published) continue;
        videos.push({
          views,
          likes: v.statistics?.likeCount != null ? Number(v.statistics.likeCount) : undefined,
          comments:
            v.statistics?.commentCount != null
              ? Number(v.statistics.commentCount)
              : undefined,
          // У YouTube нет публичного счётчика репостов.
          createdAt: new Date(published),
        });
      }
    }
  }

  const subs = st.hiddenSubscriberCount ? null : Number(st.subscriberCount);
  const handle = sn.customUrl?.replace(/^@/, "") ?? null;

  return {
    externalId: ch.id,
    title: sn.title ?? handle ?? ch.id,
    description: sn.description || null,
    username: handle,
    link: handle ? `https://www.youtube.com/@${handle}` : `https://www.youtube.com/channel/${ch.id}`,
    audience: Number.isFinite(subs) ? subs : null, // YouTube округляет публичных подписчиков
    verified: null, // нет в публичном API канала
    avatarUrl: sn.thumbnails?.medium?.url ?? sn.thumbnails?.default?.url ?? null,
    reach: computeReach(videos, now),
    raw: {
      subscriberCount: subs,
      subscribersHidden: Boolean(st.hiddenSubscriberCount),
      totalViews: st.viewCount != null ? Number(st.viewCount) : null,
      videoCount: st.videoCount != null ? Number(st.videoCount) : null,
      country: sn.country ?? null,
      customUrl: sn.customUrl ?? null,
      createdAt: sn.publishedAt ?? null,
    },
  };
}

// Достаём videoId из любой формы YouTube-ссылки на видео. null — не видео.
export function parseYoutubeVideoId(url: string): string | null {
  const s = url.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  let u: URL;
  try {
    u = new URL(s.includes("://") ? s : `https://${s}`);
  } catch {
    return null;
  }
  if (u.hostname.replace(/^www\./, "") === "youtu.be") {
    return u.pathname.split("/").filter(Boolean)[0] ?? null;
  }
  const v = u.searchParams.get("v");
  if (v) return v;
  const parts = u.pathname.split("/").filter(Boolean);
  if (["shorts", "embed", "live"].includes(parts[0] ?? "")) return parts[1] ?? null;
  return null;
}

// Метрики одного YouTube-видео (фаза «Отчёт»). 1 ед. квоты.
export async function fetchYoutubeVideoMetrics(
  videoId: string,
): Promise<VideoMetrics> {
  const key = process.env.YOUTUBE_KEY;
  if (!key) throw new Error("YOUTUBE_KEY не задан в окружении");

  const r = await ytApi(
    "videos",
    { part: "snippet,statistics", id: videoId },
    key,
  );
  const v = r.items?.[0] as
    | { snippet?: { title?: string; thumbnails?: { medium?: { url?: string } } }; statistics?: YtVideo["statistics"] }
    | undefined;
  if (!v) throw new Error(`YouTube-видео не найдено или скрыто: ${videoId}`);
  const st = v.statistics ?? {};
  return {
    views: st.viewCount != null ? Number(st.viewCount) : null,
    likes: st.likeCount != null ? Number(st.likeCount) : null,
    comments: st.commentCount != null ? Number(st.commentCount) : null,
    shares: null, // YouTube не отдаёт публичный счётчик репостов
    title: v.snippet?.title ?? null,
    coverUrl: v.snippet?.thumbnails?.medium?.url ?? null,
  };
}
