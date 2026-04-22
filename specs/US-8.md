---
story: US-8
title: Редактировать и удалить поле
stage: 3 (Properties)
coverage:
  routes:
    - ProtectedWWorkspaceIdSettingsPropertiesObjectTypeKeyEditRouteImport  # /w/{id}/settings/properties/{objectType}/{key}/edit
  rpc: []
  firestore: []
  postmessage: []
  ui_strings:
    - web.properties.edit.title
    - web.properties.updateButton
    - web.properties.deleteButton
    - web.properties.cannotDeleteSystem
---

# US-8 · Редактировать и удалить поле

**Предусловие**: поле уже существует (см. [US-7](./US-7.md)).

## Цель
Изменить параметры существующего поля (имя, цвет, опции) или удалить его.

## Точка входа
Сайдбар → **«Кастомные поля»** → клик по строке поля → `/w/{id}/settings/properties/{objectType}/{key}/edit`.

`{key}` — либо `custom.<id>` для пользовательских полей, либо системный ключ (например, `stage` для «Стадии»).

## Форма
Те же поля, что в [US-7](./US-7.md). Submit — **«Обновить поле»**. Ниже формы — отдельная кнопка **«Удалить поле»**.

## Специальный кейс: системные поля
Для системных полей (например, **«Стадия»** = воронка CRM) удаление запрещено. Ожидается либо задизейбленная кнопка, либо toast **«Вы не можете удалить системное поле»**. См. [OQ-2](#открытые-вопросы).

## Что вызывается
В capture tRPC-вызовов не зафиксировано — ожидается прямая Firestore-запись / удаление. См. [OQ-1](#открытые-вопросы).

## Success-flow
- **Обновление**: возврат на `/settings/properties/{objectType}`, изменения видны.
- **Удаление**: confirm-диалог (ожидаем) → документ Firestore удалён → возврат на список.

## Error-flow
`toast.error(err.message)`, форма остаётся.

## Открытые вопросы
- **OQ-1**: Firestore-операции update/delete — нужен capture с Firestore-sniffer.
- **OQ-2**: точный механизм блокировки удаления системных полей (disabled-кнопка? toast? серверная проверка?).

## Критерии приёмки
- [ ] Форма предзаполнена текущими значениями поля.
- [ ] «Обновить поле» сохраняет и возвращает на список.
- [ ] «Удалить поле» — с подтверждением; поле исчезает из списка.
- [ ] Системное поле «Стадия» удалить нельзя.
