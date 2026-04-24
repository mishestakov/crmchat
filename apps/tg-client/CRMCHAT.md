# CRMchat-патч поверх TWA

Кастомизация Telegram Web A (`apps/tg-client/`) для встраивания в наш CRM
как iframe.

## Архитектура

```
[apps/web SPA] ←postMessage→ [apps/tg-client iframe] →wss→ [Telegram DC]
```

CRM (родитель iframe'а) передаёт `session` через postMessage, говорит
«открой чат с лидом X»; iframe сообщает обратно про authState/connection/
открытый чат. Никаких внешних прокси — wss напрямую в TG.

## URL-контракт iframe

`https://<tg-host>/?accountId=<id>&theme=<dark|light>&t=<ts>#<userId>`

| параметр | назначение |
|---|---|
| `accountId` | id outreach-аккаунта (наш 12-hex shortId), префиксует все storage/cache keys, изолирует CRM-аккаунты в одном браузере |
| `theme` | `dark`/`light`, перекрывает пользовательскую тему |
| `t` | timestamp, cache-bust |
| `#<userId>` | TG user id для openChat (или передаётся отдельным postMessage) |

## Файлы которые мы трогаем

12 файлов upstream + 1 новый. Меньше чем у [донора (CRMchat
оригинал)](../../telegram/README.md) на счёт отказа от:
- chatter-режима (флаги `CAN_DELETE_*`, `CAN_ACCESS_*`)
- собственного MTProto-прокси (`_dcAuth`, `_dcDomain`)
- `setDisplayedProperties` (рендера в патче нет, фича dormant)
- `mtprotoSenderLogs` audit-канала

### Изменения upstream

| файл | суть правки |
|---|---|
| `src/components/App.tsx` | если не в iframe — заглушка + редирект на CRM-host |
| `src/config.ts` | `CRM_ACCOUNT_ID` из `?accountId=`; `PRODUCTION_HOSTNAME`/`URL` под наш host |
| `src/global/actions/api/initial.ts` | `initApi` async, `await loadStoredSession()` |
| `src/global/actions/ui/initial.ts` | тема из `?theme=` URL вместо user-setting |
| `src/util/browser/globalEnvironment.ts` | `IS_MULTIACCOUNT_SUPPORTED = false` (отключаем встроенный SharedWorker multi-account; у нас свой через accountId-префикс) |
| `src/util/browser/windowEnvironment.ts` | `IS_OPEN_IN_NEW_TAB_SUPPORTED = false` (вкладка без accountId не получит сессию) |
| `src/util/cacheApi.ts` | префикс `${CRM_ACCOUNT_ID}_` к именам Cache API |
| `src/util/multiaccount.ts` | префикс `${CRM_ACCOUNT_ID}_` ко всем BroadcastChannel/localStorage/MULTITAB ключам |
| `src/util/sessions.ts` | выпил всех localStorage-операций сессии; `loadStoredSession` async + `requestSessionFromCrmChat()` |
| `src/util/setupServiceWorker.ts` | закомментирован диалог «SERVICE_WORKER_DISABLED» (в iframe не пугаем) |
| `src/util/websync.ts` | `forceWebsync` отключён (кросс-синк `/a ↔ /k` бессмыслен в iframe) |

### Новый файл

`src/util/crmchat.ts` — postMessage-мост:

| что | зачем |
|---|---|
| **window.message** с whitelist origin | принимает `sessionResponse`, `openChat`/`openChatByUsername` |
| **addCallback на global state** | шлёт родителю `authStateLegacy`, `chatUnreadState`, `chatOpened` (peer + avatar dataURI + bio) |
| **`apiUpdate` handler** | шлёт родителю `authState`, `connectionState` |
| **`window.Worker` patch с `accountId`** | воркер MTProto знает свой accountId для storage-префиксов |

## Как поднять локально

```bash
cd apps/tg-client
npm install                    # ~5-10 минут, ~600MB node_modules
npm run dev                    # webpack-dev-server на http://localhost:1234
```

## Как мерджить upstream-обновления

См. UPSTREAM.md.
