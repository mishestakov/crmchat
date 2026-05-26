# Этап 16: Агентский продукт — клиенты, кампании, медиаплан, размещения

Документ описывает целевое поведение **агентского юз-кейса** на той же кодовой
базе, что и BD-сценарий (Саша). Архитектурный фундамент заложен в этапе 12
(Track→Project→Item с `kind` discriminator) — здесь раскрываем `kind='agency'`
полностью.

Уровень детализации — продуктовый, с конкретными полями, правилами и
состояниями. Реализация — отдельным проходом, спека сначала.

---

## 1. Контекст: что меняем

### 1.1 Как агентство работает сейчас (as-is)

Канонический процесс (см. также `product.md` агентского сценария):

1. Рекл присылает в агентство бриф + ТЗ: даты, суть кампании, бюджет, каналы
   (платформы, размеры), TOV, ограничения, KPI.
2. Агентство собирает **подборку блогеров** под ТЗ:
   - отбирает по нишам, размерам, формату;
   - доходит до блогеров с оффером (что рекламируем, даты, условия — pre/postpay);
   - собирает **медиаплан** в гуглшите: блогер · дата · ПДП · ERR · охваты ·
     CPV · цена.
3. Рекл размечает строки медиаплана: «ОК / не ОК / под вопросом».
4. Агентство ищет замену для неОКнутых.
5. (Параллельно с 6) — Агентство отправляет блогеру договор (PDF в почте,
   обмен сканами, реже ЭДО), подписывает.
6. (Параллельно с 5) — Агентство собирает с блогера **драфт текста +
   креатива** (обычно гуглдок). Чекает соответствие ТЗ. Передаёт реклу.
7. Рекл либо ОКает, либо вносит правки.
8. Агентство передаёт блогеру правки.
9. Финально договариваются о дате выхода (плавающая до этого момента).
10. Агентство маркирует пост (получает ЕРИД, передаёт блогеру вместе с
    данными рекла).
11. Блогер наносит ЕРИД на креатив (обычно левый нижний угол).
12. В оговоренное время выходит пост.
13. Блогер присылает агентству подписанный Акт.
14. Агентство вносит в медиаплан фактические метрики (охваты, CPV, ERR).
15. Агентство собирает реклу **посткампейн-отчёт** (выводы по кампании).

### 1.2 Боли as-is процесса

- **Гуглшит как медиаплан** — обмен файлами туда-сюда, нет live-синхронизации,
  нет audit-trail кто и когда ОКнул блогера.
- **Почта/телега как канал коммуникации** с реклом — теряются документы,
  правки висят в нечитаемых тредах.
- **Артефакты разбросаны**: договор в почте, креатив в гуглдоке, ЕРИД в
  карточке ОРД, скрин в чате с блогером.
- **Метрики собираются вручную** — менеджер заходит в TG, листает каналы,
  переписывает охваты в гуглшит.
- **Постотчёт пишется с нуля** — данные приходится собирать заново из
  гуглшита и почты.

### 1.3 Что меняем в самом процессе (to-be)

Главная идея: **все три стороны (агентство, рекл, блогер) работают в одной
системе**, без перекидывания файлов и таблиц между ними.

| Шаг as-is | To-be |
|---|---|
| Бриф = ФОС / гугл-форма | Бриф в системе (на MVP — текстовое поле, потом структурированная форма) |
| Подборка = гуглшит, который шлём раз в день | Live-медиаплан в системе, клиент видит обновления как агентство добавляет блогеров |
| ОК/неОК = комменты в шите | Кнопки «Подходит / Не подходит / Под вопросом» + причина, лог |
| Договор = PDF в почте | Загрузка скана + статус (на MVP без e-sign) |
| Драфт креатива = гуглдок | Загрузка файлов + комменты + раунды правок |
| ЕРИД = ручной запрос в ОРД | Поле на размещении, заполняется менеджером (на MVP — без интеграции с ОРД) |
| Дата выхода = «договорились в чатике» | Поле размещения, один источник для всех |
| Метрики поста = переписать вручную | **Менеджер кликает «Снять статистику» → TDLib забирает контент и метрики поста** |
| Постотчёт = гуглдок | Текст + автоагрегаты по кампании, шарится клиенту той же magic-link |

### 1.4 Чего НЕ делаем в MVP этого этапа

Чтобы не строить космический корабль — явно отрезаем:

- **E-sign договоров и актов.** Грузим сканы PDF, статус «загружен / подписан».
- **Интеграция с ОРД (Яндекс).** ЕРИД заносится менеджером руками в поле.
- **Встроенный редактор креативов.** Грузим файлы (текст в .docx, видео,
  картинки). Правки — через комменты к загруженному файлу.
- **Visual screenshot канала** (puppeteer/headless Chrome). Берём через
  TDLib **копию контента поста** (текст + media-файлы). Для отчёта этого
  достаточно. Полноценный пиксельный скриншот — отложено.
- **Auto-расписание сбора метрик** (24ч/48ч/7д). На MVP — менеджер
  инициирует сбор кнопкой. Автоматизация — отложено.
- **Финансы first-class** (предоплата/постоплата, акты с реклом, выплаты
  блогерам, отдельные транзакции, отчёт по марже). На MVP — только поля
  `price` на размещении и `budget` на проекте + derived маржа в UI.
- **Постотчёт PDF-генерация по шаблону.** Текстовое поле + блок
  автоагрегатов на странице, шарится по той же magic-link. PDF-экспорт —
  отложено.
- **Динамические UI-лейблы по kind проекта.** Везде «Клиенты / Кампании /
  Размещения» по-русски (агентский продукт самостоятельный), а не
  переключаемые «Папки / Проекты / Карточки» как в BD-сценарии. Сплит —
  по `workspace.mode` (см. §10), не по kind. kind — производный от mode.

---

## 2. Главные принципы

1. **Архитектурно сразу правильно, функционально — минимум.** Модель данных
   без костылей (отдельные таблицы для шар-токенов и артефактов,
   `kind='agency'` на проекте, `kind='placement'` на item'е). UI — только
   нужные тут-сейчас экраны.
2. **Канбан для агентского НЕ ИСПОЛЬЗУЕТСЯ.** Главный экран кампании —
   **фазовый визард** (бриф → лонглист → согласование → финальный оффер →
   производство → отчёт), внутри каждой фазы таблица + drawer на строке.
   Свободная навигация между фазами (см. §16). Канбан из etap-12 остаётся
   для BD-сценария (`kind='outreach'`).
3. **Клиент работает по magic-link, без аккаунта в users.** Без email:
   генерим уникальную ссылку `/share/{token}` (256-битный токен), доступ =
   знание ссылки (как Google Docs). Менеджер копирует и шлёт реклу как
   угодно. Никакой регистрации (см. §16, отклонение от §6).
4. **Все артефакты лежат в системе.** Договор, креатив, скрин, акт —
   `placement_files` с типом и статусом. Не «ссылка на гуглдок» в текстовом
   поле.
5. **База блогеров общая на воркспейс.** Никакого scope per-клиент.
   Агентство копит ресурс — это его актив.
6. **Sticky-аккаунт работает как в BD** (этап 10.6). Если менеджер уже
   общался с блогером в прошлой кампании, новые сообщения идут с того же
   аккаунта — блогер не получает несинхронные оффера от разных людей.

---

## 3. Доменная модель (что добавляем к этапу 12)

### 3.1 Track (kind='client') — расширения

`tracks.kind = 'client'` уже есть в схеме (этап 12). Используется как
**Клиент** в агентском продукте. **kind проставляется автоматически** из
`workspace.mode='agency'` при insert'е (см. §10), юзер kind не выбирает
ни в API, ни в UI.

**Используем `tracks.properties` jsonb** для расширений (без миграции
схемы):
- `legal_entity` — юр.лицо клиента (для договора с агентством).
- `inn`, `kpp` — реквизиты.
- `accountant_contact` — контакт бухгалтерии (для платежей).
- `notes` — заметки менеджера.

Эти поля — конфигурация UI, рендерятся как form-fields на странице
клиента. Хранятся в `properties` чтобы не плодить колонок — это
конфигурируемые поля, не индексируемые.

**Бизнес-правила:**
- Создаёт/редактирует/удаляет — **admin** воркспейса (как в этапе 12).
- Каскадно удаляет кампании клиента (FK CASCADE).
- Видны всем member'ам.

### 3.2 Project (kind='agency') — расширения

`projects.kind = 'agency'` уже задекларировано. Сейчас агентский проект
использует базовый набор полей + добавляем явные колонки для часто
запрашиваемых атрибутов и jsonb для остального. **kind проставляется
автоматически** из `workspace.mode='agency'` при insert'е (см. §10).

**Новые колонки в `projects` (миграция):**

| Колонка | Тип | Что |
|---|---|---|
| `brief` | text nullable | Бриф кампании (markdown plain). MVP не структурирует. |
| `budget_amount` | numeric(12,2) nullable | Бюджет от клиента |
| `budget_currency` | text default `'RUB'` | Валюта бюджета (RUB по умолчанию) |
| `period_start` | timestamptz nullable | Начало кампании |
| `period_end` | timestamptz nullable | Конец кампании |
| `kpi` | text nullable | Целевой KPI (CPV/CPC/охваты — свободный текст) |
| `tov` | text nullable | Tone of voice (свободный текст) |
| `constraints` | text nullable | Что нельзя (свободный текст) |

Все nullable — заполняются по мере того как менеджер разбирается с
кампанией.

**Snapshot-fields из этапа 12** (`messages`, `accountsMode`,
`accountsSelected`) — **используются** в agency-проектах: лонглист-аутрич и
финальный оффер шлются через тот же механизм цепочек + worker, что в BD
(см. §16). Это исправление: раньше спека утверждала, что цепочки не часть
agency-процесса — на деле массовый аутрич по блогерам идёт именно через них.

**Бизнес-правила:**
- Создание/редакт/удаление/активация/пауза — **admin** воркспейса.
- При создании указывается `trackId` (клиент) и `name` (название кампании).
- Status-переходы (`draft → active → paused/done`) сохраняются, но смысл
  сдвигается:
  - `draft` — кампания собирается, бриф ещё уточняется, медиаплан в работе.
  - `active` — медиаплан согласован клиентом частично или полностью, идут
    размещения.
  - `paused` — клиент попросил остановиться (force majeure, бюджет
    закончился).
  - `done` — все размещения закрыты актом, постотчёт отправлен.
- Активация agency-проекта **запускает worker'а** (лонглист-рассылка) —
  через тот же `activate` + `scheduled_messages`, что в BD. Получатель
  каждого размещения — админ канала (`item.contact_id`). См. §16.

### 3.3 Item (kind='placement') — основная сущность кампании

`project_items.kind = 'placement'` уже задекларировано. Размещение =
строка медиаплана = «выход поста у одного блогера в одной кампании».
**kind проставляется автоматически** из `workspace.mode='agency'` при
insert'е (см. §10).

**Новые колонки в `project_items` (миграция):**

| Колонка | Тип | Что |
|---|---|---|
| `channel_id` | text → channels FK CASCADE nullable | (для placement) канал из общей базы |
| `scheduled_at` | timestamptz nullable | Планируемая дата выхода |
| `published_at` | timestamptz nullable | Фактическая дата выхода |
| `post_url` | text nullable | URL поста (`https://t.me/channel/123`) |
| `post_message_id` | bigint nullable | TG message_id (parse из post_url, для TDLib-метрик) |
| `price_amount` | numeric(12,2) nullable | Сколько платим блогеру |
| `price_currency` | text default `'RUB'` | Валюта цены |
| `forecast_views` | int nullable | Прогнозный охват |
| `forecast_err` | numeric(5,2) nullable | Прогнозный ERR в % |
| `actual_views` | int nullable | Факт охвата (из TDLib) |
| `actual_reactions` | int nullable | Факт реакций (из TDLib) |
| `actual_comments` | int nullable | Факт комментариев (из TDLib) |
| `metrics_fetched_at` | timestamptz nullable | Когда последний раз тянули метрики |
| `erid` | text nullable | ЕРИД (вводится менеджером руками) |
| `erid_advertiser_data` | text nullable | Данные рекла для пометки (ИНН + название) |
| `client_status` | enum(`pending`/`approved`/`rejected`/`replace`) default `'pending'` | Решение клиента по строке медиаплана |
| `client_status_comment` | text nullable | Комментарий клиента к решению |
| `client_status_at` | timestamptz nullable | Когда клиент проставил статус |
| `act_received_at` | timestamptz nullable | Когда блогер прислал подписанный акт |

**Computed-поле `workflow_status`** (не в БД, derive в API):

- `pending_approval` — `client_status='pending'`.
- `rejected` — `client_status IN ('rejected', 'replace')`.
- `awaiting_publish` — `client_status='approved'` AND `published_at IS NULL`.
- `published` — `published_at IS NOT NULL` AND `act_received_at IS NULL`.
- `closed` — `act_received_at IS NOT NULL`.

**Уникальность:**
- Один канал в одной кампании может быть **несколько раз** (если рекл
  заказал 3 поста у одного блогера за период). Не делаем unique на
  `(project_id, channel_id)`.
- Дедуп — на стороне UI «вы уже добавили этот канал, добавить ещё раз?».

**Identity:**
- На MVP идентифицируем размещение по `channel_id`. У канала могут быть
  админы (через `channel_admins`), коммуникация с админом через TG —
  отдельный слой (см. §3.5).

### 3.4 PlacementFile — артефакты размещения (новая таблица)

```
placement_files (
  id                text PK,
  workspace_id      text → workspaces FK CASCADE,
  placement_id      text → project_items FK CASCADE,
  kind              enum(`contract`/`creative`/`screenshot`/`act`/`other`),
  file_url          text NOT NULL,
  original_name     text NOT NULL,
  mime_type         text,
  size_bytes        bigint,
  status            enum(`draft`/`pending_review`/`approved`/`rejected`) default 'draft',
  status_comment    text nullable,
  uploaded_by       text → users FK,
  uploaded_at       timestamptz default now(),
  approved_by       text → users FK nullable,
  approved_at       timestamptz nullable,
  notes             text nullable
);

INDEX placement_files (placement_id);
INDEX placement_files (workspace_id);
```

**Kind:**
- `contract` — договор с блогером.
- `creative` — драфт текста/картинки/видео. Может быть **несколько
  версий** одного kind'а (раунды правок) — UI берёт последнюю по
  `uploaded_at`, история видна в drawer'е.
- `screenshot` — копия опубликованного поста (текст + media). Может быть
  загружена менеджером вручную или авто-собрана через TDLib (см. §8).
- `act` — подписанный акт от блогера.
- `other` — прочее (referral-ссылки, дополнительные документы).

**Status (для creative и contract):**
- `draft` — загружено, не отправлено на ревью.
- `pending_review` — отправлено клиенту на согласование.
- `approved` — клиент одобрил.
- `rejected` — клиент отклонил, нужны правки.

Для `screenshot` и `act` — status='draft' семантически бессмысленен, но
поле общее. UI игнорирует.

**File storage**: на MVP — локальный disk-storage в
`/var/lib/crmchat/uploads/{workspace_id}/{placement_id}/{file_id}.{ext}`,
endpoint `GET /v1/files/{file_id}` отдаёт с проверкой доступа (member +
RBAC по проекту, либо валидная client-session по `project_shares`).
S3/object-storage — отложено в этап прод-готовности.

### 3.5 ProjectShare — magic-link для клиента (новая таблица)

```
project_shares (
  id              text PK,
  workspace_id    text → workspaces FK CASCADE,
  project_id      text → projects FK CASCADE,
  token           text NOT NULL,            -- 32+ символа random, индекс UNIQUE
  email           text NOT NULL,            -- кому отправили
  kind            enum(`client_view`) default 'client_view',  -- на будущее
  expires_at      timestamptz nullable,     -- null = бессрочно
  last_seen_at    timestamptz nullable,     -- обновляется при каждом запросе
  revoked_at      timestamptz nullable,     -- soft-delete (агентство отозвало)
  created_by      text → users FK,
  created_at      timestamptz default now()
);

UNIQUE INDEX project_shares (token);
INDEX project_shares (project_id);
```

**Жизненный цикл:**

1. Менеджер на странице кампании → таб «Доступ клиента» → кнопка
   «Поделиться с клиентом» → форма (email + опц. срок) → POST
   `/projects/{id}/shares` → создаётся row, на email отправляется письмо
   со ссылкой `https://app/share/{token}`.
2. Клиент открывает ссылку → бэк проверяет токен (не revoked, не expired)
   → ставит httpOnly cookie `share_token={token}` (Max-Age = 90 дней либо
   до expires_at) → редиректит на client-view страницу.
3. Дальнейшие запросы клиента идут с этим cookie → middleware
   `assertClientShare` достаёт row, валидирует, прокидывает `projectId` в
   context.
4. Все клиентские action'ы (approve/reject placement, добавить
   комментарий к креативу) запускаются от имени share-сессии. В audit-логе
   автор — `share:{share_id}` либо `email` из row.

**Безопасность:**
- Token = 32 байта URL-safe random (≈256 бит) — не угадывается.
- Email указывается агентством, но клиент не обязан верифицировать. Это
  не auth — это **знание ссылки** = доступ. Как Google Docs «по ссылке».
- Можно отозвать (`revoked_at`) — следующий запрос с этим cookie вернёт
  401.
- Cookie httpOnly, secure (prod), SameSite=Lax.

**Что клиент видит:** только ту кампанию, к которой выдан share. Никаких
других кампаний, никаких других клиентов того же агентства, никакой
базы блогеров. Полностью изолированный read-mostly view с точечными
action'ами (approve/reject placement, оставить comment).

### 3.6 PlacementComment — комментарии клиента (новая таблица)

Нужны для каскадных правок креативов и обсуждения размещений.

```
placement_comments (
  id              text PK,
  workspace_id    text → workspaces FK CASCADE,
  placement_id    text → project_items FK CASCADE,
  file_id         text → placement_files FK CASCADE nullable,  -- на конкретный креатив, или null = к размещению
  author_kind     enum(`member`/`client`) NOT NULL,
  author_id       text nullable,  -- если member → users.id; если client → share_id
  author_email    text nullable,  -- для client: email из share, чтобы переживало revoke
  body            text NOT NULL,
  created_at      timestamptz default now()
);

INDEX placement_comments (placement_id, created_at);
```

Простой timeline-чат на размещении. Без mention'ов, без attach'ей —
только текст. Достаточно для MVP «правки по креативу».

### 3.7 Что переиспользуем из этапа 12

- `contacts` — общая база контактов (админы каналов и т.п.).
- `channels` + `channel_admins` — общая база каналов.
- `outreach_accounts` — TG-аккаунты для коммуникации с блогерами (sticky
  v2 из 10.6).
- `tg_chats`, `tg_users` — TG-репликация для sticky-резолва + чтения
  истории и метрик постов.
- `properties`, `activities` — кастомные поля и заметки.

**На блогерах ничего не меняем структурно.** Блогер = `contact` в общей
базе + связанные `channels`. История цен/CPV — derived from
`project_items WHERE kind='placement' AND channel_id IN (его каналы)`.

### 3.8 Расширение `contacts` для блогера-агента (опционально)

В agency-сценарии у контакта появляются дополнительные «природные» поля:
- цена за пост (последняя/средняя — derived)
- % выхода в срок — derived
- скручивал ли стату — boolean флаг
- ниша — `multi_select` property

Эти поля в MVP **не пишем в схему** — используем `contacts.properties`
jsonb через существующий механизм `properties` workspace'а. Agency
seed добавляет несколько properties:
- `niche` (multi_select) — ниша блогера
- `is_known_cheater` (single_select: yes/no/unknown) — скручивал ли стату
- `default_price_post` (number) — стандартная цена
- `default_price_repost` (number) — стандартная цена за repost

Derived-поля (последняя/средняя цена по placement'ам) считаются в API.

---

## 4. URL-структура

### 4.1 API

#### Tracks (клиенты) — переиспользуем из этапа 12
| Метод | Путь | Доступ |
|---|---|---|
| GET | `/v1/workspaces/{wsId}/tracks?kind=client` | member |
| POST | `/v1/workspaces/{wsId}/tracks` body `{name, kind:'client', properties:{...}}` | admin |
| PATCH | `/v1/workspaces/{wsId}/tracks/{trackId}` | admin |
| DELETE | `/v1/workspaces/{wsId}/tracks/{trackId}` | admin |

#### Projects (кампании) — переиспользуем + новые поля
| Метод | Путь | Доступ |
|---|---|---|
| POST | `/v1/workspaces/{wsId}/projects` body `{trackId, name, kind:'agency'}` | admin |
| PATCH | `/v1/workspaces/{wsId}/projects/{projectId}` body `{brief?, budget_amount?, ...}` | admin |

#### Placements (новый namespace для kind='placement')
| Метод | Путь | Доступ |
|---|---|---|
| GET | `/v1/workspaces/{wsId}/projects/{projectId}/placements` | RBAC |
| POST | `/v1/workspaces/{wsId}/projects/{projectId}/placements` body `{channel_id, price_amount?, scheduled_at?, forecast_views?, ...}` | admin |
| PATCH | `/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}` | admin |
| DELETE | `/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}` | admin |
| POST | `/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/fetch-metrics` | admin |
| POST | `/v1/workspaces/{wsId}/projects/{projectId}/placements/{placementId}/fetch-content` | admin |

`fetch-metrics` — синхронный вызов TDLib `getMessage(chat, message_id)`,
обновляет `actual_views/reactions/comments/metrics_fetched_at`.

`fetch-content` — синхронный вызов TDLib, скачивает media поста +
сохраняет в `placement_files` с kind='screenshot'.

#### Placement files
| Метод | Путь | Доступ |
|---|---|---|
| GET | `/v1/workspaces/{wsId}/placements/{placementId}/files` | RBAC проекта |
| POST | `/v1/workspaces/{wsId}/placements/{placementId}/files` multipart `{kind, file}` | RBAC проекта |
| DELETE | `/v1/workspaces/{wsId}/placements/{placementId}/files/{fileId}` | RBAC проекта |
| PATCH | `/v1/workspaces/{wsId}/placements/{placementId}/files/{fileId}` body `{status?, notes?}` | RBAC проекта |
| GET | `/v1/files/{fileId}` (отдача контента) | RBAC проекта **или** валидная client-session |

#### Placement comments
| Метод | Путь | Доступ |
|---|---|---|
| GET | `/v1/workspaces/{wsId}/placements/{placementId}/comments` | RBAC проекта **или** client-session |
| POST | `/v1/workspaces/{wsId}/placements/{placementId}/comments` body `{body, file_id?}` | RBAC **или** client-session |

#### Project shares (magic-link для клиента)
| Метод | Путь | Доступ |
|---|---|---|
| GET | `/v1/workspaces/{wsId}/projects/{projectId}/shares` | admin |
| POST | `/v1/workspaces/{wsId}/projects/{projectId}/shares` body `{email, expires_at?}` | admin |
| DELETE | `/v1/workspaces/{wsId}/projects/{projectId}/shares/{shareId}` (revoke) | admin |

#### Client-side API (под client-session, без member'ской auth)
| Метод | Путь | Что |
|---|---|---|
| GET | `/v1/share/me` | { projectId, projectName, clientName, agencyName, email, expires_at } |
| GET | `/v1/share/project` | вся видимая клиенту инфо: бриф, placement'ы, агрегаты |
| POST | `/v1/share/placements/{placementId}/approve` body `{comment?}` | сменить client_status=approved |
| POST | `/v1/share/placements/{placementId}/reject` body `{comment, replace_request?: bool}` | reject/replace |
| POST | `/v1/share/placements/{placementId}/comments` | оставить комментарий |
| POST | `/v1/share/files/{fileId}/approve` | одобрить креатив |
| POST | `/v1/share/files/{fileId}/reject` body `{comment}` | отклонить креатив с комментом |
| GET | `/v1/share/files/{fileId}` | скачать файл (превью / download) |

Все client-side endpoint'ы под middleware `assertClientShare` —
проверяет cookie `share_token`, достаёт `projectId`, валидирует.

### 4.2 Magic-link entry point

| Метод | Путь | Что |
|---|---|---|
| GET | `/share/{token}` | Set httpOnly cookie + redirect на `/share/project` |
| GET | `/share/project` | Web-страница client-view (см. §6.5) |
| GET | `/share/logout` | Clear cookie + plain «вы вышли» страница |

### 4.3 Web-маршруты (member side)

Для агентского продукта sidebar другой (см. §10).

| URL | Что |
|---|---|
| `/w/$wsId/clients` | Список клиентов (tracks WHERE kind='client') |
| `/w/$wsId/clients/$clientId` | Карточка клиента: реквизиты + список кампаний |
| `/w/$wsId/clients/new` | Создать клиента |
| `/w/$wsId/campaigns` | Все кампании по всем клиентам (для оператора-менеджера) |
| `/w/$wsId/campaigns/new` | Создать кампанию (селект клиента) |
| `/w/$wsId/campaigns/$campaignId` | Главная страница кампании |
| `/w/$wsId/campaigns/$campaignId/brief` | Таб «Бриф» |
| `/w/$wsId/campaigns/$campaignId/mediaplan` | Таб «Медиаплан» (default) |
| `/w/$wsId/campaigns/$campaignId/report` | Таб «Отчёт» |
| `/w/$wsId/campaigns/$campaignId/access` | Таб «Доступ клиента» |
| `/w/$wsId/bloggers` | Общая база блогеров (= `/contacts` но с другим UI) |
| `/w/$wsId/bloggers/$contactId` | Карточка блогера: каналы, история размещений, цены |
| `/w/$wsId/channels` | Каналы (как в этапе 11) — переиспользуем |

`/campaigns/$campaignId/mediaplan` — главный экран. Двух-панельный:
- Слева — таблица размещений (медиаплан).
- Справа (drawer на клик по строке) — детали размещения (артефакты,
  комментарии, метрики, действия).

### 4.4 Web-маршруты (client side, под share-cookie)

| URL | Что |
|---|---|
| `/share` | Авто-redirect на `/share/project` если cookie есть, иначе «ссылка нужна» |
| `/share/project` | Главная страница клиента (бриф + медиаплан + отчёт в один скролл) |
| `/share/placements/$placementId` | Детали размещения (drawer-стиль либо separate page) |

Один и тот же React-app, но layout/sidebar отличается: client mode = нет
sidebar, только контент кампании; member mode = полный sidebar.
Определяется по URL prefix.

---

## 5. Главные UX-флоу

### 5.1 Создание клиента

Менеджер кликает «+ Клиент» в `/clients`.

Форма:
- Название клиента (обязательное)
- Юр.лицо (опц.)
- ИНН (опц.)
- Контакт бухгалтерии (опц.)
- Заметки (опц.)

Submit → POST `/tracks` с `{kind:'client', name, properties:{legal_entity,
inn, accountant_contact, notes}}` → редирект на `/clients/$clientId`.

### 5.2 Создание кампании

Менеджер кликает «+ Кампания» в `/campaigns` (либо на странице клиента
«Новая кампания для X»).

Форма (минимум):
- Клиент — селект (если зашли с страницы клиента — preselected, disabled).
- Название кампании (обязательное; пример: «Q4 Holiday B2B»).
- Период start/end (опц.).
- Бюджет + валюта (опц.).
- Бриф (textarea, опц.) — можно заполнить позже.

Submit → POST `/projects` с `{trackId, kind:'agency', name, brief?,
budget_amount?, period_start?, period_end?}` → редирект на
`/campaigns/$campaignId/mediaplan`.

### 5.3 Заполнение медиаплана

Главный экран кампании. Таблица размещений (изначально пустая).

**Колонки таблицы:**

| Канал | Площадка | Дата | Цена | Прогноз ПДП | Прогноз ERR | Прогноз CPV | Статус клиента |
|---|---|---|---|---|---|---|---|

Дополнительно (можно скрыть/показать через колоночный селект):
- ЕРИД
- Факт охватов
- Факт CPV
- Workflow status (computed)

**Действия в таблице:**
- **«+ Добавить блогера»** — кнопка в шапке. Открывает модалку поиска по
  базе блогеров (через `/channels` API с фильтрами по нише/размеру/etc.
  + поиск по названию). Можно выбрать несколько каналов — добавляются
  одной операцией (батч POST).
- **«+ Создать нового блогера»** — для случая «нашёл новый канал, его в
  базе нет». Inline-form: ссылка на канал + название + (опц.) контакт
  админа. Создаётся row в `channels` + (если указан админ) в
  `channel_admins`.
- **Клик по строке** → drawer справа с деталями размещения (см. §5.6).
- **Inline-редактирование** цены/даты/прогнозов через клик в ячейку.
  Save on blur, optimistic update.
- **Bulk-select** через чекбоксы + bulk-action «Удалить выбранные» /
  «Перенести в другую кампанию».

**Sticky-аккаунт для коммуникации с блогером:**
В drawer'е размещения видна кнопка «Написать блогеру» — открывает chat
с админом канала (если есть `channel_admins`) через outreach-аккаунт,
определённый sticky-резолвером (10.6). Это **переиспользует
существующий chat-flow** из этапа 12.4-B (quick-send / drawer). Тут
ничего нового.

### 5.4 Выдача доступа клиенту

Таб «Доступ клиента» на странице кампании.

**Состояния:**
- Нет ни одной active share → кнопка «Поделиться с клиентом».
- Есть share → список email'ов с кнопками «Скопировать ссылку»,
  «Отправить повторно», «Отозвать».

Форма создания share:
- Email клиента (обязательное)
- Срок действия — селект: «без срока», «1 месяц», «3 месяца» (опц.,
  default — без срока).

Submit → POST `/projects/{id}/shares` → создаётся row + email
отправляется → в UI появляется row с `last_seen_at = null` (клиент ещё
не открывал).

**После того как клиент открыл ссылку:** `last_seen_at` обновляется →
менеджер видит «открыта 12 минут назад».

### 5.5 Согласование медиаплана клиентом

Клиент открывает magic-link → попадает на `/share/project`.

**Layout:**
- Заголовок: «Кампания {название} · {агентство}».
- Блок «Бриф» — readonly текст из `project.brief` + бюджет + период.
- Блок «Медиаплан» — та же таблица что и у менеджера, но:
  - Колонки без «ЕРИД», «Факт охватов» (это менеджерская кухня — пока
    кампания не идёт, клиент это не видит).
  - **Кнопки в строке: «✓ Подходит», «✗ Не подходит», «🔄 Заменить»**.
  - Клик → модалка с обязательным комментарием для reject/replace, опц.
    для approve.
  - После выбора — статус сохраняется (POST `/share/placements/{id}/approve`
    или `/reject`), строка визуально перекрашивается.
  - Уже размеченные строки — readonly с «Решение: подходит» / «отклонено:
    {comment}». Изменить можно через кнопку «Изменить решение».
- Блок «Креативы на согласование» — отдельный список (если есть
  `placement_files` со `status='pending_review'`):
  - Каждый креатив = карточка с превью + статус + кнопки approve/reject +
    timeline комментариев.
- Блок «Отчёт» — пока пусто, появится когда менеджер закроет кампанию.

**Что клиент НЕ может:**
- Добавить/удалить блогеров.
- Менять цены, прогнозы.
- Видеть базу блогеров агентства.
- Видеть другие кампании этого агентства.
- Видеть финансы агентства (маржу).
- Видеть `placement.price_amount` (мы ему говорим итог по бюджету, но
  цены конкретно блогерам — internal).

### 5.6 Pipeline размещения (после approve)

После того как клиент кликнул «✓ Подходит» на строке — `client_status =
approved`. Размещение переходит в «в работе».

В drawer размещения у менеджера — vertical stepper:

1. **Договор** — загрузить PDF, отметить «подписан с двух сторон».
2. **Креатив** — загрузить файл, кнопка «Отправить клиенту на ревью»
   (меняет `status` файла на `pending_review`). При rejection клиентом —
   правки → новая версия → новый ревью.
3. **Дата выхода** — input timestamptz (`scheduled_at`).
4. **ЕРИД** — два поля: token + данные рекла. Кнопка «Скопировать для
   блогера» — копирует в clipboard в формате «erid: XXXX · Реклама:
   {advertiser_data}» для отправки в TG.
5. **Публикация** — поле URL поста (`post_url`). После ввода: автопарсинг
   `post_message_id` из URL + установка `published_at = now()` (можно
   откорректировать).
6. **Метрики** — кнопка «Снять статистику» → POST
   `/placements/{id}/fetch-metrics`. Под кнопкой — таблица: «охватов
   {actual_views}, реакций {actual_reactions}, последнее обновление:
   {metrics_fetched_at}». Под отдельной кнопкой «Сохранить копию поста»
   → POST `/fetch-content`, сохраняет media в `placement_files`
   (kind='screenshot').
7. **Акт** — загрузить PDF от блогера, отметка `act_received_at = now()`.

Каждый шаг — независимая мутация. Прогресс рендерится визуально (checked
/ unchecked / in-progress).

**Комментарии:** под stepper'ом — единый timeline всех `placement_comments`
для этого размещения (включая комментарии клиента на креатив и просто к
размещению). Менеджер может отвечать.

### 5.7 Постотчёт

Таб «Отчёт» на странице кампании.

**До закрытия кампании (есть pending/in_progress размещения):** баннер
«Кампания идёт, отчёт сформируется по завершении».

**Когда все размещения closed (act_received_at NOT NULL):** кнопка
«Сформировать отчёт» → генерирует:
- Auto-блок агрегатов: суммарные охваты, средний CPV, кол-во
  размещений по площадкам, % успешных vs replaced.
- Auto-блок «Скриншоты постов» — превью `placement_files` с
  kind='screenshot' по всем размещениям.
- Textarea «Выводы и рекомендации» — менеджер пишет руками.

Сохранение → `projects.properties.report = {summary, written_at,
written_by}`.

Клиент видит этот же отчёт в своём `/share/project` блоке «Отчёт» (он
появляется когда `project.status='done'` или после ручной публикации
отчёта менеджером).

---

## 6. Magic-link для клиента — механика

### 6.1 Создание

`POST /v1/workspaces/{wsId}/projects/{projectId}/shares` body `{email,
expires_at?}`:

1. Auth: admin воркспейса.
2. Генерируется `token = 32 байта URL-safe random` (256 бит).
3. INSERT в `project_shares`.
4. Отправляется email на адрес из body со ссылкой `https://app/share/{token}`.
   - На MVP — через transactional email сервис (TBD: что используем для
     email'ов вообще — отдельный кусок инфры).
5. Response: `{share_id, email, link, expires_at}`.

### 6.2 Открытие клиентом

`GET /share/{token}`:

1. Lookup `project_shares WHERE token = ? AND revoked_at IS NULL AND
   (expires_at IS NULL OR expires_at > now())`.
2. Если не нашли → 404 «Ссылка недействительна».
3. UPDATE `last_seen_at = now()`.
4. Set-Cookie: `share_token={token}; HttpOnly; Secure; SameSite=Lax;
   Max-Age=7776000` (90 дней).
5. 302 Redirect на `/share/project`.

### 6.3 Сессия

Middleware `assertClientShare` на каждом `/v1/share/*` endpoint'е:

1. Читает cookie `share_token`.
2. Lookup `project_shares` (как в 6.2).
3. Если не валидно → 401 (фронт перекинет на /share с подсказкой
   «попросите ссылку у агентства»).
4. Прокидывает в ctx: `{shareId, projectId, workspaceId, email}`.

### 6.4 Отзыв

`DELETE /v1/workspaces/{wsId}/projects/{projectId}/shares/{shareId}`:

1. Auth: admin.
2. UPDATE `revoked_at = now()`.
3. Все будущие запросы клиента с этим cookie → 401.

### 6.5 Re-share после revoke

Создание нового share с тем же email — это **новый row**, новый token,
новая ссылка. Старый cookie остаётся невалидным. Можно
автоматически отзывать предыдущие shares на тот же email при создании
нового — TBD, в MVP не делаем (плодим shares, менеджер может вручную
revoke).

### 6.6 Что не делаем в MVP

- **Verification email**: клиент не вводит код, доступ = знание ссылки.
- **Multi-factor**: нет.
- **Конверсия в полноценный аккаунт users**: пока никак. Если клиент
  хочет постоянный доступ — мы создаём для него `workspace_member` с
  ролью «external_client» (новая роль) и привязываем доступ к
  конкретным кампаниям. Это отдельный этап (16.2 или позже).

---

## 7. RBAC (агентство)

Наследуем модель из 11.5 + 12 (admin/member роли в workspace).

**Видимость клиентов (tracks WHERE kind='client'):** все member'ы видят
всех клиентов (это просто папки-группировки).

**Видимость кампаний (projects WHERE kind='agency'):**
- Admin — все.
- Member — кампании, в которых он является **ответственным**.

Чтобы это работало — нужно поле «ответственный менеджер» на кампании.
В MVP — переиспользуем `project.contact_default_owner_ids` (jsonb
string[]) как «ответственные менеджеры кампании»:
- При создании кампании — преднастройка default = [createdBy].
- Если member ∈ owner_ids → видит кампанию.
- Admin видит всё.

**Видимость placements:** наследуют видимость кампании. Если member
видит кампанию — видит все её placement'ы.

**Видимость базы блогеров (`contacts` и `channels`):** общая для всех
member'ов воркспейса. Это про-агентский корпоративный знание.

**Action-rights:**
- Создание/удаление клиента и кампании — admin.
- Редактирование медиаплана / артефактов / комментариев — admin **или**
  member-owner кампании.
- Выдача shares клиенту — admin **или** member-owner кампании.

### Permission matrix

| Action | Admin | Member-owner | Member-non-owner | Client (по share) |
|---|---|---|---|---|
| List clients | ✓ | ✓ | ✓ | — |
| Create/edit client | ✓ | — | — | — |
| List campaigns | ✓ all | ✓ свои | ✓ свои | — |
| Create campaign | ✓ | — | — | — |
| Edit campaign brief/budget | ✓ | ✓ | — | — |
| Add/remove placements | ✓ | ✓ | — | — |
| Upload artifacts | ✓ | ✓ | — | — |
| Approve/reject placement | — | — | — | ✓ (своя) |
| Approve/reject creative | — | — | — | ✓ (своя) |
| Fetch metrics via TDLib | ✓ | ✓ | — | — |
| Create share | ✓ | ✓ | — | — |
| Revoke share | ✓ | ✓ | — | — |
| View bloggers DB | ✓ | ✓ | ✓ | — |
| View campaign | ✓ all | ✓ свои | ✓ свои | ✓ своя |
| Comment on placement | ✓ | ✓ | — | ✓ |

---

## 8. Сбор метрик и контента через TDLib

### 8.1 Что собираем

**Метрики поста** (`POST /placements/{id}/fetch-metrics`):
- `actual_views` — `message.interactionInfo.viewCount` из TDLib.
- `actual_reactions` — сумма `message.interactionInfo.reactions.totalCount`.
- `actual_comments` — `message.interactionInfo.replyInfo.replyCount` (если
  у поста есть привязанная discussion group).
- `metrics_fetched_at = now()`.

**Контент поста** (`POST /placements/{id}/fetch-content`):
- Текст: `message.content.text.text`.
- Media (фото/видео) — `downloadFile(file_id)` → сохраняется в local
  storage → INSERT в `placement_files` kind='screenshot'.
- Тип контента сохраняется в `placement_files.notes` (text/photo/video).

### 8.2 Как обращаемся к TDLib

Используем один из outreach-аккаунтов воркспейса. Логика выбора:

1. Если в воркспейсе есть аккаунт, **подписанный на канал** (есть запись
   в его `tg_chats` для `chat_id` канала) — используем его. Подписка
   гарантирует доступ к публичной информации канала (views/reactions).
2. Иначе — берём **любой active outreach-аккаунт** и делаем
   `searchPublicChat(username)` для получения chat_id, потом
   `getMessage(chat_id, message_id)`. Для публичных каналов это работает
   без подписки.
3. Если канал private и ни один аккаунт не подписан — error «нет доступа
   к каналу, добавьте аккаунт-подписчик», menager видит баннер.

**Parse post_url:** `https://t.me/{channel_username}/{message_id}` →
{channel_username, message_id}. Поддерживаем форматы:
- `t.me/channel/123`
- `https://t.me/channel/123`
- `t.me/c/1234567890/123` (private channels, требует подписки)

### 8.3 Кэширование и rate limits

- TDLib сам кэширует messages — повторный `getMessage` дёшев.
- Между нашими `fetch-metrics` для разных placement'ов делаем
  rate-limit ~200ms через worker (избегаем FLOOD_WAIT'а).
- Если TDLib возвращает FLOOD_WAIT — сохраняем cooldown на аккаунте
  (как в 12.4-D) и возвращаем 503 с retry-after.

### 8.4 Что отложено в этом этапе

- **Auto-расписание (24ч / 48ч / 7 дней)**. Появится позже как
  `scheduled_jobs(placement_id, run_at, kind='fetch-metrics')` + worker.
- **Сравнение метрик «через 24ч vs итог»** — для борьбы со скруткой.
  Поле `is_known_cheater` ставим вручную пока.
- **Визуальный screenshot канала** (puppeteer/playwright). Сохранение
  media поста через TDLib — достаточно для отчёта.
- **Скачивание комментариев из linked discussion group** — отдельная
  фича.

---

## 9. Дополнительные UX-моменты

### 9.1 Sidebar в агентском режиме

```
База
  Блогеры          ← переименование «Контакты»
  Каналы           ← как сейчас
Работа
  Клиенты          ← новое
  Кампании         ← все по всем клиентам
  Чат              ← как сейчас
  Telegram-аккаунты
  Расписание
Конфигурация
  Кастомные поля
  Настройки
```

(в BD-режиме остаётся как сейчас: «Контакты / Каналы / Проекты / Чат /...»)

### 9.2 Search и быстрая навигация

На странице медиаплана:
- Search по каналам (на «+ Добавить блогера») с фильтрами: ниша, размер
  (membersCount), наличие DM, последняя цена, ERR.
- Filter медиаплана по client_status (показать только pending /
  approved / rejected).

### 9.3 Активность кампании (отложено)

Feed «кто что сделал» — приятно иметь, но не критично для MVP.
В etap 16.1 (после первого прохода с реальной кампанией). Сейчас:
audit-trail хранится в `activities` (как notes/reminders в этапе 12).

### 9.4 Колоночный селект в медиаплане

UI-компонент «показать/скрыть колонки» (как в Linear/Notion). Пресеты:
- «Подбор» — Канал, Площадка, Цена, Прогноз ПДП/ERR/CPV, Статус клиента
- «В работе» — Канал, Дата, ЕРИД, Pipeline status
- «Отчёт» — Канал, Дата, Факт охватов, Факт CPV, ROI

Сохранение пресетов на user-уровне (TBD: в `users.preferences` jsonb или
отдельная таблица `column_presets`). На MVP — фиксированный набор
колонок, селект «показать всё / только используемые» (toggle), без
сохранения.

---

## 10. Сплит сценариев — единственный тумблер `workspace.mode`

Один продукт, один codebase, один деплой. Различие BD vs Agency — на
уровне воркспейса, runtime. Build-time флаги (`PRODUCT=yandex|agency`)
и feature-модули **отменены**: преждевременная оптимизация без
доказанной необходимости. Если когда-нибудь понадобится «агентская
поставка без BD-режима» — добавим один env-флаг, скрывающий выбор при
создании ws, и всё.

**Колонка `workspaces.mode`** (enum `workspace_mode`):
- `'bd'` — BD/биржевой сценарий (Саша, Perfluence, telega.in,
  in-house маркетинг). Массовый аутрич без внешнего клиента-рекла,
  воронка/канбан, цепочки автосообщений.
- `'agency'` — агентский сценарий (есть клиент-рекл, медиаплан,
  согласование, артефакты, отчёт).

**Выбирается при создании workspace** (radio в UI), потом read-only.
Менять mode после создания нельзя — это поломает соответствие kind'ам
существующих треков/проектов. Если когда-нибудь понадобится переключить
— отдельным PR с data-migration.

**На что влияет mode:**
- **Дефолтный `kind` при создании сущностей через API**:
  - `mode='bd'` → `track.kind='program'`, `project.kind='outreach'`,
    `project_item.kind='lead'`.
  - `mode='agency'` → `track.kind='client'`, `project.kind='agency'`,
    `project_item.kind='placement'`.
  - **kind в API body не принимается** — проставляется автоматом из
    `workspace.mode` родительского воркспейса. Юзер kind не выбирает
    нигде в UI.
- **UI-лейблы на конкретных страницах** агентского сценария: «Клиенты /
  Кампании / Размещения». В bd-режиме — нынешние «Папки / Проекты /
  Карточки».
- **Доступные роуты в sidebar** — в этапе 16 пока **не трогаем**,
  все ссылки видны в обоих режимах. Сплит sidebar — отдельная задача
  после первого живого использования.

**На что mode НЕ влияет:**
- Схему БД и API endpoint'ы — они общие. Один и тот же `POST /tracks`
  обслуживает оба сценария, kind проставляется по mode.
- Permissions/RBAC — общая модель admin/member.
- Доступные интеграции (TDLib, properties, activities, channels).

**Связь mode и kind:**
В рамках того что зафиксировано в этой специке — соответствие mode→kind
**1:1**. В одном bd-ws все треки/проекты/айтемы одного типа; в одном
agency-ws — другого. То есть kind на сущности дублирует информацию из
workspace.mode. Тем не менее **kind остаётся в схеме**: он зашит в БД
с этапа 12, на нём уже завязаны worker'ы и UI, выпиливать дороже чем
оставить. Если когда-нибудь появится фича «разнотипные сущности в одном
ws» (например, отдельные outreach-операции для лонг-листа внутри
agency-воркспейса) — kind готов, добавим UI-выбор и явный код. До тех
пор kind — derived from mode, технический хвост.

**Чего не делаем:**
- Автодетекта mode по наличию `track.kind='client'` (implicit-магия).
- Build-time флага `PRODUCT` (преждевременно).
- Хелперов `isAgency()/isBd()` в коде. Проверяем `workspace.mode === 'agency'`
  напрямую — это не «фича-флаг», это продуктовый сценарий, обёртка не
  добавляет ясности.
- Sidebar/меню-сплита в первом проходе этапа 16.

---

## 11. Что отложено (явно НЕ в MVP этого этапа)

| Фича | Когда | Почему |
|---|---|---|
| E-sign договоров и актов | этап 16.3+ | сложная интеграция с DocuSign/КриптоПро, MVP — загрузка сканов |
| Интеграция с ОРД (Яндекс) | этап 16.3+ | требует отдельной интеграции с системой ОРД, MVP — ручной ввод ЕРИД |
| Встроенный редактор креативов | никогда (стратегически) | upload файлов + комменты — достаточно, переусложнение убивает фокус |
| Pixel-screenshot канала через puppeteer | TBD | TDLib-копия контента покрывает основной use case |
| Auto-расписание сбора метрик (24/48/7д) | этап 16.2 | scheduled_jobs + worker. На MVP менеджер кликает руками |
| Постотчёт как PDF через шаблон | этап 16.2 | визуальный шаблон + PDF-генерация. На MVP — текст + autoblock в HTML |
| Финансы first-class (выплаты, акты с реклом, маржа-отчёты) | этап 17 | требует transaction-модели, отдельный большой кусок |
| Conversation entity (cross-project history с блогером) | этап 17 | в MVP — derived from placement-history + chat-history |
| Структурированный бриф (форма с полями вместо текста) | этап 16.2 | сначала понять что реклы реально пишут в свободном тексте |
| Verification email + конверсия client → workspace_member | этап 16.3 | пока magic-link достаточно, конверсия — отдельная история RBAC |
| Auto-revoke предыдущих shares при создании нового на тот же email | этап 16.2 | менеджер пока revoke'ает руками |
| Колоночные пресеты в медиаплане | этап 16.2 | в MVP — fixed columns + toggle «показать все» |
| Bulk-операции на медиаплане (move to other campaign, bulk approve) | этап 16.2 | в MVP — построчно |
| Feed активности кампании | этап 16.1 | приятно иметь, не блокер |
| Расширенные поля блогера (skills, languages, audience demo) | TBD | через `properties` jsonb, без миграций схемы |

---

## 12. Schema-изменения (миграции)

### 12.1 Workspaces

```sql
ALTER TABLE workspaces ADD COLUMN mode text NOT NULL DEFAULT 'bd';
-- enum типа workspace_mode = 'bd' | 'agency'
-- (создаём enum + alter column ... USING)
```

### 12.2 Projects (расширение под agency)

```sql
ALTER TABLE projects
  ADD COLUMN brief text,
  ADD COLUMN budget_amount numeric(12,2),
  ADD COLUMN budget_currency text NOT NULL DEFAULT 'RUB',
  ADD COLUMN period_start timestamptz,
  ADD COLUMN period_end timestamptz,
  ADD COLUMN kpi text,
  ADD COLUMN tov text,
  ADD COLUMN constraints text;
```

### 12.3 Project_items (расширение под placement)

```sql
ALTER TABLE project_items
  ADD COLUMN channel_id text REFERENCES channels(id) ON DELETE CASCADE,
  ADD COLUMN scheduled_at timestamptz,
  ADD COLUMN published_at timestamptz,
  ADD COLUMN post_url text,
  ADD COLUMN post_message_id bigint,
  ADD COLUMN price_amount numeric(12,2),
  ADD COLUMN price_currency text NOT NULL DEFAULT 'RUB',
  ADD COLUMN forecast_views int,
  ADD COLUMN forecast_err numeric(5,2),
  ADD COLUMN actual_views int,
  ADD COLUMN actual_reactions int,
  ADD COLUMN actual_comments int,
  ADD COLUMN metrics_fetched_at timestamptz,
  ADD COLUMN erid text,
  ADD COLUMN erid_advertiser_data text,
  ADD COLUMN client_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN client_status_comment text,
  ADD COLUMN client_status_at timestamptz,
  ADD COLUMN act_received_at timestamptz;

-- enum placement_client_status = 'pending' | 'approved' | 'rejected' | 'replace'

CREATE INDEX idx_project_items_channel ON project_items(channel_id) WHERE kind = 'placement';
CREATE INDEX idx_project_items_published_at ON project_items(published_at) WHERE kind = 'placement';
```

### 12.4 Новая таблица placement_files

```sql
CREATE TABLE placement_files (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  placement_id text NOT NULL REFERENCES project_items(id) ON DELETE CASCADE,
  kind text NOT NULL,  -- contract|creative|screenshot|act|other
  file_url text NOT NULL,
  original_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  status text NOT NULL DEFAULT 'draft',  -- draft|pending_review|approved|rejected
  status_comment text,
  uploaded_by text NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  approved_by text REFERENCES users(id),
  approved_at timestamptz,
  notes text
);

CREATE INDEX idx_placement_files_placement ON placement_files(placement_id);
CREATE INDEX idx_placement_files_workspace ON placement_files(workspace_id);
```

### 12.5 Новая таблица placement_comments

```sql
CREATE TABLE placement_comments (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  placement_id text NOT NULL REFERENCES project_items(id) ON DELETE CASCADE,
  file_id text REFERENCES placement_files(id) ON DELETE CASCADE,
  author_kind text NOT NULL,  -- member | client
  author_id text,
  author_email text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_placement_comments_placement ON placement_comments(placement_id, created_at);
```

### 12.6 Новая таблица project_shares

```sql
CREATE TABLE project_shares (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  email text NOT NULL,
  kind text NOT NULL DEFAULT 'client_view',
  expires_at timestamptz,
  last_seen_at timestamptz,
  revoked_at timestamptz,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_project_shares_project ON project_shares(project_id);
```

### 12.7 Дроп БД

Согласно [[feedback_db_migrations.md]] — до прод-деплоя дропаем БД:

```bash
docker compose down -v && pnpm run setup
```

После прод-деплоя — добавляем drizzle-migrations (этап 15.2). До тех пор
изменения через `db:push` + явный warning юзеру при breaking changes.

---

## 13. Seed-расширения для agency

Создаём дополнительный demo-воркспейс с `mode='agency'`:

1. **Demo-агентство воркспейс** `ws_demo_agency` с owner=Анна,
   member=Борис.
2. **2 demo-клиента**:
   - `trk_coke` «Coca-Cola» (kind='client', legal_entity, inn).
   - `trk_beeline` «Beeline» (kind='client').
3. **1 demo-кампания** «Q4 Holiday B2B» в Coca-Cola (kind='agency',
   brief, budget=500000, period).
4. **5 demo-каналов** разных ниш (auto / tech / lifestyle / business /
   tech-news) с привязанными админами-контактами.
5. **3 demo-placement'а** в кампании в разных стадиях: pending,
   approved+in_progress, closed.
6. **1 demo-share** на email playaxru+demo-client@gmail.com с ссылкой в
   stdout (для проверки клиентского flow).
7. **2 demo-blogger properties**: `niche`, `is_known_cheater`,
   `default_price_post`.

---

## 14. Открытые вопросы (требуют решения до старта реализации)

1. **Где будут лежать загруженные файлы?**
   - Вариант A (MVP): local disk на API-сервере. Простой, но не
     scaling-friendly, миграция в S3 потом — отдельный шаг.
   - Вариант B: сразу S3-совместимое хранилище (Yandex Object Storage).
     Чище, но требует настройки + creds в .env.
   - Решение: TBD. Думаю A на самом первом проходе, потом B как
     отдельная задача в этапе 15.

2. **Чем шлём email с magic-link?**
   - Возможные: Yandex 360 SMTP, Resend, SendGrid.
   - В корп-Яндексе скорее всего SMTP/sender API из их собственной
     инфры. Уточнить.

3. **Workflow_status — computed или explicit column?**
   - Спека предлагает computed. Если запросы становятся горячими и нужны
     индексы по workflow_status — переедем на explicit column с
     trigger-обновлением.

4. **Member-owner кампании — кто это технически?**
   - Спека: переиспользуем `project.contact_default_owner_ids`.
   - Альтернатива: отдельное поле `project.owner_user_ids` jsonb или
     отдельная таблица `project_owners`.
   - Решение: contact_default_owner_ids в agency-mode не используется
     для контакт-автосоздания (worker не работает), поэтому
     переиспользование под «ответственные» нормально семантически.

5. **Сбор метрик через TDLib — синхронный API или background job?**
   - Спека: синхронный (`POST /fetch-metrics` ждёт ответа TDLib ~200ms).
   - Если TDLib запрос вдруг долгий (FLOOD_WAIT) — клиент висит. Можно
     перевести на queue + SSE.
   - Решение: MVP синхронный, в этап 16.2 — async с прогрессом для
     bulk-fetch.

6. **«Доступ клиента» — таб на странице кампании или отдельная
   страница workspace-уровня?**
   - Спека: таб на кампании (один share = одна кампания).
   - Альтернатива: workspace-level «Внешние доступы» с агрегатом.
   - Решение: таб на кампании достаточно для MVP. Workspace-level
     view — этап 16.2 если менеджеры начнут терять созданные shares.

7. **Согласование креативов клиентом — обязательный шаг или
   опциональный?**
   - Спека: креатив с `status='pending_review'` появляется в client-view
     отдельным блоком. Если креатив `status='draft'` — клиент его не
     видит (агентство ещё работает).
   - Это даёт менеджеру контроль «отправить на ревью когда готов».
     Хорошо.

8. **Удаление placement'а после approve клиентом — как обрабатываем?**
   - Сценарий: рекл OKнул, а потом блогер слился. Нужна замена.
   - Опции: (a) удалить размещение + создать новое; (b) поменять статус
     на `replace` + сохранить trail; (c) PATCH channel_id на новый.
   - Спека: рекомендую (a) — удаление и создание. История остаётся в
     `placement_comments` если кто-то комментил. Простой подход. (b) —
     overkill, (c) — путает audit-trail.

---

## 15. Что в итоге получаем

**Минимально полезный агентский продукт:** менеджер от создания клиента
до закрытия кампании может провести всё в одной системе. Клиент видит и
согласовывает медиаплан и креативы по magic-link без регистрации.
Артефакты лежат в системе, не в почте. Метрики поста — кнопка в один
клик, не «зайти в TG и переписать». Постотчёт — текст + автоагрегаты,
не пустой гуглдок.

**Готовая база для развития:** структура (track→project→item с kind +
placement_files + project_shares + placement_comments) выдерживает
дальнейшие расширения без переписки — финансы, e-sign, ОРД-интеграцию,
auto-метрики, PDF-отчёты, conversation cross-project.

**Не дублируем работу с BD-сценарием:** общая база контактов и каналов,
sticky-резолвер, outreach-аккаунты, RBAC, properties, activities, **цепочки +
worker** — всё переиспользуется. Канбан остаётся для BD (в agency его заменяет
фазовый визард), а движок рассылки (цепочки/worker/scheduled_messages) общий.

---

## 16. Актуальная модель: фазовый визард (этап 16.1, реализовано)

Этот раздел отражает то, что РЕАЛИЗОВАНО и УТОЧНЕНО по ходу разработки.
Где он расходится с §2–§6 выше — приоритет у этого раздела.

### 16.1 Фазовый визард вместо «таблицы с drawer»

Главный экран кампании — горизонтальный stepper из 6 фаз. Фаза хранится в
`projects.phase` enum (`briefing`/`longlist`/`review`/`shortlist`/`production`/
`wrapup`). **Свободная навигация:** phase — это «где основная работа сейчас» +
дефолтный экран + бейдж в списке, НЕ машина состояний (экраны доступны в любом
порядке, клик по степу переключает и сохраняет phase). Под визардом — контент
текущей фазы.

| Фаза | Что | Статус |
|---|---|---|
| Бриф | форма (бюджет/период/KPI/TOV/ограничения) | ✅ реализовано |
| Лонглист | таблица опроса + аутрич + выбывание «в шортлист» | ✅ реализовано |
| Согласование | шортлист (превью клиента) + выдача magic-link | ✅ реализовано |
| Финальный оффер | bulk-send approved-блогерам «вы выбраны» | ⏳ заглушка |
| Производство | pipeline-матрица (§16.5) | ⏳ заглушка |
| Отчёт | bulk-метрики + постотчёт | ⏳ заглушка |

### 16.2 Лонглист — воронка с выбыванием, а не статичный медиаплан

Аутрич переиспользует BD-механику **целиком**: цепочка (`MessagesEditor`,
warmText, пинги), запуск (`activate`), worker, `scheduled_messages`, sticky.
Получатель размещения = админ канала (`channel_admins` → contact →
`item.contact_id/username`).

- Лонглист показывает **только тех, кого ещё опрашиваем** (`shortlisted_at IS
  NULL`). Статус аутрича — **один компактный столбец** (не писали / отправлено
  N/M / прочитано / ответил Nд / отказ), не колонка-на-сообщение как в BD.
  Плюс столбец «через какой аккаунт». Live-обновления через SSE-стрим проекта.
- Менеджер по ответу заполняет в drawer цену/готовность/прогнозы (руками,
  без парсинга) → жмёт **«Добавить в шортлист»** (`shortlisted_at = now`) →
  строка выбывает из опроса.
- Удаление строки (мусор/отказ) — отдельное действие, не путать с «в шортлист».

### 16.3 Согласование + magic-link БЕЗ email (отклонение от §6)

Реализовано проще, чем §6: **без email и без cookie-flow**. Менеджер на фазе
«Согласование» жмёт «Создать ссылку» → `project_shares` с 256-битным токеном →
копирует `/share/{token}` и шлёт реклу как угодно. Клиентские ручки
`/v1/share/{token}/*` — публичные, валидация по токену (не отозван, не истёк),
обновляют `last_seen_at`. Отзыв — `revoked_at`.

Клиент видит шортлист (`shortlisted_at NOT NULL`) **без цен блогерам** (§5.5),
проставляет «подходит / не подходит / заменить» с комментарием
(`client_status` + `client_status_comment`). Агентство видит те же строки в
фазе «Согласование» — с ценами (агентский вид) + решениями клиента.

### 16.4 Финальный оффер = разовый bulk-send (не цепочка)

После одобрения шортлиста — массовая отправка одобренным «вы выбраны,
согласуем дату». **Без follow-up-пингов** (в отличие от лонглиста): одно
сообщение, не цепочка. Отдельной таблицы цепочек не заводим.

### 16.5 Производство — pipeline-матрица (шаги 5–13 исходного процесса)

НЕ канбан (этапы параллельны — карточка не живёт в одной колонке). Матрица:
строки = approved-размещения, колонки = этапы; клик по строке → drawer со
stepper'ом + чатом + файлами. Три типа триггеров перехода: **оператор**
(bulk-кнопки), **контрагент** (рекл через magic-link, блогер — менеджер
руками), **внешнее событие** (публикация — отложено, пока руками).

| Шаг процесса | Колонка/действие | Триггер |
|---|---|---|
| 5. Договор | колонка «Договор» (не отправлен→отправлен→правки→подписан); bulk «выслать»; drawer — загрузка скана, «подписан» | оператор + контрагент |
| 6. Креатив (агентство чекает → реклу) | колонка «Креатив» (ждём→проверка агентством→у клиента→правки→одобрен); drawer — загрузка, «отправить клиенту» | оператор + контрагент |
| 6б. Рекл ОК/правки | клиентский magic-link, блок «Креативы на согласование», approve/reject с комментом | контрагент |
| 7. Правки блогеру | drawer-чат с блогером | оператор |
| 8. Финальная дата | колонка «Дата» (`scheduled_at`) | оператор |
| 9. ЕРИД | колонка «ЕРИД» — ручной ввод + «скопировать для блогера» (erid + данные рекла). Авто-запрос ЕРИД — позже | оператор |
| 10. Блогер наносит ЕРИД | вне системы | контрагент |
| 10/11. Пост вышел | колонка «Публикация» (`post_url`, `published_at`) — руками; автодетект отложен | внешнее событие |
| 11. Акт | колонка «Акт» — загрузка скана, `act_received_at` | контрагент |
| 12. Метрики в медиаплан | фаза «Отчёт»: bulk «снять статистику со всех» (TDLib) → охваты/CPV/ERR | оператор |
| 13. Посткампейн-отчёт | фаза «Отчёт»: автоагрегаты + текстовые выводы, шарится клиенту той же ссылкой | оператор |

### 16.6 Sidebar-сплит по mode

В agency-ws sidebar показывает «Кампании» (визард), в bd-ws — «Проекты»
(канбан). Один проект — один вход, без дубля UI.

### 16.7 Что реализовано к этому моменту

- ✅ Схема: `projects.phase` + brief-поля; `project_items` placement-поля
  (`channel_id`, `available`, `price/forecast`, `client_status` +
  `_comment/_at`, `shortlisted_at`); `project_shares`.
- ✅ API: `campaigns.ts` (placements + аутрич-сводка + stage-фильтр + «в
  шортлист»), `shares.ts` (управление ссылками), `share-client.ts` (публичный
  клиентский доступ). Бриф/phase в `projects.ts`.
- ✅ Web: tree «Клиенты→Кампании» + карточка клиента; визард с живыми фазами
  Бриф / Лонглист / Согласование; клиентский `/share/$token` view.
- ⏳ Отложено: Финальный оффер (bulk-send), Производство (матрица + артефакты
  `placement_files`), Отчёт (TDLib-метрики + постотчёт), `placement_comments`.
