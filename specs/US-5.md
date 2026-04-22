---
story: US-5
title: Управление воркспейсами
stage: 1 (Workspaces)
coverage:
  routes:
    - ProtectedWWorkspaceIdSettingsWorkspaceNewRouteImport       # /w/{id}/settings/workspace/new
    - ProtectedWWorkspaceIdSettingsWorkspaceIndexRouteImport     # /w/{id}/settings/workspace (inline-rename)
    - ProtectedWWorkspaceIdSettingsOrganizationOrganizationIdRouteImport  # /w/{id}/settings/organization/{orgId}
  rpc:
    - workspace.createWorkspace
  firestore: []
  postmessage: []
  ui_strings:
    - web.workspace.new.createAdditionalWorkspace
    - web.workspace.nameLabel
    - web.workspace.namePlaceholder
    - web.workspace.new.createButton
    - web.workspace.new.switchToNewToast
    - web.workspace.renameSuccessToast
    - web.organization.nameLabel
    - web.organization.saveButton
    - web.common.error.shouldNotEmpty
---

# US-5 · Управление воркспейсами

**Предусловие**: аутентифицирован (см. [`auth.md`](./auth.md)), уже есть хотя бы один воркспейс (иначе — см. [US-1](./US-1.md)).

## Цель
Три подсюжета одного ментального сюжета «мои воркспейсы»:

1. **Создать ещё один** (рядом с текущим).
2. **Переименовать** текущий.
3. **Настроить организацию**, к которой привязан воркспейс.

---

## 5.1 · Создать ещё один воркспейс

### Точка входа
Сайдбар → **«Настройки»** → **«Создать рабочее пространство»** → `/w/{id}/settings/workspace/new`.

Это та же форма, что и модалка первого входа (US-1), только открыта как отдельная страница.

### Форма
Одно поле — **«Название рабочего пространства»** (trim, non-empty). Кнопка **«Создать рабочее пространство»**.

### Что вызывается
- `workspace.createWorkspace` — единственная мутация. Сигнатура — см. [`api-contracts.md`](./api-contracts.md).

### Success-flow
1. Мутация успешна → получили `workspace.id`.
2. Редирект `replace` на `/w/{newId}/settings/workspace`.
3. Toast: **«Переключено на новое рабочее пространство»**.
4. Переключатель в верху сайдбара (workspace picker) показывает новый воркспейс выбранным.

### Скриншот
![Форма нового воркспейса](_screenshots/ProtectedWWorkspaceIdSettingsWorkspaceNewRouteImport/1776778415403_nav+500.png)

---

## 5.2 · Переименовать воркспейс

### Точка входа
Сайдбар → **«Команда»** (`/w/{id}/settings/workspace`) → inline-поле **«Название рабочего пространства»**.

### Форма
Inline input + кнопка **«Save»**. Валидация: trim, non-empty.

### Что вызывается
В capture **tRPC-вызова не видно** при сохранении имени — вероятно прямой Firestore-write (документ воркспейса). См. [OQ-1](#открытые-вопросы).

### Success-flow
- Toast: **«Название рабочего пространства сохранено!»**.
- Имя обновляется в picker'е сайдбара без перезагрузки.

### Скриншот
![Inline-rename на экране команды](_screenshots/ProtectedWWorkspaceIdSettingsWorkspaceIndexRouteImport/1776737891198_nav+500.png)

---

## 5.3 · Настройки организации

### Точка входа
**Путь через UI не найден.** Доступ только по прямому URL `/w/{id}/settings/organization/{organizationId}`. См. [OQ-2](#открытые-вопросы).

### Форма
Inline-поле **«Название организации»** + кнопка **«Сохранить»**.

### Что вызывается
В capture — только бутстрэп-вызовы destination-страницы (`workspaces.getMembers` и ко). Сам save-экшен пишет напрямую в Firestore. См. [OQ-3](#открытые-вопросы).

### Скриншот
![Страница настроек организации](_screenshots/ProtectedWWorkspaceIdSettingsOrganizationOrganizationIdRouteImport/1776736750585_nav+500.png)

---

## Error-flow (общий)
Любая серверная ошибка → `toast.error(err.message)`. Форма остаётся открытой.

## Открытые вопросы
- **OQ-1**: Какая именно Firestore-запись обновляется при rename? Документ `workspaces/{id}` или RPC мы просто не перехватили? Нужен более плотный capture с фокусом на этот клик.
- **OQ-2**: Есть ли в UI пункт меню, ведущий на `/settings/organization/{orgId}`, или это правда только прямой URL?
- **OQ-3**: Как вообще создаётся organization-сущность и как к ней привязывается воркспейс? В `createWorkspace` мы не видели `organizationId` в input (см. [US-1 OQ](./US-1.md#открытые-вопросы)).

## Критерии приёмки
- [ ] **Создание**: пустое имя блокирует submit; успех → ровно один `POST /trpc/workspace.createWorkspace`, `replace`-редирект, toast показан один раз.
- [ ] **Rename**: пустое имя блокирует save; успех → toast «Название рабочего пространства сохранено!», picker сайдбара обновляется.
- [ ] **Организация**: прямой URL открывается, save показывает toast; из обычного меню пути нет (либо найден и задокументирован — см. OQ-2).
