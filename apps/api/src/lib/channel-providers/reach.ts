import { median } from "../median.ts";
import type { ProviderVideo, ReachWindow } from "./types.ts";

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

// Единая политика «среднего охвата» для всех платформ (см. spec §политика):
// берём видео, что источник отдал без пагинации, ОТБРАСЫВАЕМ старше 1 года,
// по оставшимся считаем медиану просмотров (avg_reach) + ER + живость.
// `now` инжектится (а не Date.now()) — чистая функция, тестируема.
export function computeReach(
  videos: ProviderVideo[],
  now: number,
): ReachWindow {
  // Дата есть (YouTube) → отбрасываем старше года. Даты нет (TikTok-профиль) →
  // берём как есть: это и так последние ~11 видео.
  const recent = videos.filter(
    (v) => v.views > 0 && (!v.createdAt || now - v.createdAt.getTime() <= YEAR_MS),
  );
  if (recent.length === 0) {
    return { medianViews: null, engagementRate: null, lastPostAt: null };
  }

  const medianViews = median(recent.map((v) => v.views));

  // ER считаем только по видео, где есть хоть одна метрика вовлечения (у TG-
  // охвата лайки/комменты приходят не всегда; у YouTube нет репостов).
  const ers = recent
    .filter((v) => v.likes != null || v.comments != null || v.shares != null)
    .map((v) => ((v.likes ?? 0) + (v.comments ?? 0) + (v.shares ?? 0)) / v.views);

  // Живость — только если есть даты (TikTok-профиль их не отдаёт).
  const times = recent
    .map((v) => v.createdAt?.getTime())
    .filter((t): t is number => t != null);

  return {
    medianViews: medianViews == null ? null : Math.round(medianViews),
    engagementRate: ers.length > 0 ? Math.round((median(ers) ?? 0) * 1000) / 1000 : null,
    lastPostAt: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}
