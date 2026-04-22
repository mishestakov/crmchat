# Чат — спецификация «по коду»

## 🧭 Главное открытие: чат — это iframe

`components/chat.tsx` и `features/outreach/chat/chat-iframe.tsx` показывают, что «чат» — **не код crmchat**. Это `<iframe>` на внешний URL `VITE_TELEGRAM_CLIENT_URL` (отдельный сервис/домен), и весь мессенджер (списки диалогов, отправка, получение, история, scroll, вложения, реакции, read receipts) живёт **внутри него**.

crmchat общается с iframe через `window.postMessage` — это и есть **единственный API**, через который родительская страница видит и управляет чатом.

**Следствия для тестирования:**
- В нашем capture (HTTP-based) чат **не засечь принципиально** — там нет ни tRPC, ни oRPC.
- Все «действия с сообщением» (отправить, ответить, переслать, удалить, прикрепить медиа, скролл истории) происходят **внутри iframe** — для их полной спецификации надо отдельно реверс-инжинирить Telegram-клиент, **это отдельный scope**.
- В сторис-покрытии crmchat фиксируем только то, что **видит родитель** (postMessage + Firestore-sync) — список ниже исчерпывающий.

---

## 📨 postMessage-контракт (исчерпывающий)

Источник: `chat-iframe.tsx:120-250`.

### Родитель → iframe (3 типа)

| type | Когда шлётся | Данные |
|---|---|---|
| `sessionResponse` | В ответ на `sessionRequest` от iframe, если в Firestore есть session для аккаунта | `{ ...authData }` (session token + prefs) |
| `openChat` | Когда authState = `authorizationStateReady` и передан `contact` prop | `{ id: contact.telegram.id, username: contact.telegram.username }` |
| `setDisplayedProperties` | При изменении `displayedProperties` в store (что показывать в карточке Telegram-контакта) | `{ displayedProperties }` |

### iframe → родитель (7 типов)

| type | Что значит | Реакция родителя |
|---|---|---|
| `sessionRequest` | iframe запросил session для авторизации | `setSessionRequested(true)` → отправить `sessionResponse` |
| `sessionRequestFailed` | Не удалось авторизоваться | `setError("authError")` |
| `chatOpened` | Пользователь кликнул на чат внутри iframe | `setChatLoading(false)`, `setSelectedLead(event.data.info)` — правая панель подтягивает CRM-контакт по `peerId`/`username` |
| `authState` / `authStateLegacy` | Смена состояния auth (`authorizationStateReady`, …) | `setAuthState()`. При `Ready` — шлём `openChat` если задан контакт |
| `connectionState` | Смена состояния MTProto-соединения (`connectionStateBroken`, …) | `setConnectionState()`. При `Broken` → показать `<SessionInvalidated />` с «Переподключить» |
| `chatUnreadState` | Обновился unread-count диалога (с `synced=true`) | `scheduleUnreadSync(peerId, username, unreadCount)` — debounce 750мс → `updateContact` в Firestore |
| `mtprotoSenderLogs` | Логи MTProto-sender (для отладки) | Пушит в `DebugLogStore` (видно через 🐛 bug-иконку) |

**Где искать unknown типы:** `event.data?.type` с неопознанным значением логируется в debug-store как `<- <unknown-type>`. Если появляется новый — добавить в таблицу.

---

## 🔥 Firestore-операции, которые делает родитель для чата

| Операция | Файл | Триггер |
|---|---|---|
| `updateContact` (unread sync) | `use-chat-unread-sync.ts:29` | debounced 750мс после `chatUnreadState` от iframe. Поле: `telegram.account.{accountId} = { unread, unreadCount }` |
| `createContact` (из чата в CRM) | `chat.tsx:576` | Кнопка «Создать лида в CRM» в правом sidebar-е когда в iframe открыт чат с **не-контактом** (NonExistingLeadCard) |
| `contact.updateContactAvatar` (tRPC) | `chat.tsx:598` | Сразу после createContact, если у lead есть аватарка |
| Подписки (`onSnapshot`) на `/dialogs` | `lib/db/telegram.ts:104` | `subscribeToUnreadDialogs` — feed unread-индикаторов в сайдбаре и в селекторе аккаунта |
| Запрос `/dialogs` для контакта | `lib/db/telegram.ts:99+` (`getDialogsForContact`) | При открытии чата — чтобы выбрать account, у которого был разговор с этим контактом |

---

## 🖱️ Что юзер реально может кликнуть в родительской странице

Весь UI родителя вокруг iframe — в `chat.tsx` и `chat-iframe.tsx`. Действия:

### Верхний бар
1. **Селектор TG-аккаунта** (`AccountSelector`) — выбор, каким аккаунтом писать. Переключение пере-мунтит iframe (`key={selectedAccountId}`).
2. Из селектора: **«Новая рассылка»** (Link на `/sequences/new`), **«Добавить TG-аккаунт»** (Link на `/telegram-accounts/new`).
3. **«Редактировать лид»** (mobile) — drawer с `<ContactView />`.
4. **SidebarTrigger** — скрыть/показать правую панель.

### Правый сайдбар (без контакта)
- Если iframe прислал `chatOpened` с **non-contact** (user/group которого нет в CRM):
  - `<NonExistingLeadCard />` → кнопка **«Создать лида в CRM»** → создаёт Firestore-контакт + дергает `contact.updateContactAvatar` если аватар есть.
- Иначе placeholder «Выберите контакт».

### Правый сайдбар (с контактом) — `<ContactView />`
- Та же карточка, что на `/contacts/{id}` (см. **US-14**): редактировать/удалить/заметки/напоминания/timeline активностей.

### Состояния загрузки/ошибки iframe
- Loader «Авторизация…» / «Загружаем чат…»
- «Прокси недоступен» (если `proxyStatus === false`)
- `<SessionInvalidated />` (connection broken) — кнопка переподключиться, `<ReauthAccount />` с QR/SMS — зовёт `telegram.account.reauthenticateWebClient` / `submitReauthPassword`.
- 🐛 Debug-log modal (opacity:10 кнопка в углу).

### Warning-модалки (до chat.tsx:305)
- Если у workspace 0 TG-аккаунтов → одна из двух модалок:
  - План `outreach` → «Подключите аккаунт» → вторая модалка о приватности → Link на `/telegram-accounts/new`
  - Остальные планы → «Управляйте чатами» → та же цепочка.

---

## ✅ Что это значит для US-10

US-10 надо переписать так:

- Чат = iframe; crmchat сам не реализует мессенджер.
- Все действия «внутри чата» (отправить/ответить/переслать/удалить/скролл/поиск) — **не наш scope**, а scope внешнего Telegram-клиента.
- В ТЗ для crmchat про чат фиксируем только:
  1. Селектор аккаунта + unread-индикаторы
  2. Создание лида из чата (non-contact case)
  3. Правая панель с `<ContactView />`
  4. Обработка state-ов iframe (loading / broken / re-auth)
  5. Unread-sync с Firestore (debounced)
- Warning-модалки «подключите TG» — тоже отдельный cluster для ТЗ.

---

## 🎯 Чек-лист для ручного теста (что должен покрыть юзер)

Если прокликаешь всё это — спецификация родителя протестирована:

- [ ] Открыть `/telegram` без TG-аккаунтов → увидеть warning-модалку (обе вариации плана при возможности)
- [ ] Открыть `/telegram` с TG-аккаунтом → дождаться загрузки iframe (`chatLoading = false`)
- [ ] Переключиться на другой TG-аккаунт → iframe перегрузился
- [ ] В селекторе: «Новая рассылка» → попал на `/sequences/new`
- [ ] В селекторе: «Добавить TG-аккаунт» → попал на `/telegram-accounts/new`
- [ ] Нажать SidebarTrigger → правая панель скрылась/показалась
- [ ] Открыть внутри iframe чат **с известным CRM-контактом** → в правой панели появилась `<ContactView />`
- [ ] Открыть чат **с незнакомым пиром (user)** → увидеть `<NonExistingLeadCard />` → «Создать лида в CRM» → контакт появился
- [ ] Открыть чат с **группой** → `<NonExistingLeadCard />` с иконкой Users, type = group
- [ ] В каком-то чате прочитать сообщение → через 750мс в Firestore (`contact.telegram.account.{id}.unread/unreadCount`) должно обновиться
- [ ] Специально сломать сессию (или дождаться) → `<SessionInvalidated />` → переподключение (зовёт tRPC `reauthenticateWebClient` / `submitReauthPassword`)
- [ ] (debug) Тыкнуть 🐛 иконку внизу → появится debug-лог с postMessage-ами
- [ ] Через mobile-viewport: увидеть **«Редактировать лид»** drawer и потыкать в нём поля

---

## 🔭 Отдельно: план реверса самого iframe

Если нужно описать «что внутри чата» — это **новый scope** и нужны:
- URL `VITE_TELEGRAM_CLIENT_URL` (найти в `.env` / build-артефактах)
- Отдельный capture: MTProto + postMessage-события iframe
- Или просто функциональное описание «это Telegram Web в кастомной сборке» + список поддерживаемых фич (из i18n / UI-инвентаря на этом домене)

**Рекомендую:** сейчас не лезть внутрь iframe, т.к. это:
- функционально = оригинальный Telegram Web (то, что уже документировано)
- plus какие-то кастомизации (напр. `setDisplayedProperties` — показ CRM-свойств в левой панели)
- для ТЗ crmchat достаточно сказать «используем embedded Telegram-client от команды X, с кастомизациями Y/Z»

---

## Runtime-валидация (опционально, Вариант 2)

Если хочешь доказать «это всё что шлёт iframe / всё что шлёт родитель» — CDP-инъекция, которая оборачивает `window.postMessage` и `window.addEventListener('message', ...)` и логирует каждое событие в наш raw-log. Это 30 строк в `capture.ts` через `Page.addScriptToEvaluateOnNewDocument`. Запускаем `/telegram`, кликаем 5 минут — получаем полный dump postMessage-ов, проверяем что нет новых типов кроме тех 10 в таблице выше.
