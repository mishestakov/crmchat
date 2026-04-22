---
story: US-1
title: Первый вход и создание воркспейса
stage: 1 (Onboarding)
coverage:
  routes:
    - ProtectedIndexRouteImport                             # "/" — решает куда редиректить
    - ProtectedWWorkspaceIdSettingsWorkspaceNewRouteImport  # /w/{id}/settings/workspace/new
  rpc:
    - workspace.createWorkspace
    - workspaces.getMembers                                 # follow-up после редиректа
  firestore: []
  postmessage: []
  ui_strings:
    - web.workspace.new.createFirstWorkspace                # "Создайте рабочее пространство"
    - web.workspace.nameLabel                               # "Название рабочего пространства"
    - web.workspace.namePlaceholder                         # "Мое рабочее пространство"
    - web.workspace.new.nameDescription
    - web.workspace.new.createButton                        # "Создать рабочее пространство"
    - web.workspace.new.switchToNewToast                    # "Переключено на новое рабочее пространство"
    - web.common.error.shouldNotEmpty                       # "Поле не должно быть пустым"
---

# US-1 · Первый вход и создание воркспейса

**Предусловие**: пользователь аутентифицирован (см. `specs/auth.md`).

## Цель
У нового пользователя нет ни одного воркспейса — он должен создать первый прежде чем попадёт в UI.

## Точки входа
- **`/`** после логина: если `user.workspaces.length === 0` — показывается модалка с формой.
  Иначе — редирект на `/w/{firstWorkspaceId}`.
- **`/w/{id}/settings/workspace/new`** — та же форма как отдельная страница (используется в US-5 "создать ещё один"; в US-1 этот URL опциональный).

## Форма
Одно поле — **«Название рабочего пространства»** (обязательное, trim, non-empty; ошибка — «Поле не должно быть пустым»). Кнопка **«Создать рабочее пространство»**.

Заголовок модалки — **«Создайте рабочее пространство»** (только в варианте "первый вход").

## Что вызывается
- `workspace.createWorkspace` — основная мутация.
- `workspaces.getMembers` — на bootstrap-е после редиректа.

Сигнатуры/примеры — см. [`api-contracts.md`](./api-contracts.md).

## Success-flow
1. Мутация успешна → получили `workspace.id`.
2. Редирект `replace` на `/w/{id}/settings/workspace`.
3. Toast: **«Переключено на новое рабочее пространство»**.

## Error-flow
Любая ошибка от сервера → `toast.error(err.message)`. Форма остаётся открытой.

## Скриншоты
- Модалка "первый вход": `tools/capture/processed/routes/ProtectedIndexRouteImport/1776736702791_nav+500.png`
- Страница `/settings/workspace/new`: `tools/capture/processed/routes/ProtectedWWorkspaceIdSettingsWorkspaceNewRouteImport/1776778415403_nav+500.png`
- После создания (settle): `…/1776778421357_response-settle.png`

## Открытые вопросы
- Что делает `createWorkspace`, если `organizationId` не передан? В capture только кейс с уже существующей org.
- Коды ошибок мутации (quota, duplicate name, permissions) — не зафиксированы, нужен негативный capture.

## Критерии приёмки
- [ ] Пользователь без воркспейсов видит модалку после логина и не может её закрыть.
- [ ] Пустое имя блокирует submit с правильным сообщением.
- [ ] Успех: ровно один `POST /trpc/workspace.createWorkspace`, history `replace`, toast показан один раз.
- [ ] Ошибка сервера показывается как toast, форма доступна для повторной попытки.
