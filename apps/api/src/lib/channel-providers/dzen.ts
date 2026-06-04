import { computeReach } from "./reach.ts";
import type {
  ChannelProfile,
  ProviderVideo,
  RecentVideo,
  VideoMetrics,
} from "./types.ts";

// Дзен СТРОГО через публичный JSON лаунчера (curl, без логина/cookie/браузера):
//   /api/v3/launcher/export?channel_name=<name> → channel.source (шапка) +
//   items[] «этажами» по типам контента. Один запрос: что отдал, то и считаем.
//
// Особенность площадки: просмотры есть ТОЛЬКО у статей (channel_article_floor).
// У видео/шортсов публичного счётчика просмотров нет. Поэтому окно охвата и
// лента карточки — по статьям: там полная витрина (views+likes+comments) и
// честный ER. Машинной даты у статей в ленте нет (date=""/«N минут назад») →
// как TikTok-профиль: берём верхний срез как есть, без фильтра «1 год».
//
// HTML-страницу dzen.ru НЕ трогаем — она отдаёт SSO-autologin-заглушку.

const UA = "Mozilla/5.0";
const EXPORT = "https://dzen.ru/api/v3/launcher/export";

// Имя канала из ввода: ссылка `dzen.ru/<name>` / `zen.yandex.ru/<name>` или
// голый `<name>`. Vanity-имя (eto_prosto). Служебные префиксы (a/, video/,
// id/) — это посты/непрямой формат, не имя канала.
function parseChannelName(input: string): string {
  const s = input.trim();
  const m = s.match(/(?:dzen\.ru|zen\.yandex\.ru)\/([^/?#]+)/i);
  const name = (m?.[1] ?? s).replace(/^@/, "").split(/[/?#]/)[0]!;
  if (!name || /^(a|video|id|profile|suite)$/i.test(name)) {
    throw new Error(`не похоже на vanity-канал Дзена: ${input}`);
  }
  return name;
}

type DzenSocial = { social_network?: string; link?: string; name?: string };
type DzenTariff = {
  name?: string;
  price?: number; // в копейках
  period?: number;
  periodType?: string;
};
type DzenSource = {
  publisher_id?: string;
  owner_uid?: number;
  metrica_id?: number;
  title?: string;
  description?: string;
  subscribers?: number;
  is_verified?: boolean;
  logo?: string;
  social_links?: DzenSocial[];
  public_emails?: string[];
  public_phones?: string[];
  isDonationEnabled?: boolean;
  rknBloggersMark?: { isEnabled?: boolean; link?: string };
  premium?: { tariffs?: DzenTariff[] };
};

type DzenArticle = {
  publication_object_id?: string;
  title?: string;
  image?: string; // готовый URL обложки (scale_1200)
  views?: number;
  share_link?: string;
  socialInfo?: { likesCount?: number; commentCount?: number };
};

type DzenFloor = { type?: string; items?: DzenArticle[] };
type DzenExport = { channel?: { source?: DzenSource }; items?: DzenFloor[] };

export async function fetchDzenProfile(
  input: string,
  now: number,
): Promise<ChannelProfile> {
  const name = parseChannelName(input);

  const url = new URL(EXPORT);
  url.searchParams.set("channel_name", name);
  url.searchParams.set("lang", "ru");
  url.searchParams.set("country_code", "ru");
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Дзен export ${res.status} для ${name}`);
  const data = (await res.json()) as DzenExport;

  const src = data.channel?.source;
  if (!src?.publisher_id) {
    throw new Error(`Дзен-канал не найден или приватный: ${name}`);
  }

  const articles =
    data.items?.find((f) => f.type === "channel_article_floor")?.items ?? [];

  // Окно охвата — по статьям (views + лайки/комменты). computeReach сам
  // отбросит статьи без просмотров; ER = медиана (likes+comments)/views.
  const videos: ProviderVideo[] = articles
    .filter((a) => Number(a.views) > 0)
    .map((a) => ({
      views: Number(a.views),
      likes: a.socialInfo?.likesCount,
      comments: a.socialInfo?.commentCount,
    }));

  // Лента карточки — статьи: обложка-URL + заголовок + просмотры/лайки/комменты.
  // durationSec/publishedAt не у статей (нет даты) → null.
  const recentVideos: RecentVideo[] = articles
    .filter((a): a is DzenArticle & { publication_object_id: string } =>
      Boolean(a.publication_object_id),
    )
    .slice(0, 12)
    .map((a) => ({
      id: a.publication_object_id,
      url: a.share_link ?? `https://dzen.ru/a/${a.publication_object_id}`,
      title: a.title ?? null,
      coverUrl: a.image || null,
      views: typeof a.views === "number" ? a.views : null,
      likes: a.socialInfo?.likesCount ?? null,
      comments: a.socialInfo?.commentCount ?? null,
      publishedAt: null,
      durationSec: null,
    }));

  return {
    externalId: src.publisher_id,
    title: src.title || name,
    description: src.description || null,
    username: name,
    link: `https://dzen.ru/${name}`,
    audience: src.subscribers ?? null, // точное число (не округлено, в отличие от TT/YT)
    verified: src.is_verified ?? null,
    avatarUrl: src.logo || null,
    reach: computeReach(videos, now),
    topics: [], // Дзен тематику не отдаёт
    recentVideos,
    // → meta.dz. Контакты/соцсети/РКН/premium рендерит карточка канала.
    // subscribers не дублируем — это типизированный audience → member_count.
    raw: {
      owner_uid: src.owner_uid ?? null,
      metrica_id: src.metrica_id ?? null,
      emails: src.public_emails ?? [],
      phones: src.public_phones ?? [],
      social_links: (src.social_links ?? []).map((s) => ({
        net: s.social_network ?? null,
        name: s.name ?? null,
        link: s.link ?? null,
      })),
      donations_enabled: src.isDonationEnabled ?? false,
      rkn:
        src.rknBloggersMark?.isEnabled && src.rknBloggersMark.link
          ? { link: src.rknBloggersMark.link }
          : null,
      premium_tariffs: (src.premium?.tariffs ?? []).map((t) => ({
        name: t.name ?? null,
        price_rub: typeof t.price === "number" ? t.price / 100 : null,
        period: t.period && t.periodType ? `${t.period} ${t.periodType}` : null,
      })),
    },
  };
}

// ID поста Дзена из ссылки: статья `dzen.ru/a/<id>`, видео
// `dzen.ru/video/watch/<id>`. null — не пост.
export function parseDzenPostId(url: string): string | null {
  // id поста — hex (object_id) или base64url-подобный short-id (буквы любого
  // регистра, цифры, `-`/`_`), напр. /a/aiFhfvBguAKNZF-q.
  const m = url.trim().match(/\/(?:a|video\/watch)\/([a-zA-Z0-9_-]+)/);
  return m?.[1] ?? null;
}

// Метрики отдельного поста Дзена (capture-post / metrics-worker). Эндпоинт
// одного поста ещё не подключён — отдельным слоем. Бросаем явную ошибку,
// чтобы fetchProviderPost не возвращал пустой снимок молча.
export function fetchDzenPostMetrics(_postId: string): Promise<VideoMetrics> {
  return Promise.reject(
    new Error("Дзен: съём метрик отдельного поста пока не поддержан"),
  );
}
