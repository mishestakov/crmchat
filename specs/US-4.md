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
- **Роль** — combobox (`member` / `admin`). Роль `chatter` донора у нас не реализована (см. `DECISIONS.md`).
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
2. Если ты единственный admin — сервер отвечает **409 Conflict** с подсказкой «повысьте кого-то до admin или удалите workspace». UI показывает toast + остаётся на странице. См. `permissions.md`.
3. Иначе — текущий воркспейс недоступен → редирект на `/w/{otherId}` или на форму создания (см. US-1), если других нет. См. [OQ-2](#открытые-вопросы).

**Удалить workspace целиком (admin only):**
- Отдельная кнопка в «Опасной зоне» секции `/settings/workspace`. Эндпоинт `DELETE /v1/workspaces/{wsId}` каскадно сносит всё (контакты, аккаунты, кампании). Confirm-диалог обязателен. Это единственный путь «сделать так, чтобы workspace перестал существовать» — донор удалял ws молча при leave последнего admin'а, у нас явный destructive-action.

## Error-flow
Любой `TRPCClientError` → `toast.error(err.message)`. UI откатывается к предыдущему состоянию.

## Скриншоты

**Экран команды** (список + pending invites):

![Команда](_screenshots/ProtectedWWorkspaceIdSettingsWorkspaceIndexRouteImport/1776737891198_nav+500.png)

**Карточка участника:**

![Карточка участника](_screenshots/ProtectedWWorkspaceIdSettingsWorkspaceUserUserIdRouteImport/1776737903978_nav+500.png)

## Открытые вопросы
- **OQ-1**: ~~`owner` vs `admin`~~ — закрыт. У нас `admin` может удалять любых членов (включая других admin'ов); единственное ограничение — единственного admin'а нельзя оставить без admin'а (409 при leave-self).
- **OQ-2**: куда редиректит после «Покинуть», если это был единственный воркспейс? Ожидаем форму US-1, но в capture не зафиксировано.
- **OQ-3**: есть ли confirm-диалог на «Удалить» / «Покинуть»? В capture клик → мутация без промежуточного шага, но модалка могла быть проскочена. У нас на «Удалить workspace» — обязателен confirm-диалог; на leave/remove — рассматриваем как «destructive light», confirm не критичен.

## Критерии приёмки
- [ ] На `/settings/workspace` виден список членов и раздел «Ожидающие приглашения» с countdown'ом.
- [ ] В карточке своего пользователя роль задизейблена, показан hint «Вы не можете изменить свою собственную роль».
- [ ] Смена роли: ровно один `POST /trpc/workspace.changeWorkspaceMemberRole`, список инвалидируется.
- [ ] Удаление другого: ровно один `POST /trpc/workspace.removeWorkspaceMember`, редирект на `/settings/workspace`.
- [ ] «Покинуть» для себя: ровно один `DELETE /v1/workspaces/{wsId}/members/{me}`, корректный редирект (см. OQ-2).
- [ ] «Покинуть» для единственного admin'а: **409 Conflict**, остаёмся на странице, toast с подсказкой повысить кого-то или удалить ws.
- [ ] «Удалить рабочее пространство» (admin): confirm-диалог, затем `DELETE /v1/workspaces/{wsId}`, редирект на `/` или US-1 если других ws нет.
- [ ] Ошибка сервера показывается как toast, состояние UI откатывается.
