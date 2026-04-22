# Architecture

Картина стека и потоков данных.

---

## 1. High-level картина

```
┌────────────────────────────────────────────────────────────────────────┐
│                            Browser (SPA)                               │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  React + Vite + TanStack Router                              │      │
│  │  state: TanStack Query (polling + opt. SSE)                  │      │
│  │  forms: react-form + Zod schemas                             │      │
│  │  REST-клиент: openapi-fetch (typed из OpenAPI)               │      │
│  └──────────────────────────────────────────────────────────────┘      │
└──────────────────────┬─────────────────────────────┬───────────────────┘
                       │                             │
               [REST /v1/* + cookie]          [SSE /v1/.../stream]
                       │                             │
┌──────────────────────▼─────────────────────────────▼───────────────────┐
│           api.<domain>           (Bun + Hono, один процесс)            │
│  ┌──────────────────────────────────────────────────────┐              │
│  │ REST API (OpenAPI-контракт, Zod-схемы)               │              │
│  │   /v1/workspaces/{ws}/members                        │              │
│  │   /v1/workspaces/{ws}/outreach/sequences/{id}        │              │
│  │   /v1/workspaces/{ws}/contacts                       │              │
│  │   /v1/.../stream   ← SSE для чата и live-экранов     │              │
│  └──────────────────────┬───────────────────────────────┘              │
│                         ▼                                              │
│  ┌──────────────────────────────────────────────────────┐              │
│  │ Drizzle ORM · pg-boss (очередь) · gramjs (MTProto)   │              │
│  └──────────────────────────────────────────────────────┘              │
└────────────────┬───────────────────────────┬───────────────────────────┘
                 │                           │
         ┌───────▼────────┐          ┌───────▼────────┐
         │   PostgreSQL    │          │ S3-совместимое │
         │  (домен, сессии,│          │  (CSV, media,  │
         │   очередь,      │          │   avatars)     │
         │   MTProto ses.) │          │                │
         └────────────────┘          └────────────────┘
```

Один Bun-процесс обслуживает REST + SSE + воркеры pg-boss. Выделять отдельные сервисы — только когда упрёмся в нагрузку.

---

## 2. API-слой

**Один REST-слой с OpenAPI-контрактом**, обслуживающий и UI, и внешние интеграции.

Принципы:

- **Транспорт**: HTTP + JSON, методы по семантике (`GET`, `POST`, `PATCH`, `DELETE`). URL — ресурс-ориентированные: `/v1/workspaces/{wsId}/members`, `/v1/workspaces/{wsId}/contacts/{id}`.
- **Контракт**: Zod-схемы — source of truth для входа/выхода. Из них генерируются и OpenAPI-описание, и typed-клиент для фронта (`openapi-fetch`). Одна схема — одна правда.
- **Версионирование**: префикс `/v1/` как convention. Параллельные версии не поддерживаем — фронт деплоится вместе с бэком, с внешним интегратором breaking changes координируем разом.
- **Timestamps**: всегда ISO-8601 строки (`2026-04-21T02:09:52.989Z`).
- **Аутентификация** (одним middleware, внутри handler'а source не важен):
  - UI → httpOnly session-cookie (после Яндекс OAuth).
  - Внешние интеграции → API-key (scoped на workspace) в `Authorization: Bearer` или `X-API-Key`.
- **Rate-limit**: отдельные лимиты для UI-трафика и API-key трафика.
- **Audit-log**: мутации от API-keys логируются с `apiKeyId`; UI-мутации — с `userId`.

Детальный перечень ручек — `api-contracts.md`.

---

## 3. Real-time

**Polling как дефолт, SSE точечно** — там, где polling ощутимо портит UX.

### Polling
Используется почти везде (списки контактов, настройки, properties, members). Реализация — `refetchInterval` в TanStack Query:

```ts
useQuery({ queryKey: ['contacts', ws], refetchInterval: 3000, ... })
```

Для 50-100 внутренних пользователей при 3-секундном polling'е нагрузка на Postgres ничтожна. Интервал регулируется по фокусу вкладки (TanStack Query делает это из коробки — idle вкладки не опрашивают).

### SSE
Включаем только на экранах, где нужна суб-секундная реакция:
- **Чат** (US-10) — сообщения в активном диалоге.
- **Запущенная кампания** (US-26) — опционально, счётчики отправок/ответов.

Транспорт — `EventSource` на клиенте, поток `text/event-stream` на бэке. На бэке поток держится открытым, heartbeat раз в 30 секунд (иначе прокси рвут idle). Источник событий — Postgres `LISTEN/NOTIFY`: триггер на INSERT/UPDATE в соответствующей таблице шлёт `NOTIFY channel, payload`, бэкенд-подписчик фильтрует по `workspaceId` и пушит клиенту.

Клиентская обвязка — одна обёртка над `EventSource`: реконнект с backoff, интеграция с TanStack Query (обновляет кеш вместо замены состояния).

Это даёт real-time в нужных местах без обслуживания отдельного WS-слоя или Redis.

---

## 4. Монорепо

Инструмент — **pnpm workspaces + Turborepo**.

Пакеты:
- `@repo/core` — shared Zod-схемы, enum'ы, доменные типы. Source of truth для валидации и OpenAPI-генерации.
- `@repo/ui` — дизайн-система (кнопки, формы, таблицы).
- `@repo/api-client` — typed REST-клиент, сгенерирован из OpenAPI-спеки бэка.
- `web` — React SPA.
- `api` — Bun backend (REST + SSE + воркеры в одном процессе).

---

## 5. Frontend stack

| Слой | Выбор |
|---|---|
| Фреймворк | **React** SPA (CSR) |
| Bundler | **Vite** |
| Роутер | **TanStack Router** (file-based, типизированные params/search) |
| Server state | **TanStack Query** (polling; SSE там, где нужно) |
| REST-клиент | **`openapi-fetch`** (codegen из OpenAPI) |
| Формы | **`@tanstack/react-form`** + Zod-валидатор |
| Валидация | **Zod**, схемы из `@repo/core` |
| Стили | **Tailwind** + дизайн-система `@repo/ui` |

Auth — server-side сессия в httpOnly cookie (см. `auth.md`). Клиент просто делает запросы, cookie летит автоматически.

---

## 6. Backend stack

| Слой | Выбор |
|---|---|
| Runtime | **Bun 1.x** (нативный TS, встроенный раннер) |
| HTTP-фреймворк | **Hono** + `@hono/zod-openapi` |
| ORM / query | **Drizzle ORM** + `drizzle-kit` для миграций |
| БД | **PostgreSQL** (managed в Яндекс.Облаке в проде, Docker локально) |
| Real-time источник | Postgres `LISTEN/NOTIFY` → SSE |
| Очередь фоновых задач | **pg-boss** (поверх того же Postgres) |
| Файлы | **S3-совместимое**: Yandex Object Storage в проде, **MinIO** локально |
| MTProto | **gramjs**; сессии хранятся в Postgres `jsonb`-колонке |
| Auth | Яндекс OAuth2 → server-side session в Postgres |
| Scheduler | pg-boss schedules (cron-expression внутри очереди) |

Ключевой принцип: **один Bun-процесс делает всё** (REST, SSE, воркеры). Выделять отдельные сервисы — только когда конкретный pain point появится.

---

## 7. Request flow — пример создания воркспейса

1. Форма submit → `openapi-fetch` → `POST /v1/workspaces`.
   - Body: `{ name, organizationId }`.
   - Cookie с session-id летит автоматически.
2. Backend (Hono handler):
   - Auth middleware по cookie поднимает сессию из Postgres, проставляет `ctx.userId`.
   - Zod валидирует вход из OpenAPI-схемы.
   - Drizzle транзакция: `INSERT INTO workspaces` + `INSERT INTO workspace_members (user_id, workspace_id, role='admin')`.
   - Возвращает созданный ресурс (сериализация по тем же Zod-схемам).
3. Клиент:
   - TanStack Query инвалидирует связанные queries.
   - Router переходит на `/w/{newId}/settings/workspace`.

---

## 8. Почему Postgres, а не Firestore/Supabase/etc

- **Нет Google/AWS-only зависимостей** — критично для корпоративного Яндекс-хостинга.
- **SQL + нормальные JOIN'ы** — `getMembers` с обогащением user profile делается одним запросом, а не денормализацией на запись.
- **Один формат timestamp**, стандартные транзакции, миграции через `drizzle-kit`.
- **Локальная отладка** — `docker run postgres` и всё. Без эмуляторов cloud-сервисов.
- **Real-time через `LISTEN/NOTIFY`** закрывает 90% потребности; SSE-мост пишется один раз.
- **`jsonb`** для custom properties контактов — динамическая схема без Firestore.
- **pgvector** — если когда-нибудь захочется AI-поиска по контактам/сообщениям, добавить колонку, не менять БД.

Цена: real-time через подписку SDK на клиенте пропадает как паттерн, вместо него polling + точечный SSE. Это осознанный trade-off, см. §3.

---

## 9. Authentication flow

Коротко (детали — `auth.md`):

1. Кнопка «Войти через Яндекс» → редирект на `oauth.yandex.ru/authorize` с `client_id`, `scope=login:email login:info`.
2. Callback `/auth/yandex/callback?code=...` → бэк меняет `code` на `access_token` через `oauth.yandex.ru/token`.
3. `GET login.yandex.ru/info` с token'ом → `{ email, first_name, ... }`.
4. Матчим по email на `users`, создаём при первом входе. Генерим session-id, пишем в `sessions`, ставим httpOnly cookie.
5. Все дальнейшие запросы — по cookie. Middleware поднимает сессию из БД.

API-keys — отдельная таблица `api_keys` (scoped на workspace), передаются в `Authorization: Bearer` или `X-API-Key`, проверяются тем же middleware.

---

## 10. Observability

MVP:
- **Structured JSON-логи в stdout** — читаются любым коллектором Яндекс.Облака.
- **Sentry** (SaaS trial или self-hosted **GlitchTip**) — ошибки фронта и бэка.

Рост:
- Выделить structured metrics (rate-limit hit-rate, MTProto flood-wait, pg-boss latency).
- Request-id в логах каждого запроса, пробрасывать в pg-boss-задачи.

---

## 11. Deployment / environments

**Локально:**
```
docker compose up
```
Один compose поднимает: postgres, minio, backend (Bun hot reload), frontend (vite dev server). Весь dev — офлайн.

**Прод (MVP):**
- Бэкенд: один Docker-образ, **Yandex Serverless Containers** или обычная VM с `docker compose up -d`.
- Фронт: статика Vite билда → Yandex Object Storage + CDN, либо nginx на той же VM.
- БД: **Managed PostgreSQL** в Яндекс.Облаке.
- Файлы: **Yandex Object Storage** (S3 API).

Окружения: `prod` и `staging` — разные базы и бакеты. Без K8s.

---

## 12. Что обязательно для работающей системы

1. **PostgreSQL** + миграции (`drizzle-kit`).
2. **REST backend** — полный набор ручек из `api-contracts.md`.
3. **Яндекс OAuth** + session storage в Postgres.
4. **S3-совместимое хранилище** + signed URL для uploads.
5. **pg-boss** — фоновые задачи (reschedule sequences, dispatch outreach messages, cleanup expired invites).
6. **MTProto clients** (gramjs) для outreach и personal sync.
7. **SSE** для чата (US-10).

---

## 13. Что можно отложить / пропустить

- **Cello integration** — viral/referral, не core.
- **Google Calendar integration** — nice-to-have для reminders.
- **Proxy pool** для outreach-аккаунтов — до первого flood-wait/блокировки можно без него.
- **Отдельный worker-процесс** — сначала всё в одном Bun-процессе, выносим когда очередь начнёт тормозить HTTP.
- **SSE везде** — пишем только для чата (и опционально для live-экрана кампании). Остальное — polling.
- **Read replica Postgres, Redis, CDN** — по мере роста.
