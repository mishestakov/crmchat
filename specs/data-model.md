# Data model

PostgreSQL-схема. Sсurce of truth — Drizzle-определения в `api/src/db/schema/*.ts`, этот документ — человеческий обзор.

Принципы:
- **UUID v7** для всех `id` — монотонные, индекс-friendly, 36 символов.
- **Timestamps** — `timestamp with time zone`, сериализуются в ISO-8601 на API.
- **Soft delete** не применяем; удаление — `DELETE` (кроме `workspaces`, где каскад через `ON DELETE CASCADE`).
- **`workspace_id`** в каждой доменной таблице — security boundary (см. `permissions.md`).
- **`jsonb`** для динамических custom properties и конфигов, которые не нужно индексировать поштучно.

---

## 1. Users / сессии / API-keys

### `users`
| Колонка | Тип | Примечание |
|---|---|---|
| `id` | uuid (pk) | |
| `email` | text, unique, not null | из Яндекс OAuth `default_email` |
| `name` | text | первое + фамилия из OAuth |
| `avatar_url` | text, nullable | |
| `timezone` | text, not null, default `'Europe/Moscow'` | IANA |
| `telegram_username` | text, nullable | если подтверждён через personal sync |
| `yandex_id` | text, unique, nullable | `id` из `login.yandex.ru/info` |
| `created_at`, `updated_at` | timestamptz | |

### `sessions`
| Колонка | Тип |
|---|---|
| `id` | text (pk, 32-byte base64url) |
| `user_id` | uuid → `users.id` ON DELETE CASCADE |
| `user_agent` | text |
| `ip` | inet |
| `created_at`, `expires_at` | timestamptz, indexed по `expires_at` |

### `api_keys`
| Колонка | Тип |
|---|---|
| `id` | uuid (pk) |
| `workspace_id` | uuid → `workspaces.id` ON DELETE CASCADE |
| `public_id` | text, unique | префикс в `crmchat_pk_<public-id>_<secret>` |
| `hashed_secret` | text, not null | `sha256(secret)` |
| `created_by` | uuid → `users.id` |
| `scopes` | text[] |
| `created_at`, `last_used_at`, `revoked_at` | timestamptz |

---

## 2. Workspaces

`organizations` у нас нет (см. `DECISIONS.md` «Без organizations»). Workspace — top-level tenant. Если когда-нибудь появится multi-tenant биллинг или wallet — пересоздадим уровень над workspace явной миграцией.

### `workspaces`
| Колонка | Тип |
|---|---|
| `id` | uuid (pk) |
| `name` | text, not null |
| `created_by` | uuid → `users.id` (audit-метадата, в access-проверках не участвует) |
| `created_at`, `updated_at` | timestamptz |

### `workspace_members`
| Колонка | Тип |
|---|---|
| `workspace_id` | uuid → `workspaces.id` ON DELETE CASCADE |
| `user_id` | uuid → `users.id` ON DELETE CASCADE |
| `role` | enum `workspace_role` (`admin` / `member`) |
| `created_at` | timestamptz |

PK: `(workspace_id, user_id)`. Индекс по `user_id` для «мои воркспейсы».

### `workspace_invites`
| Колонка | Тип |
|---|---|
| `id` | uuid (pk) |
| `workspace_id` | uuid → `workspaces.id` ON DELETE CASCADE |
| `telegram_username` | text | кому отправлено |
| `role` | enum `workspace_role` |
| `code` | text, unique | в URL `/accept-invite/{ws}/{code}` |
| `created_by` | uuid → `users.id` |
| `created_at`, `expires_at` | timestamptz |
| `accepted_at` | timestamptz, nullable |

Expiry обрабатывает pg-boss schedule (`cleanup_expired_invites` раз в час).

---

## 3. Properties / contacts / activities

### `properties` (кастомные поля контакта)
| Колонка | Тип |
|---|---|
| `id` | uuid (pk) |
| `workspace_id` | uuid → `workspaces.id` ON DELETE CASCADE |
| `key` | text, not null | `custom.<short>` или системный (`stage`, `owner`) |
| `name` | text, not null |
| `type` | enum (`text`, `number`, `date`, `single_select`, `multi_select`) |
| `color` | text | палитра из 10 значений |
| `required` | bool, default false |
| `show_in_list` | bool, default true |
| `system` | bool, default false | `true` запрещает delete |
| `object_type` | enum (`contact`), default `contact` | задел на расширение |
| `order` | integer | для drag-n-drop |
| `values` | jsonb | `[{id, name, color}]` для `*_select` |
| `created_at`, `updated_at` | timestamptz |

Unique `(workspace_id, key)`.

### `contacts`
| Колонка | Тип |
|---|---|
| `id` | uuid (pk) |
| `workspace_id` | uuid → `workspaces.id` ON DELETE CASCADE |
| `name` | text |
| `telegram_username` | text, nullable |
| `email`, `phone`, `url` | text, nullable |
| `short_description`, `description` | text, nullable |
| `avatar_url` | text, nullable |
| `stage` | text, nullable | значение из `properties.stage.values[].id` |
| `properties` | jsonb, default `'{}'` | `{ "custom.<id>": value, ... }` |
| `created_by` | uuid → `users.id` |
| `created_at`, `updated_at` | timestamptz |

Индексы: `(workspace_id)`, `(workspace_id, telegram_username)`, GIN по `properties`.

### `activities`
| Колонка | Тип |
|---|---|
| `id` | uuid (pk) |
| `workspace_id` | uuid → `workspaces.id` ON DELETE CASCADE |
| `contact_id` | uuid → `contacts.id` ON DELETE CASCADE |
| `type` | enum (`note`, `reminder`) |
| `text` | text |
| `date` | timestamptz, nullable | для `reminder` |
| `repeat` | text, nullable | `none` / `daily` / `weekly` / `monthly` |
| `status` | enum (`open`, `completed`), default `open` |
| `completed_at` | timestamptz, nullable |
| `created_by` | uuid → `users.id` |
| `created_at` | timestamptz |

Индекс: `(workspace_id, contact_id)`, `(workspace_id, status, date)` для напоминаний.

---

## 4. Outreach

### `outreach_lists`
| Колонка | Тип |
|---|---|
| `id` | uuid (pk) |
| `workspace_id` | uuid → `workspaces.id` ON DELETE CASCADE |
| `name` | text |
| `source_type` | enum (`csv_file`, `crm`, `groups`) |
| `source` | jsonb | структура зависит от `source_type` (см. ниже) |
| `status` | enum (`pending`, `ready`, `failed`) |
| `created_by` | uuid → `users.id` |
| `created_at`, `updated_at` | timestamptz |

`source` для `csv_file`: `{ file_key, file_name, username_column, phone_column, columns: [...] }`.
`source` для `crm`: `{ filters: [{property, op, value}], mode: "dynamic" | "one_shot" }`.
`source` для `groups`: `{ group_ids: [...] }`.

### `outreach_sequences`
| Колонка | Тип |
|---|---|
| `id` | uuid (pk) |
| `workspace_id` | uuid → `workspaces.id` ON DELETE CASCADE |
| `list_id` | uuid → `outreach_lists.id` ON DELETE RESTRICT |
| `name` | text |
| `status` | enum (`draft`, `active`, `paused`) |
| `messages` | jsonb | `[{text, delay_days, attachments: [{file_key, mime}]}]` |
| `accounts` | jsonb | `{ mode: "all" | "selected", selected: [account_id] }` |
| `contact_settings` | jsonb | `{ create_contact_trigger: "on_reply" | "on_first_send", default_owners: [uid], defaults: {stage, "custom.xxx": ...} }` |
| `created_by` | uuid → `users.id` |
| `created_at`, `updated_at` | timestamptz |

### `outreach_leads`
Участник кампании (один контакт × один list).

| Колонка | Тип |
|---|---|
| `id` | uuid (pk) |
| `workspace_id` | uuid → `workspaces.id` ON DELETE CASCADE |
| `list_id` | uuid → `outreach_lists.id` ON DELETE CASCADE |
| `contact_id` | uuid → `contacts.id`, nullable | создаётся позже по триггеру |
| `status` | enum (`queued`, `sent`, `read`, `replied`, `failed`) |
| `csv_fields` | jsonb | исходные колонки из CSV (`{first_name, phone, ...}`) |
| `properties` | jsonb | overrides для конкретного lead'а |
| `messages_sent` | jsonb | `[{step, msg_id, sent_at, read_at, replied_at}]` |
| `error` | text, nullable | |
| `created_at`, `updated_at` | timestamptz |

Индексы: `(workspace_id, list_id)`, `(workspace_id, status)`, `(contact_id)` where not null.

---

## 5. Telegram

### `telegram_accounts` (outreach pool)
| Колонка | Тип |
|---|---|
| `id` | uuid (pk) |
| `workspace_id` | uuid → `workspaces.id` ON DELETE CASCADE |
| `phone_number` | text |
| `status` | enum (`active`, `unauthorized`, `banned`, `flood_wait`) |
| `proxy_country_code` | text, nullable | `ru`, `us`, … |
| `warmup_enabled` | bool, default false |
| `daily_limit` | integer, default 40 |
| `auto_create_leads` | bool, default true |
| `session` | jsonb | MTProto auth-key: `{ main_dc_id, is_test, keys: {dc: hex}, hashes: {dc: hex} }` |
| `created_by` | uuid → `users.id` |
| `created_at`, `updated_at` | timestamptz |

### `telegram_personal_syncs` (US-9)
| Колонка | Тип |
|---|---|
| `user_id` | uuid → `users.id` ON DELETE CASCADE |
| `workspace_id` | uuid → `workspaces.id` ON DELETE CASCADE |
| `session` | jsonb | как у `telegram_accounts.session` |
| `created_at`, `updated_at` | timestamptz |

PK: `(user_id, workspace_id)`. Session шифруется at-rest через колоночное шифрование (см. ниже).

### `telegram_messages`
Реплика сообщений для чата (US-10) — отдельно от MTProto-потока, чтобы быстро рисовать историю.

| Колонка | Тип |
|---|---|
| `id` | uuid (pk) |
| `workspace_id` | uuid → `workspaces.id` ON DELETE CASCADE |
| `account_id` | uuid → `telegram_accounts.id`, nullable | `null` = personal sync |
| `user_id` | uuid → `users.id`, nullable | для personal sync |
| `chat_id` | text | TG peer id |
| `tg_message_id` | bigint |
| `direction` | enum (`in`, `out`) |
| `text` | text |
| `attachments` | jsonb |
| `sent_at`, `read_at` | timestamptz |
| `created_at` | timestamptz |

Индексы: `(workspace_id, chat_id, sent_at desc)`, unique `(account_id, chat_id, tg_message_id)`.

---

## 6. Files (метаданные uploads)

S3-объекты хранятся в Yandex Object Storage / MinIO; в БД — только метаданные.

### `files`
| Колонка | Тип |
|---|---|
| `id` | uuid (pk) |
| `workspace_id` | uuid → `workspaces.id` ON DELETE CASCADE |
| `key` | text, unique | `w/{ws}/outreach/leads/{uuid}.csv` |
| `mime_type` | text |
| `size_bytes` | bigint |
| `uploaded_by` | uuid → `users.id` |
| `uploaded_at` | timestamptz |

Пути:
- CSV: `w/{ws}/outreach/leads/{uuid}.csv`
- Медиа-вложения: `w/{ws}/outreach/media/{uuid}.{ext}`
- Аватарки контактов: `w/{ws}/avatars/{contact_id}.{ext}`
- Аватарки пользователей: `u/{user_id}/avatar.{ext}`

---

## 7. Очередь фоновых задач

pg-boss создаёт свою схему `pgboss` автоматически (таблицы `pgboss.job`, `pgboss.schedule` и т.п.). Наши jobs именуются `domain.action`:

| Job | Назначение |
|---|---|
| `outreach.dispatch_step` | отправить очередной шаг sequence конкретному lead'у |
| `outreach.process_csv` | парсинг CSV → создание `outreach_leads` |
| `telegram.sync_dialogs` | периодический pull диалогов для personal sync |
| `cleanup.expired_invites` | schedule cron: `0 * * * *` |
| `cleanup.expired_sessions` | schedule cron: `0 3 * * *` |

---

## 8. Шифрование at-rest

`telegram_accounts.session` и `telegram_personal_syncs.session` хранят MTProto auth-keys — компрометация даёт полный доступ к TG-аккаунту. Применяем колоночное шифрование через pgcrypto:

```sql
INSERT ... session = pgp_sym_encrypt($1::text, current_setting('app.encryption_key'))
SELECT pgp_sym_decrypt(session, current_setting('app.encryption_key'))::jsonb FROM ...
```

Ключ — в ENV `APP_ENCRYPTION_KEY`, пробрасывается в сессию Postgres через `SET app.encryption_key = ...` в начале транзакции.

---

## 9. Real-time триггеры

Postgres-триггеры для SSE (см. `architecture.md` §3):

```sql
CREATE FUNCTION notify_chat_message() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify(
    'chat:' || NEW.workspace_id::text,
    json_build_object('chat_id', NEW.chat_id, 'message_id', NEW.id)::text
  );
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER telegram_messages_notify
  AFTER INSERT ON telegram_messages
  FOR EACH ROW EXECUTE FUNCTION notify_chat_message();
```

Аналогично для `outreach_leads` (канал `outreach:<ws>`) — для live-экрана кампании.

---

## 10. Enums — единый перечень

| Enum | Значения |
|---|---|
| `workspace_role` | `admin`, `member` |
| `property_type` | `text`, `number`, `date`, `single_select`, `multi_select` |
| `property_object_type` | `contact` |
| `activity_type` | `note`, `reminder` |
| `activity_status` | `open`, `completed` |
| `outreach_list_source` | `csv_file`, `crm`, `groups` |
| `outreach_list_status` | `pending`, `ready`, `failed` |
| `outreach_sequence_status` | `draft`, `active`, `paused` |
| `outreach_lead_status` | `queued`, `sent`, `read`, `replied`, `failed` |
| `telegram_account_status` | `active`, `unauthorized`, `banned`, `flood_wait` |
| `message_direction` | `in`, `out` |

Определяются в Drizzle `pgEnum`, дублируются в `@repo/core` как Zod-enum'ы.
