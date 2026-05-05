---
story: AUTH
title: Аутентификация (shared pre-condition)
stage: 0 (infra, до любой US)
---

# AUTH · Аутентификация

Shared pre-condition для всех `US-*`. Любой `/_protected/*` требует активной server-side сессии.

## Канал входа: Telegram OIDC

Единственный путь логина — OpenID Connect Authorization Code Flow + PKCE с
`oauth.telegram.org`. См. https://core.telegram.org/widgets/login.

### Регистрация приложения

В [@BotFather](https://t.me/botfather) создаётся бот для login:
- `/newbot` → имя + username.
- Регистрируем Allowed URL = `TELEGRAM_LOGIN_REDIRECT_URI`. Для prod —
  `https://<домен>/v1/auth/telegram/callback`, для dev —
  `http://localhost:3000/v1/auth/telegram/callback`.
- Получаем `Client ID` (= bot ID) и `Client Secret`. Secret живёт только в
  серверных env-переменных.

### Flow

1. **Старт.** Пользователь нажимает «Войти через Telegram» на `/login`.
   Это обычная навигация: `<a href="/v1/auth/telegram/start">`.
   Бэкенд:
   - Генерит `state` (CSRF, 16 байт base64url) и PKCE `verifier` (32 байта) +
     `challenge = base64url(SHA256(verifier))`.
   - Кладёт `{state, verifier}` в short-lived httpOnly cookie `tg_oidc`
     (TTL 10 мин).
   - 302 → `https://oauth.telegram.org/auth?client_id=...&redirect_uri=...&response_type=code&scope=openid+profile&state=...&code_challenge=...&code_challenge_method=S256`.
2. **Подтверждение.** Пользователь видит экран Telegram «Разрешить
   `<имя бота>` войти», подтверждает.
3. **Callback.** TG редиректит на `/v1/auth/telegram/callback?code=...&state=...`.
   Бэкенд:
   - Читает `tg_oidc` cookie, удаляет её.
   - Проверяет `state` против сохранённого (CSRF).
   - `POST oauth.telegram.org/token` с `grant_type=authorization_code`,
     `code`, `redirect_uri`, `client_id`, `code_verifier` (PKCE) и
     `Authorization: Basic base64(client_id:client_secret)` → `{ id_token, ... }`.
   - Валидирует `id_token` через `jose.jwtVerify` + JWKS
     (`oauth.telegram.org/.well-known/jwks.json`): подпись RS256, `iss`,
     `aud === client_id`, `exp`, `iat`.
   - Извлекает claims: `sub` (TG user_id), `name`, `preferred_username`,
     `picture`, опционально `phone_number` (если запрошен scope `phone`).
4. **Upsert юзера.** По `tg_user_id` (= `sub`) ищем запись в `users`:
   - Найдено → обновляем `name`/`username`/`avatar_url`/`phone`/`updated_at`.
   - Нет → создаём новую row.
5. **Сессия.** Через `createSession` (см. `apps/api/src/lib/sessions.ts`):
   случайный `session_id` (32 байта base64url) → row в `sessions` →
   httpOnly cookie:
   ```
   Set-Cookie: sid={session_id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000
   ```
   TTL сессии — 30 дней с rolling renewal на каждом запросе.
6. **Redirect.** 302 на `${WEB_ORIGIN}/`.

### Scopes

- `openid` — обязательно. Возвращает `sub`, `iss`, `iat`, `exp`.
- `profile` — `name`, `preferred_username`, `picture`.
- `phone` — `phone_number`. По умолчанию **НЕ запрашиваем** (требует
  отдельного consent юзера); включить точечно когда понадобится.
- `telegram:bot_access` — НЕ запрашиваем. Это разрешение боту слать DM юзеру,
  для login-only сценария излишне.

### Авторизация запросов

Middleware на каждом `/v1/*`:
- Читает cookie `sid`.
- `SELECT ... FROM sessions WHERE id = $1 AND expires_at > now()`.
- Поднимает `user_id` в контекст handler'а.
- Продлевает `expires_at` (rolling).

Нет cookie или сессия протухла → **401 Unauthorized**.

### Logout

`POST /v1/auth/logout`:
- `DELETE FROM sessions WHERE id = $1`.
- Очищает cookie (`Set-Cookie: sid=; Max-Age=0`).

Note: TG-side session не отзывается — login-flow не выдавал bot-access токен,
чистить нечего.

---

## API-keys (для внешних интеграций)

Отдельный канал, не пересекается с user-сессиями.

- Таблица `api_keys`: `{ id, workspace_id, created_by, scopes, hashed_secret, created_at, last_used_at, revoked_at }`. Секрет хранится как `sha256(secret)` — по исходной строке в БД не восстановим.
- Создание — в UI `/settings/api-keys`. Показывается один раз в виде `crmchat_pk_<public-id>_<secret>` → после закрытия модалки секрет не получить, только пересоздать.
- Проверка на каждом запросе — middleware: `Authorization: Bearer <key>` или `X-API-Key: <key>` → парсим `public-id`, сравниваем `sha256(secret)` с `hashed_secret`, обновляем `last_used_at`.
- Scope — `workspace_id`. Ключ с другого воркспейса к чужим данным не подлезет (проверяется там же, где `assertMember` для user-сессий).

---

## Error-flow

| Условие | Ответ |
|--------|-------|
| Нет cookie / протухла | `401 Unauthorized`, фронт редиректит на `/login` |
| `state` не совпал (CSRF) | `400 Bad Request` с message `oidc state mismatch` |
| `tg_oidc` cookie отсутствует / corrupted | `400 Bad Request`, юзер начинает /start заново |
| TG отдал ошибку при `token` exchange | `502 Bad Gateway` с message `telegram login failed` |
| `id_token` не прошёл JWT-валидацию | `502 Bad Gateway` (то же сообщение) |
| API-key неверный / отозван | `401 Unauthorized` c `WWW-Authenticate: Bearer error="invalid_token"` |
| API-key не имеет доступа к ресурсу | `403 Forbidden` |

---

## Критерии приёмки

- [ ] Кнопка «Войти через Telegram» на `/login` редиректит на `oauth.telegram.org/auth`, после подтверждения юзер возвращается на главный экран авторизованным.
- [ ] Повторный заход из того же браузера (с живым cookie) не требует повторного OIDC-флоу.
- [ ] Logout очищает сессию в БД и cookie; следующий запрос → 401.
- [ ] `state` CSRF-токен проверяется; подмена `state` → 400.
- [ ] PKCE `code_verifier` хранится в short-lived cookie, не передаётся в открытом виде в URL.
- [ ] `id_token` валидируется через JWKS (signature, iss, aud, exp); подменённый токен → 502.
- [ ] API-key с валидным секретом и правильным workspace-scope проходит; с неверным — 401/403.
- [ ] Протухший session (TTL) → 401, frontend показывает «Вы вышли из системы» и предлагает логин.
