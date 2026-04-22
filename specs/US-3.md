---
story: US-3
title: Принять приглашение
stage: 2 (Team)
coverage:
  routes: []  # /accept-invite/... и /settings/workspace/accept-invite/... — не посещались
  rpc:
    - workspace.getWorkspaceInvite   # declared, не captured
    - workspace.acceptWorkspaceInvite # declared, не captured
  firestore: []
  postmessage: []
  ui_strings: []
---

# US-3 · Принять приглашение

> ⚠️ **Нет capture.** Ни роут, ни RPC не перехвачены в текущей сессии. Для написания полной стори нужен отдельный capture-проход со второго аккаунта, принимающего приглашение.

**Предусловие**: другой пользователь пригласил этого по TG-username (см. [US-2](./US-2.md)); ссылка пришла от бота.

## Цель
Принять приглашение и попасть в воркспейс пригласившего.

## Точки входа (из user-stories.md)
- **Не залогинен**: `/accept-invite/{workspaceId}/{inviteCode}` — ведёт через auth-флоу, после логина перебрасывает на accept.
- **Залогинен под другим воркспейсом**: `/w/{curId}/settings/workspace/accept-invite/{wId}/{inviteCode}`.

## Ожидаемый флоу (не подтверждено capture)

### Ветка A · «не залогинен»
1. Клик по ссылке → `/accept-invite/{workspaceId}/{inviteCode}`.
2. Роут снаружи защищённого контура — auth-gate (см. [`auth.md`](./auth.md)) сначала логинит (TG Mini-App или web-session).
3. После логина — редирект на `/w/{curId}/settings/workspace/accept-invite/{workspaceId}/{inviteCode}`. Дальше — ветка B.

### Ветка B · «залогинен под другим воркспейсом»
1. На бутстрэпе страницы: `workspace.getWorkspaceInvite` — получаем `{ workspaceName, invitedBy, role, ... }`.
2. UI: заголовок «Вас пригласили в воркспейс **X**» + надпись «от **{invitedBy}**» + роль.
3. Кнопка **«Принять»** → `workspace.acceptWorkspaceInvite({ inviteCode, workspaceId })`.
4. Success → history `replace` на `/w/{acceptedWorkspaceId}` (см. [US-30](./US-30.md)).
5. Инвалидация списка воркспейсов пользователя (picker наверху сайдбара уже содержит новый).

### Ошибки (ожидаемые)
- `inviteCode` просрочен → 4xx от `getWorkspaceInvite` → страница-ошибка «Приглашение недействительно». См. [OQ-1](#открытые-вопросы).
- Пользователь уже член воркспейса → вероятно, сервер отвечает успехом-идемпотентно и редиректит сразу. См. [OQ-3](#открытые-вопросы).
- Rate-limit / общий сбой → `toast.error(err.message)`.

## Что вызывается (declared)
- `workspace.getWorkspaceInvite` — load данных приглашения по `inviteCode`.
- `workspace.acceptWorkspaceInvite` — accept-действие.

Сигнатуры — см. [`api-contracts.md`](./api-contracts.md) (секция declared-but-not-captured).

## Что прокликать для capture
1. Со второго Google-аккаунта (или из incognito) открыть ссылку из бота `/accept-invite/{wsId}/{code}`.
2. Снять: bootstrap-вызов `getWorkspaceInvite`, сам submit `acceptWorkspaceInvite`, финальный URL.
3. Дополнительно: просроченный code, уже-член случай, «Отклонить» если есть.

## Открытые вопросы
- **OQ-1**: 4xx-ответы `getWorkspaceInvite` / `acceptWorkspaceInvite`: коды, тексты, показывается ли отдельная страница-ошибка.
- **OQ-2**: есть ли в UI кнопка «Отклонить» и какая под ней ручка (возможно, `declineWorkspaceInvite` — проверить code-inventory).
- **OQ-3**: идемпотентность `acceptWorkspaceInvite`, если пользователь уже член воркспейса.
- **OQ-4**: TTL `inviteCode` (см. user-stories.md US-4 — там pending invites показывают «осталось N days»).

## Критерии приёмки (ожидаемые, финализировать после capture)
- [ ] Переход по ссылке без сессии — проходит auth, потом попадает на accept.
- [ ] `getWorkspaceInvite` дёрнут ровно раз на бутстрэпе.
- [ ] «Принять» → один `POST /trpc/workspace.acceptWorkspaceInvite`, history `replace` на `/w/{newId}`.
- [ ] Просроченный code → пользователь видит понятное сообщение, а не голый toast.
