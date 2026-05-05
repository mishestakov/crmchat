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
| Создать кампанию | ✅ | ✅ |
| Start / pause кампанию | ✅ | ✅ |
| Удалить кампанию | ✅ | ❌ |
| Переместить аккаунты между WS | ✅ | ❌ |
| **Settings** | | |
| Глобальное расписание отправок | ✅ | ❌ |
| API-keys (create/revoke) | ✅ | ❌ |

✅* — admin может покинуть, только если в workspace'е остаётся ещё хотя бы один admin. Если admin единственный — endpoint `DELETE .../members/me` отвечает **409 Conflict**: либо повысить кого-то до `admin`, либо явно удалить workspace через `DELETE /v1/workspaces/{wsId}`.

---

## 3. Privacy между членами команды

Принцип: **workspace — security boundary, не user.** Любой member видит:
- все контакты воркспейса;
- все сообщения всех подключённых TG-аккаунтов (outreach и personal sync);
- все кампании, списки, файлы.

При приглашении нового участника на экране приглашения висит явное предупреждение:

> «Члены команды в этом рабочем пространстве увидят ваши чаты Telegram, если вы подключите личный аккаунт.»

Это — продуктовое решение: granular per-chat ACL не делаем. Если нужна приватность — заводится отдельный workspace.

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
