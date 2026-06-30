-- Откат «Каналы Яндекса»: вернуть СТАРУЮ форму таблицы-зеркала под старый код
-- (PK tg_chat_id, скалярный match_key). БЕЗОПАСНО: derived-данные, бизнес-
-- таблицы не трогаются. Применять РУКАМИ перед деплоем старого кода.
BEGIN;

DROP TABLE IF EXISTS platform_active_channels CASCADE;
DROP TABLE IF EXISTS platform_active_sync;

CREATE TABLE platform_active_channels (
    tg_chat_id text PRIMARY KEY,
    source text NOT NULL,
    match_key text,
    updated_at timestamptz DEFAULT now() NOT NULL
);
CREATE INDEX platform_active_channels_match_key_idx
    ON platform_active_channels (match_key);

COMMIT;
