---
story: US-7
title: Создать кастомное поле
stage: 3 (Properties)
coverage:
  routes:
    - ProtectedWWorkspaceIdSettingsPropertiesObjectTypeNewTypeRouteImport  # /w/{id}/settings/properties/{objectType}/new/{type}
  rpc:
    - workspaces.getMembers  # shell bootstrap
  firestore: []
  postmessage: []
  ui_strings:
    - web.properties.new.title
    - web.properties.nameLabel
    - web.properties.colorLabel
    - web.properties.typeLabel
    - web.properties.requiredLabel
    - web.properties.showInListLabel
    - web.properties.valuesLabel
    - web.properties.newValueButton
    - web.properties.createButton
    - web.common.error.shouldNotEmpty
---

# US-7 · Создать кастомное поле

**Предусловие**: аутентифицирован, внутри воркспейса (см. [US-6](./US-6.md)).

## Цель
Добавить новое кастомное поле для объекта (сейчас — `contacts`).

## Точка входа
Сайдбар → **«Кастомные поля»** → **«Новое поле»** → выбрать тип → `/w/{id}/settings/properties/{objectType}/new/{type}`.

## Варианты `{type}` в URL
- `text` — обычное текстовое (вероятно; проверить в UI).
- `single-select` — отображается как **«Одиночный выбор»**.
- `multi-select` — отображается как **«Множественный выбор»**.
- Из описания в UI упоминаются также числа/даты — см. [OQ-1](#открытые-вопросы).

## Форма
| Поле | Label | Примечание |
|---|---|---|
| `name` | **«Название поля»** | trim, non-empty |
| `color` | **«Изменить цвет»** | палитра (см. ниже) |
| `type` | **«Тип поля»** | задан через URL |
| `required` | **«Обязательное поле»** | checkbox |
| `showInList` | **«Отображать в списке»** | checkbox |

**Для `single-select` / `multi-select`** дополнительно — блок **«Значения»**: список опций, кнопка **«Новое значение»**, у каждой опции — свой «Изменить цвет».

**Палитра цветов** (одна и та же для поля и для опций):
`Без цвета` · `Серый` · `Коричневый` · `Оранжевый` · `Желтый` · `Зеленый` · `Синий` · `Фиолетовый` · `Розовый` · `Красный`.

Submit: **«Создать поле»**.

## Что вызывается
В capture `create`-вызова tRPC на этом экране **нет** — создание пишется напрямую в Firestore. См. [OQ-2](#открытые-вопросы).

Ключ нового поля формируется как `custom.<id>` (встречается в других captured запросах — например, в `outreach.sequences.patch` при дефолтах).

## Success-flow
1. Запись в Firestore → возврат на `/settings/properties/{objectType}` (см. [US-6](./US-6.md)).
2. Новое поле появляется в списке.

## Error-flow
Любая ошибка → `toast.error(err.message)`, форма остаётся открытой.

## Открытые вопросы
- **OQ-1**: полный список значений `{type}`. В user-stories.md упомянуты числа/даты, но URL'ы не зафиксированы.
- **OQ-2**: Firestore-коллекция и документ-формат properties. Нужен capture с включённым Firestore-sniffer на этом роуте.

## Критерии приёмки
- [ ] Пустое имя блокирует submit с «Поле не должно быть пустым».
- [ ] Для `single-select` / `multi-select` блок «Значения» виден и позволяет добавлять опции с цветами.
- [ ] После «Создать поле» — возврат на список, новое поле присутствует.
- [ ] Ошибка показывается как toast, форма доступна.
