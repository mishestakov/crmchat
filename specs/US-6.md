---
story: US-6
title: Посмотреть свойства (properties)
stage: 3 (Properties)
coverage:
  routes:
    - ProtectedWWorkspaceIdSettingsPropertiesObjectTypeIndexRouteImport  # /w/{id}/settings/properties/{objectType}
  rpc: []
  firestore: []
  postmessage: []
  ui_strings:
    - web.properties.title
    - web.properties.dragHint
    - web.properties.howToUseLink
    - web.properties.newFieldButton
---

# US-6 · Посмотреть свойства

**Предусловие**: аутентифицирован (см. [`auth.md`](./auth.md)), внутри воркспейса.

## Цель
Просмотреть список кастомных полей (properties) для выбранного типа объекта.

## Точка входа
Сайдбар → **«Кастомные поля»** → `/w/{id}/settings/properties/{objectType}`.

В capture `{objectType}` = **`contacts`** — единственный наблюдавшийся тип (см. [OQ-1](#открытые-вопросы)).

## Что показано
- Список полей, drag-handle'ами можно менять порядок.
- Подсказка: **«Вы можете перетаскивать элементы для изменения порядка полей»**.
- Ссылка **«Как использовать поля?»** (внешняя документация).
- Кнопка **«Новое поле»** — ведёт на [US-7](./US-7.md).
- Клик по строке — ведёт на [US-8](./US-8.md).

## Что вызывается
В capture **tRPC-вызовов нет**. Список полей и порядок, вероятно, читаются напрямую из Firestore-коллекции `properties/{workspaceId}/...`. См. [OQ-2](#открытые-вопросы).

## Открытые вопросы
- **OQ-1**: какие ещё `{objectType}` существуют, кроме `contacts`? В UI переключатель типа не виден — возможно, один-единственный.
- **OQ-2**: Firestore-путь коллекции свойств и механизм обновления порядка (drag-n-drop → batch-update?).

## Критерии приёмки
- [ ] Страница `/settings/properties/contacts` открывается, показан список полей.
- [ ] Drag-n-drop меняет порядок (persists после reload).
- [ ] Кнопка «Новое поле» ведёт на US-7, клик по строке — на US-8.
