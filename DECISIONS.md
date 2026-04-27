# Decisions / отклонения от оригинала

Рабочий лог сознательных отклонений реимплементации от поведения и стека оригинального `app.crmchat.ai`. Не входит в `specs/` и MkDocs-nav — это справка «почему у нас не как у них», нужная при code review и онбординге.

Каждая запись: **решение → в чём отличие → почему**.

---

## Один API-слой вместо двух

**Решение.** Единый REST-слой (`/v1/*`) с OpenAPI-контрактом, обслуживающий и UI, и внешние интеграции.

**В оригинале.** Два параллельных транспорта: tRPC (`workspace.*`, `contact.*`, `telegram.*`, batched `POST /trpc/<proc>?batch=1`, internal) и oRPC-style REST (`workspaces.*`, `outreach.sequences.*`, `/v1/<resource>`, публичный контракт из `api-contract.generated.json`). Фронт вызывает оба.

**Почему отказались.**
- Двойная поверхность — двойной долг: валидация, authZ, rate-limit, мониторинг, OpenAPI дублируются.
- Корпоративная CRM всё равно требует стабильного публичного контракта → берём его как единственный backbone.
- Type-safety, ради которой нужен был tRPC, получается и из Zod-схем + OpenAPI-codegen для фронта.

---

## Без i18n

**Решение.** UI на одном языке, строки inline в JSX (или один `constants.ts` для повторяющихся).

**В оригинале.** i18next + заранее скомпилированные locale-чанки (`locales/chunks/*.js`), ключи вида `web.role.admin`.

**Почему отказались.** Мультиязычности не планируется. Разнесение строк от кода без этого дает нулевой выигрыш, добавляет косвенность (ключ → файл → строка) и ещё один слой для поддержки.

---

## Timestamp-формат в API

**Решение.** Всегда ISO-8601 строки (`2026-04-21T02:09:52.989Z`).

**В оригинале.** tRPC-ручки возвращали Firestore-native `{_seconds, _nanoseconds}`; oRPC — ISO. Два формата в одном клиенте.

**Почему.** Один формат — меньше места для багов на клиенте; интеграторам не нужно учить Firestore-специфику.

---

## PostgreSQL вместо Firestore

**Решение.** Доменные данные, сессии, очередь фоновых задач, MTProto-sessions — всё в одной PostgreSQL. Real-time — через `LISTEN/NOTIFY` + SSE там, где нужно; polling через TanStack Query — везде, где polling не портит UX.

**В оригинале.** Firestore как основная БД: клиент напрямую подписывается через SDK, security rules — первая линия авторизации, триггеры через Cloud Functions. Два формата timestamp (`{_seconds, _nanoseconds}` vs ISO).

**Почему отказались.**
- Внутренний продукт в Яндексе: Google-сервисы заблокированы на уровне корпоративной инфры.
- Локальная отладка: `docker run postgres` — и всё. Firestore-эмулятор требует изучения и заметно отличается от прода.
- Нормальные JOIN'ы, транзакции, миграции через `drizzle-kit` — всё стандартное, есть в любом учебнике.
- Firestore pricing за каждый read при подписках на чате масштабируется плохо.
- Security rules — отдельный язык, отдельное тестирование; middleware на сервере всё равно дублирует проверки. Уход от rules делает модель авторизации прямолинейной (вся авторизация в backend-middleware).
- `pgvector` как опция AI-поиска в будущем без смены БД.

---

## Яндекс OAuth вместо Firebase Auth

**Решение.** Логин через Яндекс OAuth 2.0 (Authorization Code Flow), session-id в httpOnly cookie, `sessions`-таблица в Postgres. API-keys — отдельный канал для внешних интеграций.

**В оригинале.** Firebase Auth + Telegram initData; мост через `authSessions/{id}` в Firestore для веб-логина; custom-token flow.

**Почему.** Тот же корпоративный контекст: Firebase Auth недоступен. Яндекс — штатный корпоративный IdP, всё равно единая учётка. OAuth2 — три `fetch`'а на бэке, SDK не нужен.

---

## Bun + Hono + Drizzle вместо Node + tRPC + Firestore SDK

**Решение.** Runtime — Bun 1.x (нативный TS, быстрый старт, встроенный test-runner). HTTP — Hono + `@hono/zod-openapi` (валидация + OpenAPI одной схемой). Query layer — Drizzle ORM (TS-first, миграции встроены).

**В оригинале.** Node + tRPC v11 batched POST + Firebase Admin SDK. Типы через монорепу, не через сгенерированный контракт.

**Почему.** Stack-дефолт 2026 для greenfield TS-бэка без vendor lock-in. Bun снимает tsx/ts-node, Hono работает под любым runtime, Drizzle ближе к SQL чем Prisma.

---

## Один Bun-процесс для REST + SSE + воркеров

**Решение.** На старте REST-ручки, SSE-стримы чата, и pg-boss воркеры живут в одном Bun-процессе.

**В оригинале.** Backend + Cloud Functions (scheduler, triggers) как отдельные runtime'ы.

**Почему.** Для MVP на малой нагрузке выделение воркера — преждевременная инфра. Выносим в отдельный контейнер тогда, когда pg-boss начнёт тормозить HTTP-запросы.

---

## S3-совместимое вместо Firebase Storage

**Решение.** Yandex Object Storage в проде, MinIO в Docker локально. Стандартный S3 API.

**Почему.** Снова корпоративный контекст + локальная отладка. S3 API — универсальный, клиент (`@aws-sdk/client-s3` или аналог) работает с любым провайдером.

---

## Polling как дефолт, SSE точечно

**Решение.** TanStack Query с `refetchInterval` для большинства экранов (контакты, настройки, свойства, лиды). SSE — только в чате (US-10) и опционально в live-экране запущенной кампании (US-26).

**В оригинале.** Firestore-подписки на клиенте везде.

**Почему.** На 50-100 пользователях polling 3 сек даёт ~300 req/sec — это ничто для Postgres. SSE-хелпер (реконнект, heartbeat, фильтрация по workspaceId) — 1-2 дня аккуратной работы, не нужной на старте. Пишем SSE там, где суб-секундная реакция реально критична.

---

## Известный технический долг (отложен до обоснования)

Поднято в ревью, осознанно НЕ делаем сейчас (MVP-режим, см. `CLAUDE.md`). Возвращаемся, когда упрёмся.

**Безопасность / надёжность:**
- `createSession` удаляет старую row только по `sid`, без сверки `userId`. Sid 256-битный, угадать невозможно — реальный риск ~ноль. Усилить когда появится shared-environment (kiosk, terminal).
- Rate limit на `/v1/auth/*` и `/v1/_dev/login` — pre-launch чек, не до prod.
- CSRF-защита через `SameSite=Lax` + CORS-allowlist. На текущих ручках достаточно (мутации только через fetch с CORS). Усиление через double-submit token — когда появится cross-subdomain (`app.crmchat.ai` + `api.crmchat.ai`).
- `assertMember` → 403 одинаково для «не существует» и «не ваш». Это намеренно — не раскрываем существование чужих wsId. Не «исправлять» на 404.

**БД / схема:**
- `updatedAt` руками проставляется в handler'ах, не через `$onUpdate`. Забытая ручка → таблица разъедется. Перевести на `$onUpdate(() => new Date())` когда будет 5+ доменов.
- Compound index `(workspace_id, created_at)` на `contacts`/`properties` — нужен на 10к+ строк. Сейчас полный seq scan = 0.1мс.
- GIN-индекс на `contacts.properties` jsonb — нужен когда появится фильтр «contacts where properties.stage='wip'» в UI (US-2).
- pg-boss schedule `cleanup.expired_sessions` (DELETE WHERE expires_at < now()) — pre-prod cron.
- Переход с `drizzle-kit push` на `generate + migrate` для prod. Включает `propertyType` enum: `ALTER TYPE ADD VALUE` при добавлении `date`/`multi_select`.
- Nullable workspace.organizationId / auto-create org при OAuth-callback — сейчас seed создаёт org, новый OAuth-юзер словит 500 на первом workspace.

**API контракты:**
- `updatedAt` в response-схемах `Workspace/Contact/Property` (data shape финальный по `CLAUDE.md`).
- POST `/v1/workspaces/{wsId}/properties/reorder` — single-transaction batch. Сейчас два независимых PATCH с optimistic update + rollback.
- PATCH контакта в БД-транзакции (read existing → validate → update). Race-окно есть, но в single-user MVP не выстрелит.

**UX / архитектура:**
- Optimistic concurrency для edit property (ETag/updatedAt). Multi-user сценарий.
- Dirty-flag в edit form контакта (background refetch затирает локальные правки). MVP — игнор.
- defaultHook OpenAPIHono для унификации Zod-validation errors через onError.
- contact-payload helper (parsing propsClean) — выносим на 3-м повторе.
- Lint/prettier — когда появится 2-й разработчик.
- Тесты `contact-properties.ts` — самый богатый на edge-cases модуль, первый кандидат на Bun test.

**Инфра:**
- CORS origin в `WEB_ORIGIN` env вместо хардкода — перед первым деплоем.
- SIGTERM/SIGINT graceful shutdown (`sql.end()`) — когда Bun-процесс пойдёт в Docker.
- Prod-деплой: где запускается, как конфигурится, где `NODE_ENV=production` — описать в specs перед staging.
- `drizzle-kit --env-file=...` вместо ручного парсера в drizzle.config.ts — рефакторинг ради рефакторинга, текущий работает.

**Outreach:**
- **Phone-only лиды (отложено, не известно нужно ли).** `outreach-worker.ts:sendOne` бросает `PHONE_NOT_SUPPORTED` для лидов без `username`. Путь через `Api.contacts.ImportContacts` написан не был — юзер сам сказал «пока непонятно надо ли это вообще». Direct dep `big-integer` УЖЕ установлен (на случай если возьмёмся). Будет реактивно, когда упрёмся в реальный CSV без username.
- **Multi-instance worker.** В `apps/api/src/index.ts` worker крутится в HTTP-процессе. На двух репликах оба будут выбирать одни и те же `pending` scheduled_messages → дубль-отправка. Pre-prod: либо advisory-lock (`pg_try_advisory_lock` на хеш от `scheduledMessages.id`), либо запускать worker только на одной реплике (sticky-route / отдельный процесс).
- **FloodWait уже уважаем** (`outreach-worker.ts` ловит `FloodWaitError`/`SlowModeWaitError`, ставит per-account cooldown в памяти + двигает `sendAt`). На рестарте процесса cooldown теряется — первая попытка снова словит тот же flood и заново уснёт.
- **Inbound listener: реализован для остановки sequence на ответ, не для UI чата.** `outreach-listener.ts` ловит `NewMessage incoming:true isPrivate:true`, матчит `senderId` против `outreach_leads.tg_user_id` в workspace, ставит `replied_at` и cancel'ит pending во ВСЕХ sequences этого лида. Listener подключается eager на старте воркера + при сразу после успешной auth (см. `outreach-account-client.ts:persistOutreachAccount`). НЕ закрывает: лид ответил ДО того как мы получили его tg_user_id (мы его получаем только после первой успешной отправки через `client.getEntity`). Если кто-то сначала ответил юзеру вне CRM, потом мы запустили sequence — match'а не будет, sequence пойдёт. Это закроется когда добавим CRM-side resolve username→tgUserId на этапе CSV-импорта (TODO без приоритета).
- **Полноценный UI ответов (чат внутри CRM, история переписки) — НЕ делаем.** Это отдельная фича уровня donor's «embedded TG-chat», большая. Сейчас в карточке лида только зелёная подсветка строки + relative «ответил X мин назад». Юзер уходит читать ответ в TG-клиент.
- **TWA iframe-чат в карточке контакта — реализован.** `apps/tg-client` форк Ajaxy/telegram-tt вендорится через bootstrap-патч, монтируется как iframe в `_authenticated` layout (`<TgChatHost>` alive across opens — один MTProto handshake на жизнь сессии). Кнопка «Открыть чат» в `/contacts/$id` шлёт `openChat` через postMessage. Account = первый active outreach-аккаунт; account-switcher и continuity-of-identity (использовать тот аккаунт что писал лиду первым) — следующим заходом.
- **`/twa-session` отдаёт MTProto authKey по HTTP.** Это полный контроль над TG-аккаунтом. Защиты: `assertMember` middleware (workspace-scoped), `Cache-Control: no-store, private` на response (ни browser, ни прокси не сохраняют), HTTPS обязателен в проде (TODO env-config CORS/Origin). При компрометации одного workspace'а злоумышленник получает auth-keys всех outreach-аккаунтов этого workspace — тот же blast-radius что и при прямом доступе к БД. Принимаем риск.
- **Re-auth UI пока инструкцией.** На странице outreach-аккаунта со статусом `unauthorized` показывается текст «зайдите через Добавить под тем же TG-юзером» (наш `persistOutreachAccount` использует `onConflictDoUpdate` по `(workspaceId, tgUserId)`, при auth тем же телефоном запись обновится). Кнопка «Войти заново» с pre-filled phone — следующим заходом.

---

## Property type enum: number → multi_select без миграции

**Решение.** В MVP-итерации property_type был `text|number|single_select`. После UX-feedback `number` убран, добавлен `multi_select` (хранится массивом option.id в `contacts.properties[key]`). Переход сделан **дропом БД** (`docker compose down -v && db:push && db:seed`).

**Почему дроп, а не миграция.** Постгрес не поддерживает `ALTER TYPE ... DROP VALUE`. Аккуратная prod-миграция этого enum требует recreate через временный тип + `ALTER TABLE ALTER COLUMN ... USING ...`. До prod-деплоя у нас нет «живых» данных — дроп проще и оставляет схему чистой. Согласовано как универсальное правило (см. memory: «Drop DB before prod»).

**Что когда поедем в prod.** Включить `drizzle-kit generate + migrate`, и любая будущая правка enum будет идти через явную миграцию (recreate-pattern). Записать в pre-launch чек-лист.

---

## TG-аккаунты: два разных типа в двух разных таблицах

**Решение.** Разделяем личный CRM-аккаунт юзера и outreach-аккаунты на уровне схемы:
- `telegram_accounts` — **один** на user (unique по user_id), используется для импорта чатов из TG-папок (`/settings/telegram-sync`).
- `outreach_accounts` (придёт с outreach-модулем) — **много** на workspace, со своим proxy, warmup-pipeline, encrypted secrets, daily rate-limit, sharding bucket.

**В оригинале.** Так же: личный аккаунт подключается в разделе CRM, outreach-аккаунты — отдельно в разделе «Рассылки». Donor явно проговаривает причину: TG ограничивает холодные сообщения (~5/день, 15 с Premium), личный аккаунт сожгут на первой массовой рассылке. Continuity of identity: лид всегда отвечает с того аккаунта, что писал ему первым.

**Почему так у нас.** Architectural разделение — иначе one-table-fits-all быстро превратится в кашу: у personal нет proxy/warmup/bucket, у outreach нет связи с user через unique. Разные жизненные циклы (personal — долгоживущий, аккуратный; outreach — расходник). Разные операционные паттерны (single-instance auth vs multi-instance с фоновым worker'ом). Разная UX-семантика для юзера.

**Что НЕ делаем сейчас (для CRM-аккаунта донора есть, у нас нет — отдельные фичи):**
- Reply из CRMChat-интерфейса (embedded TG-чат). Большая отдельная фича.
- Forward сообщения как лид. Отдельный источник импорта.
- QR-коды на конференциях. Отдельный источник.

---

## Шаблон для новых записей

```
## {{краткое имя решения}}

**Решение.** {{что делаем}}

**В оригинале.** {{что было}}

**Почему.** {{основные причины}}
```

---

## Pre-prod TODO (TG-unread mirror)

Зафиксировано после серии правок `feat(unread)` — рабочее в MVP, требует
доработки до прод-нагрузки.

- **N+1 RPC риск в `outreach-listener.ts` fallback'е**. Если на outreach-аккаунт
  массово пишут не-known TG-юзеры, `event.message.getSender()` уходит в TG за
  каждым уникальным sender'ом. Сейчас not-hot-path (срабатывает один раз на
  контакт, потом инжектируется `tg_user_id` и идёт быстрый путь). Решения:
  in-memory `Map<senderId, username>` как кэш, либо запрет создания контактов
  без `tg_user_id` через UI (использовать `/contacts/lookup/by-tg`-резолв).
- **`provisionIframeSession` блокирует auth-флоу**. Если генерация
  iframe-session упадёт после авторизации worker'а — юзер не может закончить
  логин (QR висит). Альтернатива: lazy-провижн при первом запросе
  `/twa-session` с возможностью retry. Сделать `iframe_session` nullable +
  отдельный POST `/accounts/{id}/refresh-iframe-session` для retry.
- **`reviveDeadListeners` каждые 10 сек** — N RPC на N аккаунтов. На 100+
  outreach-аккаунтов это 10 RPC/сек впустую. Перейти на event-driven: ловить
  `disconnect`-event клиента gramjs и сразу пересоздавать, без polling.
- **TDLib вместо gramjs (long-term).** Текущий gramjs-стек принят как
  pre-MVP. Триггеры для миграции: рост числа аккаунтов, появление CRM-side
  чата (без iframe), очередной незакрываемый bug в gramjs. Конкретно по
  серии `feat(unread)` нашими руками собраны workaround'ы для quirks gramjs
  (handler-leak при reconnect, плоский ImportAuthorization без InitConnection,
  пустой `catchUp()`, ручной DC migration). Половина-треть боли уйдёт на
  TDLib (`tdl` / `prebuilt-tdlib`). Цена — ~15-20 часов миграции и мост
  TDLib↔gramjs для передачи auth_key в TWA-iframe.
