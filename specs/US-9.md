---
story: US-9
title: Подключить личный Telegram для CRM-чатов
stage: 4 (Telegram sync)
coverage:
  routes:
    - ProtectedWWorkspaceIdSettingsTelegramSyncRouteImport  # /w/{id}/settings/telegram-sync
  rpc:
    - telegram.client.sendCode
    - telegram.client.signIn
    - telegram.client.signInWithPassword
    - telegram.client.status
    - telegram.client.getFolders
    - telegram.client.triggerSync
    - telegram.client.getQrState
    - telegram.client.signOut
  firestore: []
  postmessage: []
  ui_strings:
    - web.telegram.sync.connectButton
    - web.telegram.sync.qrInstructions
    - web.telegram.sync.connectByPhoneButton
    - web.telegram.sync.phoneLabel
    - web.telegram.sync.codeLabel
    - web.telegram.sync.passwordLabel
    - web.telegram.sync.privacy.selective
    - web.telegram.sync.privacy.encryptedToken
    - web.telegram.sync.privacy.metadataOnly
---

# US-9 · Подключить личный Telegram для CRM-чатов

**Предусловие**: аутентифицирован, внутри воркспейса. Этот TG-аккаунт будет **личным** — для чтения/записи собственных чатов в CRM. Не путать с [US-17](./US-17.md) (TG-аккаунт для outreach).

## Цель
Привязать личный Telegram-аккаунт к воркспейсу, чтобы в CRM были видны свои чаты и папки.

## Точки входа
- Сайдбар → **«Настройки»** → **«Синк ТГ-папок»** → `/w/{id}/settings/telegram-sync`.
- Альтернатива: сайдбар → **«Чат»** → empty-state **«Синхронизируйте папки Telegram»** / **«Автоматическая синхронизация»** — ведёт на тот же URL.

## Варианты подключения

### A. QR (по умолчанию)
1. Кнопка **«Подключить Telegram»** → показывается QR.
2. Инструкция: **«Откройте Telegram на вашем телефоне → Настройки > Устройства > Подключить устройство → Отсканируйте этот QR-код»**.
3. Клиент поллит `telegram.client.getQrState` до подтверждения с телефона.

### B. По номеру телефона
1. Кнопка **«Подключить по номеру телефона»** → форма.
2. «Номер телефона» → `telegram.client.sendCode` → «Код из Telegram» → `telegram.client.signIn`.
3. Если у аккаунта 2FA: дополнительно «Пароль» → `telegram.client.signInWithPassword`.

## Privacy-обещания в UI (над формой)
- **«Выборочная синхронизация»**.
- **«Зашифрованный токен сессии»**.
- **«Только метаданные»** — подпись: «Мы импортируем только метаданные чата (имя, участники, время последнего сообщения), но не содержимое сообщений».

## Что вызывается
- `telegram.client.sendCode` — отправка кода на номер.
- `telegram.client.signIn` — обмен кода на сессию.
- `telegram.client.signInWithPassword` — ветка 2FA.
- `telegram.client.getQrState` — поллинг QR-авторизации.
- `telegram.client.status` — проверка статуса сессии (бутстрэп).
- `telegram.client.getFolders` — список папок после успеха.
- `telegram.client.triggerSync` — запуск первичной синхронизации.
- `telegram.client.signOut` — отключение (если было уже подключено).

Сигнатуры — см. [`api-contracts.md`](./api-contracts.md).

## Success-flow
1. Успешный `signIn` / `signInWithPassword` / QR-подтверждение.
2. `getFolders` + `triggerSync` дёргаются автоматически.
3. Появляется список папок и чатов на том же экране (или редирект в `/telegram` — проверить, [OQ-1](#открытые-вопросы)).

## Error-flow
- Неправильный код → ошибка от `signIn`, форма кода остаётся.
- Неправильный пароль 2FA → ошибка от `signInWithPassword`, форма пароля остаётся.
- QR протух → клиент перезапрашивает QR.
- Общий fallback: `toast.error(err.message)`.

## Скриншот
![Telegram sync экран](_screenshots/ProtectedWWorkspaceIdSettingsTelegramSyncRouteImport/1776738265060_nav+500.png)

## Открытые вопросы
- **OQ-1**: после успеха — редирект в `/telegram` или просто обновление текущего экрана с папками?
- **OQ-2**: точный формат ошибок 2FA / флуд-лимитов Telegram — нужен негативный capture.
- **OQ-3**: что происходит при повторном подключении поверх уже активной сессии? Silent replace или предварительный `signOut`?

## Критерии приёмки
- [ ] QR-ветка: QR отображается, поллинг `getQrState` идёт, подтверждение с телефона приводит к успеху.
- [ ] Phone-ветка: `sendCode` → `signIn` → (опц.) `signInWithPassword` проходят в заданной последовательности.
- [ ] После успеха — `getFolders` и `triggerSync` дёрнуты по одному разу.
- [ ] Все три privacy-подписи видны на форме.
- [ ] Ошибки каждой фазы отображаются как toast без потери введённых данных.
