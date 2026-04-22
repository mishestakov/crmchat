---
story: US-4
title: Управлять участником
stage: 2 (Team)
coverage:
  routes:
    - ProtectedWWorkspaceIdSettingsWorkspaceIndexRouteImport        # /w/{id}/settings/workspace (список членов + pending invites)
    - ProtectedWWorkspaceIdSettingsWorkspaceUserUserIdRouteImport   # /w/{id}/settings/workspace/user/{userId}
  rpc:
    - workspaces.getMembers
    - workspace.getPendingInvites
    - workspace.changeWorkspaceMemberRole
    - workspace.removeWorkspaceMember
  firestore: []
  postmessage: []
  ui_strings:
    - web.workspace.members.title
    - web.workspace.members.pendingInvitesTitle
    - web.workspace.members.daysLeft
    - web.workspace.user.timezoneLabel
    - web.workspace.user.roleLabel
    - web.workspace.user.cannotChangeOwnRole
    - web.workspace.user.leaveButton
    - web.workspace.user.removeButton
    - web.role.admin
    - web.role.member
    - web.role.chatter
---

# US-4 · Управлять участником

**Предусловие**: аутентифицирован (см. [`auth.md`](./auth.md)), находится внутри воркспейса, в нём есть хотя бы один другой участник.

## Цель
Посмотреть состав команды, изменить роль участника, удалить его, либо покинуть воркспейс самому.

## Точка входа
Сайдбар → **«Команда»** (`/w/{id}/settings/workspace`) → клик по участнику в списке → `/w/{id}/settings/workspace/user/{userId}`.

## Что показано

### На экране «Команда» (`/settings/workspace`)
Бутстрэп дёргает:
- `workspaces.getMembers` — список активных членов воркспейса.
- `workspace.getPendingInvites` — раздел **«Ожидающие приглашения»**, у каждого подпись **«осталось N days»**.

Плюс inline-поле rename воркспейса (см. [US-5 · 5.2](./US-5.md)) и кнопка **«Пригласить члена команды»** (см. [US-2](./US-2.md)).

### На карточке участника (`/settings/workspace/user/{userId}`)
- **Часовой пояс** (пример: `Europe/Moscow`) — только для просмотра.
- **Роль** — combobox (`member` / `admin` / `chatter`).
- Кнопка **«Покинуть рабочее пространство»** — если открыта карточка текущего пользователя.
- Кнопка **«Удалить»** — если открыта карточка другого участника.

Ограничение UI: над комбо-боксом строка **«Вы не можете изменить свою собственную роль»** — для своей карточки роль задизейблена.

## Что вызывается
- `workspace.changeWorkspaceMemberRole` — input `{ workspaceId, userId, role }`, output `{}`.
- `workspace.removeWorkspaceMember` — input `{ workspaceId, userId }`, output `{}`. Та же ручка используется и для «Удалить другого», и для «Покинуть» (в последнем случае `userId` = свой).

Сигнатуры — см. [`api-contracts.md`](./api-contracts.md).

## Success-flow

**Смена роли:**
1. Выбрать в combobox новую роль → мутация летит сразу, без отдельной кнопки Save.
2. `workspaces.getMembers` инвалидируется → список обновляется.

**Удалить другого:**
1. Кнопка «Удалить» → мутация.
2. Редирект на `/w/{id}/settings/workspace`, участник пропал из списка.

**Покинуть (сам):**
1. Кнопка «Покинуть рабочее пространство» → мутация.
2. Текущий воркспейс недоступен → редирект на `/w/{otherId}` или на форму создания (см. US-1), если других нет. См. [OQ-2](#открытые-вопросы).

## Error-flow
Любой `TRPCClientError` → `toast.error(err.message)`. UI откатывается к предыдущему состоянию.

## Скриншоты

**Экран команды** (список + pending invites):

![Команда](_screenshots/ProtectedWWorkspaceIdSettingsWorkspaceIndexRouteImport/1776737891198_nav+500.png)

**Карточка участника:**

![Карточка участника](_screenshots/ProtectedWWorkspaceIdSettingsWorkspaceUserUserIdRouteImport/1776737903978_nav+500.png)

## Открытые вопросы
- **OQ-1**: может ли `admin` удалить другого `admin`'а или только `owner`? Роли `owner` в captured enum'е нет — нужно проверить `WorkspaceRoleSchema` в `@repo/core`.
- **OQ-2**: куда редиректит после «Покинуть», если это был единственный воркспейс? Ожидаем форму US-1, но в capture не зафиксировано.
- **OQ-3**: есть ли confirm-диалог на «Удалить» / «Покинуть»? В capture клик → мутация без промежуточного шага, но модалка могла быть проскочена.

## Критерии приёмки
- [ ] На `/settings/workspace` виден список членов и раздел «Ожидающие приглашения» с countdown'ом.
- [ ] В карточке своего пользователя роль задизейблена, показан hint «Вы не можете изменить свою собственную роль».
- [ ] Смена роли: ровно один `POST /trpc/workspace.changeWorkspaceMemberRole`, список инвалидируется.
- [ ] Удаление другого: ровно один `POST /trpc/workspace.removeWorkspaceMember`, редирект на `/settings/workspace`.
- [ ] «Покинуть» для себя: ровно один `POST /trpc/workspace.removeWorkspaceMember` с `userId` = текущий, корректный редирект (см. OQ-2).
- [ ] Ошибка сервера показывается как toast, состояние UI откатывается.
