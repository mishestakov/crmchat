# CRMchat TG Client — форк-анализ

Разбор кода, который работает на `https://tg-client.crmchat.ai/`.

- Версия бандла: `main.de7f9b53a55223e896f0.js` (собран ~2026-04-13, `Last-Modified` HTTP-заголовок).
- Sourcemap опубликован (`main.de7f9b53a55223e896f0.js.map`, 2.3 МБ) с `sourcesContent`, 359 исходников с оригинальными путями.
- Патч поверх чистого upstream: [`crmchat-fork-vs-60aaf900.patch`](./crmchat-fork-vs-60aaf900.patch).
- Сырые результаты fingerprint-а: [`results/fp-results.json`](./results/fp-results.json), [`results/fork-modified.json`](./results/fork-modified.json).
- Инструментарий, которым всё считалось: [`tools/`](./tools/) (см. [`tools/README.md`](./tools/README.md)).

## Что это

Хард-форк **Telegram Web A** (`Ajaxy/telegram-tt`, ветка `/a` с `web.telegram.org`). Это не Web K (`/k`, `morethanwords/tweb`), не независимый клиент и не рантайм-патч/user-script.

Доказательства базы:
- `compatTest.js` идентичен апстриму (включая localStorage-флаг `tt-ignore-compat` и fallback-страницу «Unsupported Browser»).
- `redirect.js` содержит логику `weba.telegram.org` / `webz.telegram.org` → `web.telegram.org/a` — код прямо из апстрима.
- localStorage-ключи с префиксом `tt-`: `tt-global-state`, `tt-shared-state`, `tt-passcode`, `tt-is-screen-locked`, `tt-media*`, `tt-custom-*`, `tt-log.json`.
- Webpack-схема `main.[20hex].js` + ленивые чанки `[id].[20hex].js` — телеграм-ттшная сборка.
- Префикс всех путей в sourcemap: `webpack://telegram-t/./src/…`.

## База форка: `60aaf900` (v12.0.22, 2026-04-08)

Полная SHA: `60aaf90093b6756cddbb35822616caf0d8ad51fa`.

### Как определена

File-level fingerprinting: для каждого из 343 трекаемых файлов форка (исключая `node_modules/`) посчитан blob-SHA (`git hash-object`). Затем для каждого из 901 коммита upstream за период с 2025-01-01 сделан `git ls-tree -r <commit>` и посчитано число побайтных совпадений.

Топ-5:

```
60aaf900  match=312/343 mismatch=30 missing=1  2026-04-08  12.0.22
e755a773  match=312     mismatch=30 missing=1  2026-03-31  [Build]
8322be99  match=312     mismatch=30 missing=1  2026-03-31  Pinned Messages: …
6b384c8d  match=312     mismatch=30 missing=1  2026-03-31  Support Emoji 17
0f18a00e  match=310     mismatch=32 missing=1  2026-03-31  ← счёт падает
```

Плато 312 на коммитах `6b384c8d → 60aaf900` = эти коммиты не трогают ни один файл, который затронут форком. Следующий (`0f18a00e`) уже меняет один из таких файлов → match падает с 312 до 310. Значит форк собран поверх одного из четырёх коммитов плато; берём самый поздний — `60aaf900`.

### Счёт

- **312 файлов** совпадают с upstream@60aaf900 побайтно → не тронуты форком.
- **30 «модифицированных»** — из них **17 ложных** (shim-модули `mini-css-extract-plugin`, эмитящие map классов вида `{"root":"omYjO7To",...}` — это не source, а webpack-virtual).
  - Реально изменено: **13 файлов**.
- **1 «missing»** — файл, добавленный форком: `src/util/crmchat.ts`.

## Изменения CRMchat (14 файлов, ~100 diff-строк + 215 строк нового)

### Новый файл `src/util/crmchat.ts`

Вся интеграция с родительским CRM через postMessage + перехват Worker для MTProto-роутинга:

- Accept-list источников: `https://app.crmchat.ai`, `https://hints-crm.web.app` (+ localhost в dev).
- **Родитель → клиент:** `sessionResponse` (session + authParams), `openChat` / `openChatByUsername`, `setDisplayedProperties`.
- **Клиент → родитель:** `sessionRequest` / `sessionRequestFailed`, `authState`, `authStateLegacy`, `connectionState`, `chatOpened` (с метаданными peer: id, username, avatar data-URI, fullName, bio), `chatUnreadState`, `mtprotoSenderLogs`.
- Монки-патч `window.Worker`: каждому воркеру добавляются query-параметры `accountId`, `_dcAuth`, `_dcDomain` (dc/dcx/ru-dc).
- Флаги ролевой модели: `CAN_DELETE_CHAT`, `CAN_DELETE_MESSAGES`, `CAN_ACCESS_SETTINGS`, `CAN_ACCESS_SERVICE_NOTIFICATIONS`, `CAN_BLOCK_CONTACT`, `CAN_MUTE_CHAT`. Включены/выключены по URL-параметру `p`: `p=0` → «chatter» (урезанный режим).

### Патчи

| файл | суть правки |
|---|---|
| `src/config.ts` | `CRM_CHAT_ACCOUNT_ID` из URL-параметра; `PRODUCTION_HOSTNAME`/`PRODUCTION_URL` → `tg-client.crmchat.ai`; `CHAT_HEIGHT_PX` 72→80 |
| `src/components/App.tsx` | Если не в iframe — через 3 сек редирект на `crmchat.ai` + заглушка «Go to CRMchat.ai to use CRM» |
| `src/util/sessions.ts` | **Выпилено хранение сессии в localStorage целиком.** `loadStoredSession` теперь async и вызывает `requestSessionFromCrmChat()` (postMessage к родителю). `storeSession`, `clearStoredSession`, `clearStoredLegacySession`, `storeLegacySession` — no-op. Сессия полностью контролируется родительским CRM |
| `src/util/multiaccount.ts` | В ключи BroadcastChannel / localStorage / global-state / session-slot вкручен префикс `CRM_CHAT_ACCOUNT_ID` — изоляция CRM-аккаунтов на одном домене |
| `src/util/cacheApi.ts` | В имена Cache API добавлен тот же префикс |
| `src/util/notifications.tsx` | Пуши от `SERVICE_NOTIFICATIONS_USER_ID` (777000) подавляются, если `!CAN_ACCESS_SERVICE_NOTIFICATIONS` |
| `src/global/selectors/messages.ts` | `canDelete = CAN_DELETE_MESSAGES && …` — чаттер не удаляет сообщения |
| `src/global/actions/ui/settings.ts` | Если `!CAN_ACCESS_SETTINGS`, попытка открыть настройки редиректит в список чатов |
| `src/global/actions/ui/initial.ts` | Тема берётся из `?theme=` URL вместо пользовательской настройки |
| `src/global/actions/api/initial.ts` | `initApi`-handler стал async, `await loadStoredSession()` — поскольку сессия приходит из CRM через postMessage |
| `src/util/browser/globalEnvironment.ts` | `IS_MULTIACCOUNT_SUPPORTED = false && …` — отключён SharedWorker-мультиаккаунт (у них свой поверх `accountId`) |
| `src/util/browser/windowEnvironment.ts` | `IS_OPEN_IN_NEW_TAB_SUPPORTED = false && …` — запрещено «открыть в новой вкладке» |
| `src/util/websync.ts` | `forceWebsync` отключён целиком (`if (true \|\| ...) return undefined`) — нет кросс-версионной синхронизации `web.telegram.org/a ↔ /k` |
| `src/util/setupServiceWorker.ts` | Закомментирован диалог про отключённый Service Worker |

## Архитектура интеграции

```
┌─────────────────────────────┐   postMessage    ┌──────────────────────────┐
│  app.crmchat.ai (parent)    │ ←──────────────→ │ tg-client.crmchat.ai     │
│  SPA, выдаёт session/authP  │                  │ (iframe, форк TWA)       │
│  слушает chatOpened/…       │                  │                          │
└─────────────────────────────┘                  │  ┌──────────────────┐    │
                                                 │  │ PatchedWorker:   │    │
                                                 │  │ +accountId       │    │
                                                 │  │ +_dcAuth         │    │
                                                 │  │ +_dcDomain       │    │
                                                 │  └─────────┬────────┘    │
                                                 └────────────┼─────────────┘
                                                              │ wss
                                              ┌───────────────▼───────────────┐
                                              │ wss://*.dc.crmchat.ai/        │
                                              │ wss://*.dcx.crmchat.ai/       │  ← МTProto-прокси
                                              │ wss://*.ru-dc.crmchat.ai/     │    CRMchat (CSP-гейт)
                                              └───────────────┬───────────────┘
                                                              │
                                                              ▼
                                                         Telegram DCs
```

CSP документа ограничивает `connect-src` только `wss://*.dc.crmchat.ai`, `wss://*.dcx.crmchat.ai`, `wss://*.ru-dc.crmchat.ai`. Напрямую в Telegram клиент не ходит — весь MTProto идёт через прокси-флот CRMchat с авторизацией по токену `_dcAuth`, полученному из SPA-родителя.

## URL-контракт

`https://tg-client.crmchat.ai/?accountId=<id>&theme=<dark|light>&t=<ts>&p=<0|1>&dcDomain=<dc|dcx|ru-dc>#<userId>`

| параметр | назначение |
|---|---|
| `accountId` | ID CRM-аккаунта, префиксует все storage-ключи и MTProto-воркер |
| `theme` | `dark` / `light`, перекрывает пользовательскую тему |
| `t` | timestamp, cache-bust |
| `p` | `1` = полный оператор, `0` = «chatter» (нельзя удалять/блокировать/настройки/mute) |
| `dcDomain` | выбор кластера прокси: `dc` (default), `dcx`, `ru-dc` |
| `#<userId>` | Telegram user id для `openChat` |

## Воспроизведение

```bash
git clone https://github.com/Ajaxy/telegram-tt
cd telegram-tt
git checkout 60aaf900
git apply ../telegram/crmchat-fork-vs-60aaf900.patch
# diff будет показывать ровно 14 файлов (13 изменений + 1 новый), ~100 строк + crmchat.ts
```

## Артефакты (эта папка)

- `crmchat-fork-vs-60aaf900.patch` — полный unified diff (22 КБ).
- `results/fp-results.json` — топ-50 коммитов по match-score (из 901 проверенного).
- `results/fork-modified.json` — явные списки modified/added.
- `tools/` — воспроизводимая обвязка (`extract-sources.js` → `fp.js` → `diff.js`), см. `tools/README.md`.

Восстановленный каталог `fork-src/` (346 файлов, ~2 МБ, в т.ч. `src/util/crmchat.ts`) в репо не хранится — генерируется скриптом `tools/extract-sources.js` из публичного `main.*.js.map`.

## Методология определения версии

Короткая заметка на будущее, если понадобится повторить трюк для других форков:

1. Проверь `curl -sI <bundle>.map` — часто sourcemap опубликован и `sourcesContent: true`. Это сразу даёт исходники 1-в-1.
2. Посмотри префикс `webpack://<name>/` в `sources[]` — он обычно совпадает с именем пакета/репо.
3. Для каждого восстановленного файла → `git hash-object` → blob-SHA.
4. Для каждого коммита апстрима → `git ls-tree -r <c>` → карта `path → blob-SHA`.
5. Argmax по числу побайтных совпадений. Плато из нескольких коммитов = окно, в котором коммиты не трогают файлы форка; база = самый поздний коммит плато.

Это O(N_commits × tree_size), без построчного diff'а — в 1000× быстрее наивного `checkout + overlay + diff --stat` и даёт тот же ответ.
