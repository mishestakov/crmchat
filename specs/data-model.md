# Data model

Этот документ — попытка восстановить схему данных (в основном Firestore) по **наблюдаемым** ответам tRPC / oRPC. Всё ниже — из captured RPC в `tools/capture/processed/rpc/`. Там, где свидетельств нет, стоит `⚠️ OQ`.

---

## 1. Backend-платформа

**Firebase (Google Cloud)**. Идентифицируется однозначно:
- **Storage bucket**: `hints-crm.appspot.com` (видно в `outreach.generateUploadSignedUrl.fileUrl` и `outreach.lists.uploadCsvList.source.fileUrl`).
- **Firestore** — формат Timestamp `{_seconds, _nanoseconds}` в tRPC-ответах (например, `workspace.createWorkspace.result.data.createdAt`).
- **Firebase Auth** — синтетические email'ы пользователей `u{uid}@users.crmchat.ai` (видно в каждом `token`-ответе).
- **Admin SDK SA**: `firebase-adminsdk-bntbj@hints-crm.iam.gserviceaccount.com` (видно в signed-URL query).

⚠️ **Старое название проекта**: `hints-crm`. Брендинг (сайт, ручки) — `crmchat.ai`. Имя GCP-проекта не переименовывалось.

---

## 2. User

Firebase Auth пользователь; документ в Firestore хранит профиль.

### Поля (наблюдаемое)
| Поле | Тип | Откуда |
|---|---|---|
| `uid` | string | Firebase Auth; используется как `userId` повсюду |
| `email` | string | синтетический `u{uid}@users.crmchat.ai` (см. `getAccountConnectionData`) |
| `name` | string | «Вова Телеграмов» (из `workspaces.getMembers.user.name`) |
| `timezone` | string (IANA) | `Europe/Moscow` (из `workspaces.getMembers.user.timezone`) |
| `telegramUsername` | string | `vova_telegramov` (из `workspaces.getMembers.user.telegramUsername`) |

### Коллекция
⚠️ **OQ-User-1**: путь коллекции — `users/{uid}` ожидаемо, но не подтверждено прямым capture.

---

## 3. Organization

Верхний уровень биллинга / привязки воркспейсов. В coverage почти не фигурирует — нет UI-пути создания (см. US-5 OQ).

### Поля (наблюдаемое)
| Поле | Тип | Откуда |
|---|---|---|
| `id` | string | `organizationId: "HOgZBkDHwvEWuly71jdF"` в `createWorkspace.input` |
| `name` | string | edit-поле «Название организации» (US-5) |

⚠️ **OQ-Org-1**: как создаётся `organization`-документ. Нет захваченного `createOrganization` RPC.

⚠️ **OQ-Org-2**: отношение user → organization. Привязка по `ownerId`? Список `members`?

### Коллекция
Ожидается `organizations/{id}`.

---

## 4. Workspace

Core сущность — в него помещается вся CRM / outreach работа.

### Поля (наблюдаемое)
| Поле | Тип | Пример |
|---|---|---|
| `id` | string | `"zRQtzTiglfyVB5DtRm5Q"` |
| `name` | string | `"test5"` |
| `organizationId` | string | `"HOgZBkDHwvEWuly71jdF"` (FK на `organizations`) |
| `createdBy` | string (uid) | `"iNejvzobbmQxRmzPtEHD4hBxqvQ2"` |
| `createdAt` | Firestore Timestamp | `{_seconds, _nanoseconds}` |
| `updatedAt` | Firestore Timestamp | ― |

Источник: `workspace.createWorkspace` response.

### Коллекция
`workspaces/{id}`.

---

## 5. Workspace Member

### Поля (наблюдаемое)
| Поле | Тип | Значения |
|---|---|---|
| `userId` | string (uid) | FK → `users` |
| `role` | enum | **`admin`**, **`member`**, **`chatter`** (из capture + i18n: «Админ», «Участник», «Чаттер») |
| `user` | embedded | денормализованный `{name, timezone, telegramUsername}` (из ответа `workspaces.getMembers` — сервер сам джойнит) |

Источник: `workspaces.getMembers` response.

### Коллекция
⚠️ **OQ-Member-1**: `workspaces/{workspaceId}/members/{userId}` (ожидается) или отдельная top-level `workspaceMembers`. Сервер точно хранит пару `(workspaceId, userId)` — операции `changeWorkspaceMemberRole` и `removeWorkspaceMember` принимают оба.

---

## 6. Workspace Invite

### Поля (ожидаемое, не подтверждено полным capture)
| Поле | Тип | Замечание |
|---|---|---|
| `id` / `code` | string | используется в URL `/accept-invite/{workspaceId}/{inviteCode}` |
| `workspaceId` | string | FK |
| `telegramUsername` | string | кому отправили (см. `inviteWorkspaceMember.input`) |
| `role` | enum | `admin` / `member` / `chatter` |
| `createdBy` | string (uid) | ― |
| `createdAt` | Timestamp | ― |
| `expiresAt` | Timestamp | ⚠️ **OQ**: в UI pending-invites виден countdown «осталось N days» (US-4) |

### Коллекция
⚠️ **OQ-Invite-1**: путь и TTL. Если expiry серверный — вероятно, Cloud Scheduler / scheduled Cloud Function.

---

## 7. Property (кастомные поля)

Схема кастомных полей контакта. Из user-stories.md US-7:

### Поля (из UI)
| Поле | Тип | Замечание |
|---|---|---|
| `key` | string | `custom.<id>` для пользовательских; `stage` — системное (воронка) |
| `name` | string | — |
| `color` | enum | палитра из 10 значений (см. US-7) |
| `type` | enum | `text`, `single-select`, `multi-select`, возможно `number`, `date` (OQ) |
| `required` | bool | — |
| `showInList` | bool | — |
| `values` | array | для `*-select`: `[{ id, name, color }]` |
| `system` | bool | флаг «нельзя удалить» (ожидаемо) |
| `objectType` | enum | пока в URL виден только `contacts` |
| `order` | number | для drag-n-drop сортировки |

### Коллекция
⚠️ **OQ-Property-1**: в capture tRPC-запросов CRUD'а нет → прямой Firestore write. Ожидается `workspaces/{wsId}/properties/{key}` или вложенная в document воркспейса.

---

## 8. Contact (лид)

Core CRM-сущность. Прямого create/read RPC в capture нет (Firestore-подписка).

### Поля (из US-12 + capture bulk-update)
| Поле | Тип | Источник |
|---|---|---|
| `id` | string | FK повсюду |
| `workspaceId` | string | изоляция |
| `name` | string | UI label «Имя» |
| `telegramUsername` | string | UI «Имя пользователя Telegram» |
| `shortDescription`, `description` | string | UI |
| `stage` | string (property value id) | FK → `properties.stage.values` |
| `url`, `email`, `phone` | string | UI |
| `avatarUrl` | string | `contact.updateContactAvatar` существует |
| `properties` | map | `{ "custom.abc": value, ... }` (см. `outreach.updateLeadProperties.properties`) |
| `createdBy`, `createdAt`, `updatedAt` | — | стандартно |

### Коллекция
⚠️ **OQ-Contact-1**: `contacts/{workspaceId}/items/{id}` или top-level с `workspaceId`-фильтром. Нужен Firestore-sniffer capture на US-11.

---

## 9. Activity (заметки и напоминания)

### Поля (из US-15)
| Поле | Тип |
|---|---|
| `id` | string |
| `contactId` | FK |
| `workspaceId` | FK |
| `type` | enum: `note`, `reminder` |
| `text` | string (плейн / маркдаун) |
| `date` | Timestamp (только для `reminder`) |
| `repeat` | string (?) (UI «Повторять...») |
| `status` | enum: `open`, `completed` |
| `completedAt` | Timestamp? |
| `createdBy`, `createdAt` | — |

`activity.scheduleCalendarEventIfPossible({workspaceId, activityId})` — отдельный боковой эффект (Google Calendar).

### Коллекция
⚠️ **OQ-Activity-1**: `activities/{contactId}/items/{id}` vs inline в `contact`. URL `/contacts/{cid}/activities/{aid}/edit` намекает на первую.

---

## 10. Outreach · Sequence (кампания)

### Поля (из `outreach.sequences.create` + `.patch` response)
```json
{
  "id": "GADmh7QJIyXjql37nfRq",
  "workspaceId": "zRQtzTiglfyVB5DtRm5Q",
  "listId": "zsWrWrF3NF8hHFmsNyHG",     // FK → outreach lists
  "name": "csvFile.csv",
  "status": "draft",                    // draft | active | paused (из updateSequenceStatus)
  "messages": [],                       // массив step'ов (US-22)
  "accounts": {                         // привязка TG-аккаунтов (US-23)
    "mode": "selected",                 // "all" | "selected"
    "selected": []
  },
  "createdBy": "iNejvzobbmQxRmzPtEHD4hBxqvQ2",
  "createdAt": "2026-04-21T02:09:54.218Z",  // ISO (oRPC!)
  "updatedAt": "2026-04-21T02:09:54.218Z"
}
```

### Типизация sub-полей
- `messages: [{ text, delayDays, attachments?: [...] }]` — ⚠️ **OQ-Seq-1**, нужен capture с реальными сообщениями.
- **contact-settings** (из US-24): `{ createContactTrigger: "on-reply" | "on-first-send", defaultOwners: [uid, ...], defaults: { stage, "custom.xxx": ... } }` — вероятно, вложено прямо в sequence.
- **filters** (US-20, динамические): `{ property: "stage", op: "eq", value: "..." }[]` — ⚠️ **OQ-Seq-2**.

### Timestamps
⚠️ **Важно**: `sequences.create` возвращает ISO-строки, в отличие от tRPC `createWorkspace` с Firestore Timestamp. Это потому что `outreach.sequences.*` — **oRPC**, а `workspace.*` — tRPC. tRPC оставляет Firestore Timestamp как есть; oRPC сериализует в ISO. Запомни: source-of-truth в Firestore — `Timestamp`; клиент парсит обе формы.

### Коллекция
⚠️ **OQ-Seq-3**: ожидается `outreachSequences/{id}` или `workspaces/{wsId}/outreach/sequences/{id}`.

---

## 11. Outreach · List (набор получателей)

Из `outreach.lists.uploadCsvList`:

```json
{
  "id": "zsWrWrF3NF8hHFmsNyHG",
  "workspaceId": "zRQtzTiglfyVB5DtRm5Q",
  "name": "csvFile.csv",
  "status": "pending",                  // pending | ready | failed? (OQ)
  "source": {
    "type": "csvFile",                  // "csvFile" | "crm" (US-20) | "groups" (US-21a)
    "fileName": "leads.csv",
    "fileUrl": "https://firebasestorage.googleapis.com/.../leads.csv?alt=media&token=...",
    "usernameColumn": "telegram_username",
    "phoneColumn": "phone",
    "columns": ["first_name","last_name","telegram_username","phone","email","company","position","city","country","industry","deal_size","lead_source","interest_level","notes"]
  },
  "createdBy", "createdAt", "updatedAt"
}
```

Для `source.type === "crm"` ожидаем `{ filters: [...], type: "dynamic" | "oneShot" }` — ⚠️ **OQ-List-1**, нет capture.

### Коллекция
Ожидаем `outreachLists/{id}`.

---

## 12. Outreach · Lead (участник кампании)

Из `outreach.updateLeadProperties.input`:

| Поле | Пример |
|---|---|
| `leadId` | `"HsoE4LTYEOLvliySVm6j"` |
| `listId` | `"t9wsLZpHyrfxMZFLBD90"` (принадлежит списку, не sequence'у — интересно) |
| `workspaceId` | — |
| `properties` | `{}` (в captured — пусто) |

Ожидаемые поля: `status` (queued/sent/read/replied/failed), `sequenceId`, `contactId`, `messagesSent: [{msgId, sentAt, readAt, repliedAt}]`, CSV-поля (`first_name`, ...).

### Коллекция
⚠️ **OQ-Lead-1**: `outreachLeads/{id}` с индексами по `listId` / `sequenceId` / `workspaceId` — более вероятно, чем вложение в sequence, потому что leads — тяжёлая коллекция с частыми записями.

---

## 13. Telegram · Personal sync session (US-9)

Из `telegram.account.getAccountConnectionData.response`:

```json
{
  "session": {
    "mainDcId": 2,
    "isTest": false,
    "keys":  { "2": "5bca5c8b...<256 hex>" },
    "hashes": { "2": "53862b27...<40 hex>" }
  },
  "authParams": "{workspaceId}::{tokenA}::{tokenB}"
}
```

Это MTProto auth-key + hash per DC. Сервер хранит → отдаёт клиенту (либо сам проксирует через gramjs).

### Коллекция
⚠️ **OQ-TGSync-1**: путь коллекции. Учитывая, что `authParams` содержит `workspaceId` — возможно, `workspaces/{wsId}/telegramClients/{userId}`.

### Privacy-обещание UI
«Зашифрованный токен сессии» (US-9). Но `keys` мы видим **в открытом виде в HTTP-ответе** — значит, на клиенте он в памяти в plain. «Зашифрованный» относится к хранению на сервере (или at-rest).

---

## 14. Telegram · Outreach account (US-17)

Для рассылок. Ручки: `telegram.account.auth`, `updateAccount`, `moveAccounts`.

### Поля (ожидаемое)
| Поле | Тип |
|---|---|
| `id` | string |
| `workspaceId` | FK |
| `phoneNumber` | string |
| `status` | enum: `active`, `unauthorized`, `banned`? |
| `proxyCountryCode` | enum (см. §15) |
| `warmupEnabled` | bool |
| `dailyLimit` | number |
| `autoCreateLeads` | bool |
| MTProto session | как в §13 |

### Коллекция
⚠️ **OQ-TGAcc-1**: `workspaces/{wsId}/telegramAccounts/{id}` ожидается.

---

## 15. Proxy

Из `proxy.getCountries`:
```json
[
  { "countryCode": "au", "name": "Австралия" },
  { "countryCode": "gb", "name": "Великобритания" },
  { "countryCode": "de", "name": "Германия" },
  { "countryCode": "ca", "name": "Канада" },
  { "countryCode": "nl", "name": "Нидерланды" },
  { "countryCode": "ru", "name": "Россия" },
  { "countryCode": "sg", "name": "Сингапур" },
  { "countryCode": "us", "name": "Соединенные Штаты" },
  { "countryCode": "fr", "name": "Франция" },
  { "countryCode": "jp", "name": "Япония" }
]
```

Из `proxy.getProxyStatus.data`:
```json
{ "active": true, "countryCode": "ru", "countryName": "Россия" }
```

Per-workspace или per-account — ⚠️ **OQ-Proxy-1**.

---

## 16. Storage (Firebase Storage)

Bucket: `hints-crm.appspot.com`.

### Пути (наблюдаемое)
| Назначение | Путь |
|---|---|
| CSV leads | `w/{workspaceId}/outreach/leads/{fileId}.csv` |
| Медиа/вложения | `w/{workspaceId}/outreach/media/{fileId}.{ext}` |

Flow:
1. `outreach.generateUploadSignedUrl({ workspaceId, fileName, mimeType, type, public })` → `{ signedUrl, filePath, fileUrl, headers }`.
2. Клиент делает PUT по `signedUrl` (TTL из query: `X-Goog-Expires=1800` — 30 минут).
3. Дальше `outreach.lists.uploadCsvList` / другой RPC ссылается на `fileUrl` или `filePath`.

⚠️ **OQ-Storage-1**: где хранятся avatar'ы (`contact.updateContactAvatar`), вложения сообщений в чате.

---

## 17. Integrations (сторонние)

| Интеграция | Где используется | RPC |
|---|---|---|
| **Cello** (viral/referral platform) | эмбед в UI, скорее всего «Поделиться / Получить бонус» | `cello.getInitOptions` |
| **Google Calendar** | активности с датой (US-15) | `googleCalendar.getAccount`, `activity.scheduleCalendarEventIfPossible` |
| **Telegram (MTProto)** | прямое подключение пользовательских аккаунтов | `telegram.client.*`, `telegram.account.*` |
| **Telegram Bot API** | доставка invite-ссылок (US-2), вероятно push-уведомлений | ⚠️ **OQ**, не captured |
| **PostHog** | аналитика (видны `token`, `productId` в каждом integration-ответе) | подписчик backend-side |
| **Stripe / биллинг** | подписки (out of scope ТЗ) | ⚠️ **OQ** — не в captured scope |

---

## 18. Timestamps — два формата

Важный impl-нюанс: сервер отдаёт timestamps в **двух форматах**, зависит от API-слоя.

| API-слой | Формат |
|---|---|
| tRPC (`workspace.*`, `contact.*`, `telegram.*`) | `{ "_seconds": 1776778421, "_nanoseconds": 91000000 }` (Firestore Timestamp proto) |
| oRPC (`workspaces.*`, `outreach.sequences.*`) | ISO 8601 строка `"2026-04-21T02:09:54.218Z"` |

Клиентский код должен обрабатывать оба. Source-of-truth в Firestore — Timestamp; сериализация отличается.

---

## 19. ID-формат

Все `id` — 20 символов `[A-Za-z0-9]`, выглядят как **Firestore autoID** (`doc().id`). Примеры:
- `zRQtzTiglfyVB5DtRm5Q` (workspaceId)
- `HOgZBkDHwvEWuly71jdF` (organizationId)
- `GADmh7QJIyXjql37nfRq` (sequenceId)
- `iNejvzobbmQxRmzPtEHD4hBxqvQ2` (uid — 28 chars, **Firebase Auth uid**, отличается)

---

## 20. Что не хватает для полной схемы (priority OQs)

1. **Firestore-capture** — все CRUD'ы по Contact, Property, Activity, View идут через Firestore subscription/write напрямую, минуя tRPC. Пока мы их не перехватим, схема этих коллекций — экспертное угадывание.
2. **Invite TTL** — механизм expiry (Cloud Function? TTL-policy?).
3. **Outreach lead status lifecycle** — переходы `queued → sent → read → replied/failed`, где они хранятся.
4. **Paywall schema** — `subscriptions`, `plans`, `usageCounters` — сознательно вне scope ТЗ, но для реимплементации обязательны.
5. **Security rules** — без `firestore.rules` невозможно гарантировать workspace isolation.
