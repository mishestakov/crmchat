---
story: AUTH
title: Аутентификация (shared pre-condition)
stage: 0 (infra, до любой US)
---

# AUTH · Аутентификация

Shared pre-condition для всех `US-*`. Любой `/_protected/*` требует активной server-side сессии.

## Канал входа: Яндекс OAuth2

Единственный путь логина — OAuth 2.0 Authorization Code Flow с Яндекс ID.

### Регистрация приложения

В [oauth.yandex.ru](https://oauth.yandex.ru) создаётся приложение:
- **Redirect URI**: `https://<домен>/auth/yandex/callback`
- **Scopes**: `login:email login:info` (этого достаточно для идентификации; avatar по желанию `login:avatar`)
- Сохраняются `client_id` и `client_secret` — `client_secret` живёт только в серверных переменных окружения.

### Flow

1. **Старт.** Пользователь нажимает «Войти через Яндекс» на `/login`.
   Клиент делает `GET /auth/yandex/start`.
   Бэкенд генерит `state` (CSRF-токен, кладёт в короткоживущий cookie) и 302-редиректит на:
   ```
   https://oauth.yandex.ru/authorize
     ?response_type=code
     &client_id={CLIENT_ID}
     &redirect_uri={REDIRECT_URI}
     &scope=login:email+login:info
     &state={STATE}
   ```
2. **Подтверждение.** Пользователь видит стандартный экран согласия Яндекса, подтверждает.
3. **Callback.** Яндекс редиректит на `/auth/yandex/callback?code=...&state=...`.
   Бэкенд:
   - Проверяет `state` против cookie (CSRF).
   - `POST oauth.yandex.ru/token` с `grant_type=authorization_code`, `code`, `client_id`, `client_secret`, `redirect_uri` → `{ access_token, ... }`.
   - `GET login.yandex.ru/info?format=json` с `Authorization: OAuth {access_token}` → `{ id, login, default_email, first_name, last_name, ... }`.
4. **Матчинг пользователя.** По `default_email` ищем запись в `users`:
   - Найдено → обновляем profile-поля (имя, avatar).
   - Нет → создаём нового пользователя.
5. **Сессия.** Генерим случайный `session_id` (32 байта, base64url), пишем в таблицу `sessions` (`{ id, user_id, created_at, expires_at, user_agent, ip }`), ставим httpOnly cookie:
   ```
   Set-Cookie: sid={session_id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000
   ```
   TTL сессии — 30 дней с rolling renewal на каждом запросе.
6. **Redirect.** Бэкенд 302 на `/` или на сохранённый `returnTo`.

### Авторизация запросов

Middleware на каждом `/v1/*`:
- Читает cookie `sid`.
- `SELECT ... FROM sessions WHERE id = $1 AND expires_at > now()`.
- Поднимает `user_id` в контекст handler'а.
- Продлевает `expires_at` (rolling).

Нет cookie или сессия протухла → **401 Unauthorized**.

### Logout

`POST /auth/logout`:
- `DELETE FROM sessions WHERE id = $1`.
- Очищает cookie (`Set-Cookie: sid=; Max-Age=0`).

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
| `state` не совпал (CSRF) | `400 Bad Request`, экран «Сессия авторизации устарела, попробуйте ещё раз» |
| Яндекс отдал ошибку при `token` exchange | `502 Bad Gateway`, экран «Не удалось войти, попробуйте позже» |
| API-key неверный / отозван | `401 Unauthorized` c `WWW-Authenticate: Bearer error="invalid_token"` |
| API-key не имеет доступа к ресурсу | `403 Forbidden` |

---

## Критерии приёмки

- [ ] Успешный OAuth flow создаёт сессию и редиректит на главный экран без ручных шагов.
- [ ] Повторный заход из того же браузера (с живым cookie) не требует повторного OAuth.
- [ ] Logout очищает сессию в БД и cookie; следующий запрос → 401.
- [ ] `state` CSRF-токен проверяется; подмена `state` → 400.
- [ ] API-key с валидным секретом и правильным workspace-scope проходит; с неверным — 401/403.
- [ ] Протухший session (TTL) → 401, frontend показывает «Вы вышли из системы» и предлагает логин.
