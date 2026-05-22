# Permissions

Модель ролей и авторизации. Вся проверка — на сервере в middleware; клиентские дизейблы кнопок — чистый UX.

---

## 1. Роли воркспейса

Две роли, хранятся в `workspace_members.role` (enum `workspace_role`):

| key | UI label | Назначение |
|---|---|---|
| `admin` | **Админ** | управление командой и workspace'ом |
| `member` | **Участник** | полноценная работа с данными, не управляет командой |

Owner как отдельная роль не выделяется. Создатель workspace'а получает `role = admin`; единственность гарантируется бизнес-правилом «последнего админа нельзя понизить/удалить, можно только удалить весь workspace» (проверяется в middleware).

Роль `chatter` (только чат + чтение контактов) была у донора, **у нас не реализована** — внутренний CRM Yandex'а не имеет юзкейса «саппорт без доступа к воронке». См. `DECISIONS.md`.

---

## 2. Матрица возможностей

| Возможность | `admin` | `member` |
|---|:-:|:-:|
| **Workspace** | | |
| Создать новый воркспейс | ✅ | ✅ |
| Переименовать текущий | ✅ | ❌ |
| Удалить воркспейс | ✅ | ❌ |
| **Members** | | |
| Пригласить нового | ✅ | ❌ |
| Сменить роль другого | ✅ | ❌ |
| Удалить другого | ✅ | ❌ |
| Покинуть воркспейс (self) | ✅* | ✅ |
| **Properties** | | |
| Читать | ✅ | ✅ |
| Создавать/редактировать | ✅ | ✅ |
| Удалить system-поле | ❌ | ❌ |
| **Contacts** | | |
| Читать | ✅ | ✅ |
| Создавать/редактировать | ✅ | ✅ |
| Массовое удаление | ✅ | ❌ |
| **Chat** | | |
| Видеть все чаты workspace'а | ✅ | ✅ |
| Отвечать в чатах | ✅ | ✅ |
| **Outreach** | | |
| Подключить TG-аккаунт | ✅ | ❌ |
| Настроить аккаунт (лимиты, прокси) | ✅ | ❌ |
| Создать / редактировать / удалить кампанию | ✅ | ✅ |
| Start / pause / resume / complete / archive | ✅ | ✅ |
| Создать / редактировать / удалить папку (track) | ✅ | ✅ |
| Переместить аккаунты между WS | ✅ | ❌ |
| **Settings** | | |
| Глобальное расписание отправок | ✅ | ❌ |
| API-keys (create/revoke) | ✅ | ❌ |

✅* — admin может покинуть, только если в workspace'е остаётся ещё хотя бы один admin. Если admin единственный — endpoint `DELETE .../members/me` отвечает **409 Conflict**: либо повысить кого-то до `admin`, либо явно удалить workspace через `DELETE /v1/workspaces/{wsId}`.

---

## 3. Видимость данных внутри workspace'а

> Раньше принцип был «workspace = security boundary, member видит всё». После
> встречи 05.05.2026 (см. `product.md`) для multi-team воркспейсов это стало
> дырой — менеджер видел чужие воронки и вёл бы лиды коллеги. Сейчас:
> **admin видит всё в workspace, member — только то, что связано с его
> outreach-аккаунтами.** Реализовано в `apps/api/src/lib/*-access.ts`.

### Admin

Видит всё в workspace без фильтра, как было раньше.

### Member

Видит подмножество, выводимое из множества «мои аккаунты»:
- `M(user) = { outreach_accounts.id : owner_user_id = user OR
              EXISTS активная outreach_account_delegations(account, user) }`.

Затем:
- **outreach_accounts**: row из M(user). Helper `accountAccessClause`.
- **contacts**: `primary_account_id ∈ M(user)` ИЛИ
  `EXISTS (tg_chats c WHERE c.peer_user_id = contact.tg_user_id AND
   c.account_id ∈ M(user))` — sticky на меня или хоть когда-то DM через
   мой аккаунт. Helper `contactAccessClause`.
- **channels**: `EXISTS (channel_admins ca, contacts c
  WHERE ca.channel_id = channels.id AND c.id = ca.contact_id AND
  c доступен member'у по правилу выше)`. Helper `channelAccessClause`.
- **outreach_sequences (задачи)**: `accounts_mode = 'selected' AND
  accounts_selected ∩ M(user) ≠ ∅` ИЛИ `accounts_mode = 'all' AND
  M(user) ≠ ∅`. Helper `sequenceAccessClause`.
- **outreach_lists**: лист виден member'у, если есть видимая ему задача
  на этот лист. Inline-clause в `routes/outreach-lists.ts`.
- **activities**: через `contactAccessClause` родителя.

### Намеренные исключения

- **«Кто общался» в правой панели контакта** показывает ВСЕ outreach-аккаунты,
  у которых был DM с этим контактом, включая чужие. Член видит, что коллега
  уже общался — чтобы не дублировать «привет, мы про X писали».
- **`/contacts/:id/chat-history?accountId=X`** не валидирует accountId
  доступом — если контакт виден, история коллеги через любой аккаунт
  тоже открыта. TDLib-инстансы все живут в одном `apps/api` процессе,
  это просто отсутствие второго `assertAccountAccess`.
- **SSE-стримы** (`/contact-stream`, `/outreach/sequences/:seqId/stream`)
  открывают канал по проверке access на старте, но события внутри —
  broadcast по wsId/seqId; member может увидеть ID/счётчик чужого
  контакта в DevTools, но GET вернёт 404. Если станет проблемой —
  фильтровать в subscribe-callback'е.

### Личный TG в `telegram_accounts`

Личный sync-аккаунт (импорт чатов в CRM, US-7) у юзера один и привязан к
user_id, не к workspace'у. Сообщения из него попадают в общий пул контактов
workspace'а; при приглашении в чужой ws предупреждаем:

> «Члены команды в этом рабочем пространстве увидят ваши чаты Telegram,
> если вы подключите личный аккаунт.»

Granular per-chat ACL не делаем — если нужна приватность, заводится
отдельный workspace.

---

## 4. Workspace isolation

В каждой доменной таблице есть `workspace_id` (см. `data-model.md`). Все выборки фильтруются по нему.

Приёмы:
- **Обязательный параметр пути** `/v1/workspaces/{wsId}/...` — `wsId` проходит через middleware `assertMember` до handler'а.
- **Queries без `workspace_id`** запрещены code-review'ом. Helper `db.forWorkspace(wsId)` возвращает scoped-клиент, который авто-подставляет `where workspace_id = $1` — пишем обычный Drizzle-код, но защищены от забытого фильтра.
- **Cross-workspace операции** (перемещение TG-аккаунтов, US-19) явно требуют два `assertMember` — source и target — плюс `assertRole(target, 'admin')`.

---

## 5. Middleware

### `requireSession`
На всех `/v1/*`. Читает `sid` cookie или `Authorization: Bearer`/`X-API-Key`. Кладёт в контекст:
- либо `{ userId, sessionId }` — если cookie-сессия;
- либо `{ apiKeyId, workspaceId, scopes }` — если API-key.

Нет ни того, ни другого → **401**.

### `assertMember(workspaceId)`
Требует cookie-сессию или API-key со `scope === workspaceId`. Для user-сессии делает:

```sql
SELECT role FROM workspace_members
WHERE workspace_id = $1 AND user_id = $2
```

Нет строки → **403**. Есть → кладёт `role` в контекст.

### `assertRole(workspaceId, 'admin')`
Вызывается сверху `assertMember`. Если `ctx.role !== 'admin'` → **403**.

Для API-key'ев роль выводится из scopes: по умолчанию API-key эквивалентен `admin` workspace'а (создаётся только админом). Если будущие scopes сузят — добавляется проверка scopes здесь же.

### Пример handler'а

```ts
app.openapi(inviteRoute, async (c) => {
  await assertMember(c, wsId);
  await assertRole(c, wsId, 'admin');
  const { telegramUsername, role } = c.req.valid('json');
  // ... бизнес-логика
});
```

Helper'ы `assertMember` / `assertRole` — единственное место, где живёт SQL для проверки доступа. Все handler'ы их используют.

---

## 6. Client-side UI gates

В `@repo/ui` хук `useRole(wsId)` возвращает текущую роль. Компоненты дизейблят кнопки:

```tsx
<Button disabled={role !== 'admin'} onClick={...}>Удалить</Button>
```

Это чистый UX: кнопка не мигает «клик → 403». Но сервер всё равно проверяет — клиент может быть подменён.

---

## 7. API-keys

Отдельный канал для внешних интеграций (`auth.md` §API-keys). Поведенческие правила:

- Scope — `workspace_id`. Ключ одного workspace'а не получит доступ к другому.
- В `audit_log` мутация от API-key пишется с `api_key_id` вместо `user_id`.
- По умолчанию rate-limit строже, чем у UI (отдельный bucket).
- Создание / revoke — только admin (см. матрицу).

---

## 8. Критерии приёмки

- [ ] Запрос без cookie и без API-key на любой `/v1/*` → **401**.
- [ ] Member workspace'а A не может прочитать контакт workspace'а B → **403**.
- [ ] `member` не может пригласить нового участника → **403**, кнопка «Пригласить» в UI скрыта.
- [ ] `admin` не может покинуть workspace, если он единственный admin → **409 Conflict** с подсказкой «повысьте кого-то до admin или удалите workspace».
- [ ] API-key workspace'а A на `POST /v1/workspaces/B/contacts` → **403**.
- [ ] Revoked API-key → **401**.
