// Нормализованный профиль площадки от внешнего провайдера (YouTube/TikTok).
// Провайдер ходит в соцсеть и возвращает ЭТО; запись в БД (channels.meta /
// member_count / synced_at / thumbnail) — общая, в index.ts. См.
// specs/etap-17-multiplatform.md.

// Одно видео/публикация из окна охвата. createdAt опционален: YouTube отдаёт
// publishedAt по каждому видео (→ фильтр «не старше 1 года» работает), а
// TikTok-профиль дат не отдаёт — берём ~11 последних как есть, без фильтра.
export type ProviderVideo = {
  views: number;
  likes?: number;
  comments?: number;
  shares?: number;
  createdAt?: Date;
};

// Агрегаты охвата по окну (после фильтра 1 год). Кладутся в channels.meta:
// medianViews → avg_reach, engagementRate → err, lastPostAt → meta.lastPostAt.
export type ReachWindow = {
  medianViews: number | null; // основной сигнал прогноза (устойчив к выбросам)
  engagementRate: number | null; // медиана (likes+comments+shares)/views, 0..1
  lastPostAt: string | null; // ISO — живость канала
};

// Метрики одной опубликованной публикации (фаза «Отчёт», metrics-worker).
// Платформо-нейтральная витрина: views/likes/comments/shares (см. колонки
// project_items в schema.ts). title/coverUrl — для снимка поста (17.5).
export type VideoMetrics = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  title: string | null;
  coverUrl: string | null;
};

// То, что провайдер отдаёт диспетчеру. Платформо-сырьё — в `raw` (ляжет в
// meta.yt / meta.tt).
export type ChannelProfile = {
  externalId: string | null; // ID канала в соцсети
  title: string;
  description: string | null;
  username: string | null; // @handle без `@`
  link: string | null;
  audience: number | null; // → member_count (подписчики/фолловеры; у YT/TT округлены)
  verified: boolean | null;
  // Аватар как URL соцсети (для TG храним base64-минитамбнейл отдельно; у
  // YT/TikTok — прямая ссылка, у TikTok с TTL ~часы, потому рефрешим синком).
  avatarUrl: string | null;
  reach: ReachWindow;
  raw: Record<string, unknown>; // → meta.yt / meta.tt
};
