---
story: US-2
title: Пригласить коллегу
stage: 1 (Onboarding)
coverage:
  routes:
    - ProtectedWWorkspaceIdSettingsWorkspaceInviteRouteImport  # /w/{id}/settings/workspace/invite
  rpc:
    - workspace.inviteWorkspaceMember
  firestore: []
  postmessage: []
  ui_strings:
    - web.workspace.invite.telegramUsernameLabel
    - web.workspace.invite.telegramUsernameDescription
    - web.workspace.invite.telegramUsernamePlaceholder
    - web.workspace.invite.roleLabel
    - web.workspace.invite.chatsWarning
    - web.workspace.invite.inviteButton
    - web.workspace.invite.successToast
    - web.role.admin
    - web.role.member
    - web.common.error.shouldNotEmpty
---

# US-2 · Пригласить коллегу

**Предусловие**: аутентифицирован (см. [`auth.md`](./auth.md)), находится внутри воркспейса.

## Цель
Добавить в воркспейс ещё одного пользователя по его Telegram-username, с заданной ролью.

## Точка входа
- Сайдбар → **«Команда»** (`/w/{id}/settings/workspace`) → кнопка **«Пригласить члена команды»** → `/w/{id}/settings/workspace/invite`.
- Прямого URL вне сюжета "Команда" нет.

## Форма

| Поле | Label | Placeholder | Описание | Валидация |
|---|---|---|---|---|
| `telegramUsername` | **«Имя пользователя Telegram»** | — | — | trim + non-empty («Поле не должно быть пустым») |
| `role` | **«Роль»** | — | combobox | enum `WorkspaceRoleSchema`: **`member` / `admin`** (отображаются как «Участник», «Админ»); default `member`. Роль `chatter` есть у донора, у нас не реализована — см. `DECISIONS.md` |

**Условный warning-alert** над формой — только если в воркспейсе уже подключён хотя бы один TG-аккаунт: **«⚠️ Члены команды в этом рабочем пространстве увидят ваши чаты Telegram»**.

Submit-кнопка: **«Пригласить»** (`web.workspace.invite.inviteButton`).

## Что вызывается
- `workspace.inviteWorkspaceMember` — input `{ telegramUsername, role, workspaceId }`, output `{ success: true }`.

Сигнатуры — см. [`api-contracts.md`](./api-contracts.md).

> Примечание: destination `/settings/workspace` на бутстрэпе дёргает `workspace.getPendingInvites` и `workspaces.getMembers`, чтобы отрисовать раздел "Ожидающие приглашения". Эти вызовы принадлежат US-4, не этой стори.

## Success-flow
1. Мутация успешна → ответ `{ success: true }`.
2. `navigateBack()` (fallback: `/w/{id}/settings/workspace`) — возврат на страницу команды.
3. Toast: **«Пользователь успешно приглашен»**.

## Error-flow
Любой `TRPCClientError` → `toast.error(err.message)`. Форма остаётся открытой. Частые ошибки сервера (не зафиксированы в capture, см. OQ-2): несуществующий username, пользователь уже член воркспейса, rate-limit.

## Скриншоты

**Пустая форма** (есть TG-аккаунт → виден chatsWarning):

![Форма приглашения с warning](_screenshots/ProtectedWWorkspaceIdSettingsWorkspaceInviteRouteImport/1776737916290_nav+500.png)

**После нажатия «Пригласить»** (settle):

![Settle после инвайта](_screenshots/ProtectedWWorkspaceIdSettingsWorkspaceInviteRouteImport/1776737929674_response-settle.png)

## Открытые вопросы
- ~~**OQ-1**: есть ли роль `observer`~~ — закрыт. У нас две роли (`admin` / `member`), `chatter` донора не берём, см. `DECISIONS.md`.
- **OQ-2**: коды ошибок `inviteWorkspaceMember` (несуществующий username, дубликат, rate-limit). Нужен негативный capture.

## Критерии приёмки
- [ ] Пустой `telegramUsername` блокирует submit.
- [ ] При наличии TG-аккаунтов в воркспейсе показан chatsWarning; без них — нет.
- [ ] Успешный invite: ровно один `POST /trpc/workspace.inviteWorkspaceMember`, возврат на `/settings/workspace`, toast один раз.
- [ ] Ошибка сервера показывается как toast, форма остаётся доступной.
