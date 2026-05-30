import { computeReach } from "./reach.ts";
import type { ChannelProfile, ProviderVideo, VideoMetrics } from "./types.ts";

// TikTok СТРОГО через публичный embed профиля (curl, без логина/браузера/WAF).
// Карта полей: /home/mike/tt/notes/embed-map.md.
//   /embed/@user → userInfo (счётчики ОКРУГЛЕНЫ) + videoList (~11 последних,
//                  на видео — playCount; createTime/вовлечения тут НЕТ).
// Один запрос: что профиль отдал, то и считаем. Средний охват = медиана
// playCount по этим ~11. ER по TikTok не считаем (нет вовлечений в профиле),
// фильтр «1 год» не применим (нет дат) — это и так последние видео.

const UA = "Mozilla/5.0";

// Достаём JSON из <script id="__FRONTITY_CONNECT_STATE__" ...>{...}</script>.
function extractState(html: string): Record<string, unknown> {
  const m = html.match(/id="__FRONTITY_CONNECT_STATE__"[^>]*>(.*?)<\/script>/s);
  if (!m?.[1]) throw new Error("TikTok embed: __FRONTITY_CONNECT_STATE__ не найден");
  const state = JSON.parse(m[1]) as { source?: { data?: Record<string, unknown> } };
  const data = state.source?.data;
  if (!data) throw new Error("TikTok embed: source.data пуст");
  return data;
}

// videoData из /embed/v2/<id> (карта полей: notes/embed-map.md §2). Точная
// стата на видео + caption (text) + обложки.
type TtVideoData = {
  itemInfos?: {
    text?: string;
    diggCount?: number;
    commentCount?: number;
    shareCount?: number;
    playCount?: number;
    covers?: string[];
  };
};

type TtUserInfo = {
  id?: string;
  uniqueId?: string;
  nickname?: string;
  signature?: string;
  avatarThumbUrl?: string;
  verified?: boolean;
  followerCount?: number;
  heartCount?: number;
};

export async function fetchTiktokProfile(
  input: string,
  now: number,
): Promise<ChannelProfile> {
  const username = input
    .trim()
    .replace(/^https?:\/\/(www\.)?tiktok\.com\/@?/, "")
    .replace(/^@/, "")
    .split(/[/?]/)[0]!;
  if (!username) throw new Error(`не похоже на TikTok-аккаунт: ${input}`);

  const res = await fetch(`https://www.tiktok.com/embed/@${username}`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`TikTok embed ${res.status} для @${username}`);
  const data = extractState(await res.text());

  const profile = data[`/embed/@${username}`] as
    | { userInfo?: TtUserInfo; videoList?: { id?: string; playCount?: number }[] }
    | undefined;
  const userInfo = profile?.userInfo;
  if (!userInfo?.uniqueId) {
    throw new Error(`TikTok-аккаунт не найден или приватный: @${username}`);
  }

  const videos: ProviderVideo[] = (profile?.videoList ?? [])
    .map((v) => Number(v.playCount))
    .filter((views) => Number.isFinite(views) && views > 0)
    .map((views) => ({ views })); // дат/вовлечений в профиле нет

  const handle = userInfo.uniqueId;
  return {
    externalId: userInfo.id ?? null,
    title: userInfo.nickname || handle,
    description: userInfo.signature || null,
    username: handle,
    link: `https://www.tiktok.com/@${handle}`,
    audience: userInfo.followerCount ?? null, // TikTok округляет followerCount/heartCount
    verified: userInfo.verified ?? null,
    avatarUrl: userInfo.avatarThumbUrl ?? null,
    reach: computeReach(videos, now),
    raw: {
      followerCount: userInfo.followerCount ?? null,
      heartCount: userInfo.heartCount ?? null, // всего лайков аккаунта (округл.)
    },
  };
}

// Достаём videoId (числовой aweme id) из ссылки на TikTok-видео. null — не видео.
export function parseTiktokVideoId(url: string): string | null {
  const s = url.trim();
  if (/^\d{6,}$/.test(s)) return s;
  const m = s.match(/\/(?:video|embed\/v2)\/(\d+)/);
  return m?.[1] ?? null;
}

// Шорт-ссылки TikTok (vm./vt.tiktok.com, tiktok.com/t/<code>) — это 302 на
// каноническую /@user/video/<id>. Резолвим один редирект и возвращаем Location;
// вызывающий сохраняет каноническую ссылку, чтобы не гонять редирект повторно.
// Не шорт-ссылка / резолв не удался → возвращаем исходный url без изменений.
export async function resolveTiktokShortlink(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "manual",
      headers: { "User-Agent": UA },
    });
    return res.headers.get("location") ?? url;
  } catch {
    return url;
  }
}

// Метрики одного TikTok-видео через /embed/v2/<id> — точные diggCount/
// commentCount/shareCount/playCount + caption/обложка. Один curl.
export async function fetchTiktokVideoMetrics(
  videoId: string,
): Promise<VideoMetrics> {
  const res = await fetch(`https://www.tiktok.com/embed/v2/${videoId}`, {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`TikTok embed ${res.status} для видео ${videoId}`);
  const data = extractState(await res.text());
  const vd = (data[`/embed/v2/${videoId}`] as { videoData?: TtVideoData } | undefined)
    ?.videoData;
  const ii = vd?.itemInfos;
  if (!ii) throw new Error(`TikTok-видео не найдено или приватное: ${videoId}`);
  return {
    views: ii.playCount != null ? Number(ii.playCount) : null,
    likes: ii.diggCount != null ? Number(ii.diggCount) : null,
    comments: ii.commentCount != null ? Number(ii.commentCount) : null,
    shares: ii.shareCount != null ? Number(ii.shareCount) : null,
    title: ii.text ?? null,
    coverUrl: vd?.itemInfos?.covers?.[0] ?? null,
  };
}
