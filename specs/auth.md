---
story: AUTH
title: Аутентификация (shared pre-condition)
stage: 0 (infra, до любой US)
coverage:
  routes:
    - rootRouteImport                         # __root — монтирует гвард
    - ProtectedRouteImport                    # _protected layout
  rpc:
    - telegram.authenticateByInitData         # путь mini-app
  firestore:
    - createWebAuthSession                    # путь browser
    - invalidateWebAuthSession
    - subscribeToAuthSession
  postmessage: []
---

# AUTH · Аутентификация

Shared pre-condition для всех `US-*`. Любой `/_protected/*` требует, чтобы в Firebase Auth была активная сессия.

## Два входа

### A. Telegram Mini-App — `authenticateByInitData`
Пользователь открывает приложение внутри Telegram-клиента.

1. Клиент читает `Telegram.WebApp.initData`.
2. Мутация `telegram.authenticateByInitData({ initData })` → `{ customToken }`.
3. `signInWithCustomToken(auth, customToken)`.
4. Гвард на смену аккаунта: если `user.telegram.id !== WebApp.initDataUnsafe.user.id` → `auth.signOut()`.
5. Если `initData` пуст (приложение открыто не из TG-клиента) — fallback на путь B.

### B. Web-browser — QR/ссылка через бота
Пользователь открывает `app.crmchat.ai` в браузере.

1. Клиент создаёт одноразовую сессию в Firestore (`authSessions/{sessionId}`) и подписывается на её изменения.
2. Клиент открывает `tg://resolve?domain={VITE_BOT_USERNAME}&start=a_{sessionId}` — пользователь подтверждает вход в боте.
3. Бот (серверная часть, вне этого клиента) записывает в doc поле `token`.
4. Клиент получает snapshot, вызывает `signInWithCustomToken(auth, token)` и инвалидирует сессию.
5. Сессия имеет TTL; инвалидация также выполняется при закрытии вкладки.

UI экрана B: логотип CRMChat + кнопка **«Login with Telegram»** (hard-coded EN, не i18n). При истёкшей сессии — подпись **«Refresh the page to try again»**.

## Error-flow

| Условие | Что видит пользователь |
|--------|-------------------------|
| Mini-app без `initData` и нет браузерного fallback | Экран **«Auth Required»** с иконкой `ShieldX` |
| Mini-app: `authenticateByInitData` вернул ошибку | `failedToAuth=true` → тот же экран "Auth Required" |
| Browser: сессия протухла до получения token | Кнопка disabled + «Refresh the page to try again» |

## Скриншоты
Не зафиксированы — капчур включался уже после логина, а browser-flow идёт через внешний TG-клиент. TODO: capture вручную при следующем прогоне.

## Открытые вопросы
- Время жизни (TTL) `authSessions/{id}` — задано клиентом, но сервер тоже должен его уважать (cleanup). Проверить правило.
- Формат `token` в `authSessions` — ожидается Firebase custom-token; подтверждение нужно по правилам безопасности Firestore.
- Что происходит при rate-limit на `authenticateByInitData` (несколько открытий mini-app подряд)?

## Критерии приёмки
- [ ] В mini-app при валидном `initData` пользователь получает Firebase-сессию без дополнительных действий.
- [ ] В браузере после подтверждения в боте клиент автоматически подхватывает токен (без F5).
- [ ] Одноразовость: после успешного входа `authSessions/{id}` инвалидирован и повторное использование невозможно.
- [ ] Mismatch TG-аккаунта в mini-app приводит к `signOut`, без зависания UI.
