-- Накат «Каналы Яндекса»: пересоздание производных таблиц-зеркала.
-- БЕЗОПАСНО: platform_active_channels — derived (синк перезаливает целиком),
-- бизнес-данных в ней нет; platform_active_sync — мета. channels/contacts/
-- projects/leads/messages НЕ трогаются. Применять РУКАМИ до `compose up`
-- (см. yt/DEPLOY.md). Идемпотентно: повторный прогон безопасен.
BEGIN;

DROP TABLE IF EXISTS platform_active_channels CASCADE;

CREATE TABLE platform_active_channels (
    source_key text NOT NULL,
    source text NOT NULL,
    platform text NOT NULL,
    external_id text,
    username text,
    link text,
    owner_login text,
    match_key text[] GENERATED ALWAYS AS (ARRAY[
        ((platform || ':'::text) || lower(username)),
        ((platform || ':'::text) || lower(external_id)),
        CASE WHEN ((platform = 'telegram'::text) AND (link ~* 't\.me/(joinchat/|\+)'::text))
            THEN ('telegram:+'::text || (regexp_match(link, 't\.me/(?:joinchat/|\+)([A-Za-z0-9_-]+)'::text, 'i'::text))[1]) ELSE NULL::text END,
        CASE WHEN ((platform = 'max'::text) AND (link ~* 'max\.ru/join/'::text))
            THEN ('max:+'::text || (regexp_match(link, 'max\.ru/join/([A-Za-z0-9_-]+)'::text, 'i'::text))[1]) ELSE NULL::text END
    ]) STORED,
    last_post_date date,
    recent_posts_count integer DEFAULT 0 NOT NULL,
    recent_views bigint DEFAULT 0 NOT NULL,
    bot_status text,
    is_active boolean,
    is_cpv boolean,
    moderation_status text,
    updated_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT platform_active_channels_pkey PRIMARY KEY (source_key),
    CONSTRAINT platform_active_channels_platform_check
        CHECK (platform = ANY (ARRAY['telegram', 'youtube', 'tiktok', 'dzen', 'max'])),
    CONSTRAINT platform_active_channels_source_check
        CHECK (source = ANY (ARRAY['cpc', 'cpa']))
);
CREATE INDEX platform_active_channels_match_key_idx
    ON platform_active_channels USING gin (match_key);

CREATE TABLE IF NOT EXISTS platform_active_sync (
    id text PRIMARY KEY,
    last_sync_at timestamptz,
    last_status text,
    total integer DEFAULT 0 NOT NULL
);

COMMIT;
