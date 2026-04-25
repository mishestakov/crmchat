# Permissions

Модель ролей и авторизации. Вся проверка — на сервере в middleware; клиентские дизейблы кнопок — чистый UX.

---

## 1. Роли воркспейса

Три роли, хранятся в `workspace_members.role` (enum `workspace_role`):

| key | UI label | Назначение |
|---|---|---|
| `admin` | **Админ** | полный контроль над workspace'ом |
| `member` | **Участник** | полноценная работа с данными, не управляет командой |
| `chatter` | **Чаттер** | только чат + чтение контактов |

Owner как отдельная роль не выделяется. Создатель workspace'а получает `role = admin`; единственность гарантируется бизнес-правилом «последнего админа нельзя понизить/удалить» (проверяется в middleware).

---

## 2. Admin vs member

Member — рабочая роль по умолчанию: читает и редактирует всё в workspace'е (контакты, properties, пайплайны, чаты), создаёт и ведёт outreach-кампании, отвечает клиентам. Этого хватает на 95% повседневных задач.

Admin делает всё то же плюс управляет **конфигурацией workspace'а и командой**. Конкретно то, чего member не может:

- переименовать и удалить workspace;
- пригласить нового участника, сменить ему роль, удалить из команды;
- подключить Telegram-аккаунт к outreach, задать его лимиты/прокси, переместить между workspace'ами;
- удалить кампанию (создать / start / pause — может и member);
- настроить дефолтных владельцев лидов в sequence (round-robin по команде);
- массово удалить контакты;
- изменить глобальное расписание отправок workspace'а;
- создать или отозвать API-ключ.

В workspace'е всегда должен остаться минимум один admin: последний admin не может ни понизить себя в member, ни выйти из workspace'а — `409 Conflict` с явным сообщением.

### Детальная матрица

| Возможность | `admin` | `member` | `chatter` |
|---|:-:|:-:|:-:|
| **Workspace** | | | |
| Создать новый воркспейс | ✅ | ✅ | ✅ |
| Переименовать текущий | ✅ | ❌ | ❌ |
| Удалить воркспейс | ✅ | ❌ | ❌ |
| **Members** | | | |
| Пригласить нового | ✅ | ❌ | ❌ |
| Сменить роль другого | ✅ | ❌ | ❌ |
| Удалить другого | ✅ | ❌ | ❌ |
| Покинуть воркспейс (self) | ✅* | ✅ | ✅ |
| **Properties** | | | |
| Читать | ✅ | ✅ | ✅ |
| Создавать/редактировать | ✅ | ✅ | ❌ |
| Удалить system-поле | ❌ | ❌ | ❌ |
| **Contacts** | | | |
| Читать | ✅ | ✅ | ✅ |
| Создавать/редактировать | ✅ | ✅ | ❌ |
| Массовое удаление | ✅ | ❌ | ❌ |
| **Chat** | | | |
| Видеть все чаты workspace'а | ✅ | ✅ | ✅ |
| Отвечать в чатах | ✅ | ✅ | ✅ |
| **Outreach** | | | |
| Подключить TG-аккаунт | ✅ | ❌ | ❌ |
| Настроить аккаунт (лимиты, прокси) | ✅ | ❌ | ❌ |
| Создать кампанию | ✅ | ✅ | ❌ |
| Start / pause кампанию | ✅ | ✅ | ❌ |
| Удалить кампанию | ✅ | ❌ | ❌ |
| Переместить аккаунты между WS | ✅ | ❌ | ❌ |
| **Settings** | | | |
| Глобальное расписание отправок | ✅ | ❌ | ❌ |
| API-keys (create/revoke) | ✅ | ❌ | ❌ |

✅* — admin может покинуть только если в workspace'е остаётся ещё хотя бы один admin.

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
- [ ] `chatter` не может создать кампанию → **403**, кнопка «Создать кампанию» в UI дизейблена.
- [ ] `admin` не может покинуть workspace, если он единственный admin → **409 Conflict** с явным сообщением.
- [ ] API-key workspace'а A на `POST /v1/workspaces/B/contacts` → **403**.
- [ ] Revoked API-key → **401**.

---

## Appendix A. Что в доноре (app.crmchat.ai)

Реверс-инжиниринг `reconstructed/` (web-клиент) и `telegram/crmchat-fork-vs-60aaf900.patch` (форк telegram-web). Это **не спека** — это карта исходника. В нашей версии роль enforced на сервере; здесь фиксируем, как автор донора реально разводил поведение по ролям, чтобы наша целевая модель была осознанной, а не карго-культом.

### A.1. Enum ролей

`reconstructed/packages/core/src/types/workspace.ts:65`:
```ts
WorkspaceRoleSchema = z.enum(["admin", "member", "chatter"])
```
Совпадает с нашим. `OrganizationMember` / org-level role в доноре **нет** — `admin` это админ конкретного workspace, не всей организации.

### A.2. UI-gates в reconstructed — полный список

Во всём клиенте поведенческих role-check'ов **ровно 4**. Остальные совпадения `role` — i18n-лейблы без поведения.

1. `routes/.../settings/workspace/index.split-component.tsx:89`
   `workspaceRole === "admin"` → показывается пункт «Пригласить в workspace».
2. `routes/.../settings/workspace/user.$userId.split-component.tsx:107`
   `isMe || workspaceRole === "admin"` → показывается блок «Remove / Leave». Non-admin может только «выйти сам».
3. `routes/.../settings/workspace/user.$userId.split-component.tsx:161`
   `disabled={isMe || workspaceRole !== "admin"}` → combobox смены роли доступен только admin, и он не может менять свою.
4. `features/outreach/chat/chat-iframe.tsx:268`
   В URL iframe telegram-клиента подставляется `p=${workspaceRole === "chatter" ? "0" : "1"}` — см. A.4.

В features contacts/outreach/sequences/views проверок роли **нет вообще**. Различий admin↔member в UI донора, кроме invite/remove/changeRole, **не существует**. Наша матрица (§2) — это целевое расширение, а не воспроизведение.

Серверной авторизации донора мы не видим (Firestore security rules / cloud functions — вне `reconstructed/`). Поэтому сказать, что реально делал бэкенд донора — нельзя. Наша спека (§5) явно делает server-side enforce единственным источником истины.

### A.3. Видимость workspace'ов

`reconstructed/src/lib/db/workspaces.ts:21-33` — `subscribeToUserWorkspaces`:
```ts
query(
  refs.workspaces(),
  where("members" satisfies keyof Workspace, "array-contains", userId),
  orderBy("name", "asc")
)
```

Клиент подписывается на Firestore с фильтром «`members` array-contains userId». Workspace'ы, где юзера нет в `members`, не приходят вообще — их нет ни в `workspacesById`, ни в `workspacesByOrganizationId`. Т.е. member/chatter видит только те WS, куда его позвали. Admin одного WS не видит соседние WS той же организации, если он не в их `members`.

Это match'ится с нашим §4 (workspace isolation), только у нас enforce через `assertMember` в API, а у донора — через фильтр Firestore-подписки.

### A.4. Флаг `p` в telegram-клиенте-форке

Телеграм-клиент — отдельный бандл (форк `tdesktop-webk`), грузится в iframe из `VITE_TELEGRAM_CLIENT_URL`. Для chatter хост передаёт `p=0`, для admin/member — `p=1`.

`telegram/crmchat-fork-vs-60aaf900.patch` → `src/util/crmchat.ts:642`:
```ts
const isChatter = urlParams.get('p') === '0';

export const CAN_DELETE_CHAT           = !isChatter;
export const CAN_DELETE_MESSAGES       = !isChatter;
export const CAN_ACCESS_SETTINGS       = !isChatter;
export const CAN_ACCESS_SERVICE_NOTIFICATIONS = !isChatter;
export const CAN_BLOCK_CONTACT         = !isChatter;
export const CAN_MUTE_CHAT             = !isChatter;
```

Реально используются **3 из 6** (остальные — объявлены, но нигде не читаются):

| Флаг | Use-site | Эффект при `p=0` |
|---|---|---|
| `CAN_DELETE_MESSAGES` | `src/global/selectors/messages.ts:613` | селектор `canDelete` всегда `false` → пропадают пункты «Delete message» во всех меню (и своих, и чужих сообщений) |
| `CAN_ACCESS_SETTINGS` | `src/global/actions/ui/settings.ts:167` | хендлер `requestSettings` перехватывается и возвращает в chat list — открыть Settings telegram-клиента невозможно никаким путём |
| `CAN_ACCESS_SERVICE_NOTIFICATIONS` | `src/util/notifications.tsx:413` | браузерные push-уведомления от `777000` (системный чат Telegram) подавляются; сами сообщения в чате видны |
| `CAN_DELETE_CHAT`, `CAN_BLOCK_CONTACT`, `CAN_MUTE_CHAT` | — | мёртвые экспорты, ни в патче, ни в `results/fork-modified.json` не используются |

Остальной функционал (отправка, чтение, реакции, поиск, аватарки) у chatter **работает как у member**. Никаких ограничений на отправку сообщений в патче нет.

### A.5. Публичная документация донора

Источники: help-center, llms.txt, changelog (Aug 2025 – Feb 2026), страницы продукта. Код донора — абсолютный приоритет; дока учитывается только там, где не противоречит коду.

**Видимые публично факты:**
- В invite-форме и в llms.txt фигурируют **только две роли**: Member и Admin. Роль `chatter` **не документирована нигде**, но присутствует в коде (enum + UI-gates §A.2 + `p=0` в telegram-форке §A.4).
- Инвайт идёт по telegram-username; приглашённый обязан начать диалог с CRMChat-ботом, иначе инвайт не активируется.
- Тариф Team — 3 пользователя, +$10/мес за каждого сверху.
- Матрицы «кто что может» публично нет. Есть один конкретный admin-only пункт (см. ниже).

**Единственное явное role-ограничение в changelog:**

> *workspace admins* теперь могут установить дефолтных владельцев лидов в настройках последовательности (round-robin).

При этом клиентский файл `routes/.../sequences/$id.contact-settings.owners.split-component.tsx` **не содержит role-check'а** — ни `disabled`, ни условного рендера. Значит либо это server-side gate, которого в `reconstructed/` не видно (бэкенд у нас отсутствует), либо формулировка маркетинговая. Для нас это сигнал: наш API для `PATCH /sequences/:id {contactOwnerSettings}` должен быть **admin-only на сервере**, даже если клиент это не подсвечивает (и, вероятно, нам стоит добавить клиентский `disabled` — §6).

### A.6. Следствия для нашей реализации

- **Chatter** у донора — не «read-only оператор», как можно подумать по названию. По коду это **member без Settings телеграма, без удаления сообщений и без системных push'ей**. Всё. Наша §2 трактует chatter шире (нет create/edit контактов, нет create-кампании) — это осознанное расширение.
- **Публично** chatter вообще не существует. Можно рассмотреть вариант не экспонировать эту роль наружу на первом этапе, оставив только admin/member — меньше объяснять, меньше поддерживать.
- Поведенческая разница admin↔member в UI донора — только управление командой. Настройки sequence owners (§A.5) и всё остальное в §2 — наше расширение, за которое отвечает **только сервер**. Клиентские `disabled`-гейты дублируют его для UX.
- Если сохраняем совместимость с форком telegram-клиента донора (передача `p=0/1`) — учитываем только 3 живых флага из §A.4; остальные 3 экспорта ничего не ограничивают до правок в форке.
