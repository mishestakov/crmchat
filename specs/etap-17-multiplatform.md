# Этап 17 — Мультиплатформенность площадок (YouTube, TikTok)

> Статус: в работе. Источник истины по data shape мульти-площадок.
> Связано: `plan.md` (роадмап), `etap-16-agency.md` (агентский флоу), `data-model.md`.

## Продуктовая рамка

**Связь с блогером — всегда Telegram.** YouTube и TikTok не дают публичного
API для личек, и это не нужно: мы общаемся, согласуем креатив и ведём сделку
в TG-чате как сейчас. Чужие платформы всплывают ровно в двух местах:

1. **Где вышел пост** — строка медиаплана (`placement`) может указывать на
   YT/TikTok-площадку, а не только TG-канал.
2. **Откуда снимаем статистику** — у каждой платформы свой сборщик метрик,
   витрина общая.

Поэтому **блогер-человек = `contact`** (TG-якорь, связь через личку), а
**площадка = `channel`**, и у одного блогера их может быть несколько на
разных платформах (TG-канал + YouTube + TikTok), все привязаны через
`channel_admins`. Слой «с кем и как общаемся» не трогаем — расширяем только
слой «площадки и их метрики».

## Источники данных

### Telegram (TDLib) — как сейчас
Метрики поста через `getMessageLinkInfo → openChat → viewMessages →
updateMessageInteractionInfo` (см. `lib/metrics-worker.ts`). На пост:
`view_count`, `forward_count`, Σ`reactions`. Комментариев в `interaction_info`
нет.

### YouTube Data API v3 (по API-ключу `YOUTUBE_KEY`, без OAuth)
Прототип: `scripts/youtube-probe.mjs`. Резолв канала по `forHandle` /
`forUsername` / `channel/UC…` (НЕ через `search` — стоит 100 ед. квоты).

- **Канал** (`channels?part=snippet,statistics,contentDetails`):
  `subscriberCount` (**округлён** Google, либо `hiddenSubscriberCount`),
  `viewCount` (суммарно по каналу), `videoCount` (точно), `country`,
  `customUrl` (@handle), `publishedAt` (возраст), `thumbnails`,
  `contentDetails.relatedPlaylists.uploads` (плейлист загрузок).
- **Видео** (`videos?part=snippet,statistics,contentDetails`):
  `viewCount`, `likeCount`, `commentCount`, `dislikeCount` (**всегда null** —
  скрыт Google с 2021), `duration` (ISO-8601, отличить Shorts от long-form),
  `publishedAt`, `tags[]`.
- **Окно охвата:** `playlistItems` без пагинации — **до 50 id за 1 страницу**
  (1 ед.), затем 1 `videos.list` на эти 50 (1 ед.). Итого 2 ед. квоты.

### TikTok — СТРОГО два embed-эндпоинта (curl, без логина/браузера)
Карта полей: `/home/mike/tt/notes/embed-map.md`. Никакого `item_list` /
браузерного пути — только публичные embed'ы через `curl`:

- **Профиль** `/embed/@user` → `userInfo` (`followerCount` **округлён**,
  `heartCount` **округлён**, `verified`, `signature`, `avatarThumbUrl` — TTL) +
  `videoList` (**~11 последних** видео, БЕЗ пагинации; на видео только
  `playCount`).
- **Видео** `/embed/v2/<id>` → точные `diggCount` (лайки) / `commentCount` /
  `shareCount` / `playCount`, `createTime`, `authorStats.videoCount` (точно).

## Политика «среднего охвата» (единая для всех платформ)

1. Берём последние видео, что источник отдаёт **без пагинации** (TikTok ~11,
   YouTube ≤50, Telegram — последние N постов канала).
2. **Отбрасываем старше 1 года** по дате публикации (`createTime` /
   `publishedAt`). Охват отражает текущую форму блогера, а не старый вирус.
3. По оставшимся считаем **`medianViews`** (основной прогноз — устойчив к
   выбросам), `avgViews`, `reachSample` (по скольки видео посчитано).

`medianViews` фидит `project_items.forecast_views` при добавлении размещения.

## Data shape

### `channels`
- `platform`: enum `channel_platform` += `youtube`, `tiktok` (было
  `telegram | max`). Дедуп уже разведён по `(ws, platform, external_id)` и
  `(ws, platform, lower(username))` — конфликта хэндлов между платформами нет.
- `member_count` (есть) — нормализованный **размер аудитории**: TG members /
  YT subscribers / TikTok followers. У YT/TT — округлённое значение (документ.
  ниже).
- `meta` (jsonb, перетирается соц-pull'ом) — сырые поля платформы +
  вычисленные сигналы:
  ```ts
  {
    verified?: boolean,
    avgViews?: number,
    medianViews?: number,        // основной сигнал охвата
    reachSample?: number,        // по скольки видео (после фильтра 1 год)
    engagementRate?: number,     // вычисленный, 0..1
    lastPostAt?: string,         // ISO — живость канала
    postsPerWeek?: number,       // частота постинга
    audienceRounded?: boolean,   // true для YT/TT (подписчики округлены)
    // платформо-сырое:
    yt?: { subscriberCount, subscribersHidden, totalViews, videoCount,
           country, customUrl, createdAt },
    tt?: { followerCount, heartCount, videoCount },
    tg?: { /* как сейчас: supergroup_id, boost_level, is_verified, … */ },
  }
  ```
- `properties` (jsonb, наши/CSV, НЕ трогается pull'ом) — ручной ER-override,
  ниша, is_rkn. UI показывает `properties.er ?? meta.engagementRate`.

### `project_items` (placement) — обобщить TG-словарь метрик
Витрина метрик сейчас TG-специфична. Обобщаем на платформо-нейтральные 4:

| было | стало | TG | YouTube | TikTok |
|---|---|---|---|---|
| `metrics_views` | `metrics_views` | view_count | viewCount | playCount |
| `metrics_reactions` | **`metrics_likes`** | Σ reactions | likeCount | diggCount |
| — | **`metrics_comments`** (new) | — | commentCount | commentCount |
| `metrics_forwards` | **`metrics_shares`** | forward_count | — | shareCount |

`db:push` без миграций — переименовываем спокойно.

### `post_snapshot` (фаза «Отчёт»)
Сейчас TG-shape (`entities`, `thumbB64`, `messageId`/`chatId`). Обобщить
discriminated union по платформе: для YT/TikTok снимок = `coverUrl`/`coverB64`
+ `title` + `url` (+ `duration` для YT). Делается на стадии отчёта.

## Сборщики (metrics provider по `channel.platform`)
Диспетчер: `telegram` → TDLib (как есть), `youtube` → YT API-провайдер
(обёртка над логикой `youtube-probe.mjs`), `tiktok` → embed-провайдер (curl +
парс `__FRONTITY_CONNECT_STATE__`). Один интерфейс → общая витрина.

TikTok медиа-ссылки (обложки) живут часы — кешируем сразу в
`channel_thumbnails`, как TG-тамбнейлы.

## Этапы

- **17.1 Схема** — enum `youtube|tiktok`; переименование метрик
  (`reactions→likes`, `forwards→shares`, +`comments`). ✅
- **17.2 Сборщики площадок** — `lib/channel-providers/` (types/reach/youtube/
  tiktok/index). Окно охвата (фильтр 1 год для YT; TikTok — ~11 как есть).
  Провайдер пишет `meta.avg_reach` (медиана) + `meta.err` (ER %) — общий
  контракт с TG-путём — плюс доп. сигналы. Подключено к `POST /channels/{id}/
  sync` с TTL-гейтом 1ч. ✅
- **17.3 Раздел «Площадки»** — переименован «Каналы»→«Площадки» (сайдбар +
  заголовок); значок платформы в строке; чипы-фильтр по соцсети; платформо-
  зависимая ссылка на профиль; «средний охват» работает через общий
  `avg_reach`. **Добавление — единым импортом** с явным выбором платформы (одна
  площадка на импорт, без угадывания по URL); YT/TikTok-площадки наполняются
  данными **лениво** при первом открытии (provider-sync, TTL 1ч), без TDLib-
  аккаунта. Отдельный one-by-one попап убран. ✅
- **17.4 Метрики размещений по платформам** — `metrics-worker` диспетчеризует
  по `postUrl`: YT/TikTok → провайдер (`fetchYoutubeVideoMetrics` /
  `fetchTiktokVideoMetrics`, без TDLib-аккаунта), Telegram → TDLib как было.
  Пишет витрину views/likes/comments/shares. Снимок поста — пока null (17.5). ✅
- **17.5 Отчёт** — `PostSnapshotSchema` обобщён (опц. `platform`/`coverUrl`/
  `url`, `messageId`/`chatId` теперь необязательны). `runProviderMetrics` пишет
  снимок YT/TikTok (обложка-URL + caption + ссылка). `PostSnapshotCell` рендерит
  `coverUrl`, иначе `thumbB64`. Колонки метрик уже платформо-нейтральны
  (views/likes/comments/shares — общие иконки). ✅

### Сознательно НЕ делаем
- Автопополнение полного архива видео (TikTok без логина — только ~11;
  политика охвата это и не требует).
- Автодетект «пост вышел» для YT/TikTok — менеджер вставляет ссылку на видео
  вручную, дальше сборщик снимает метрики.
- Любое общение через YT/TikTok — связь только через Telegram.
