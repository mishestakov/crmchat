-- Scoped DB-роль для синка «Каналы Яндекса» (platform_active_sync.py).
-- Пишет ТОЛЬКО в platform_active_channels + platform_active_sync — основной
-- DATABASE_URL приложения джобу не даём.
--
-- Применить один раз руками на проде (init-скрипты postgres не перезапускаются
-- на существующем томе с данными). Пример:
--   docker compose --env-file .env.production -f docker-compose.prod.yml \
--     exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--     -v dbname="$POSTGRES_DB" -v pw="$PAC_SYNC_PASSWORD" \
--     -f - < yt/sql/pac_sync_role.sql
--
-- Идемпотентно: роль создаётся, если её нет; гранты можно гонять повторно.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pac_sync') THEN
    EXECUTE format('CREATE ROLE pac_sync LOGIN PASSWORD %L', :'pw');
  ELSE
    EXECUTE format('ALTER ROLE pac_sync LOGIN PASSWORD %L', :'pw');
  END IF;
END $$;

GRANT CONNECT ON DATABASE :"dbname" TO pac_sync;
-- TEMP — джоб стейджит снапшот во временную таблицу перед bulk-replace.
GRANT TEMP ON DATABASE :"dbname" TO pac_sync;
-- TRUNCATE — bulk-replace зеркала; SELECT — счётчик для guard'а.
GRANT SELECT, INSERT, TRUNCATE ON platform_active_channels TO pac_sync;
-- UPDATE — штамп меты через ON CONFLICT DO UPDATE.
GRANT SELECT, INSERT, UPDATE ON platform_active_sync TO pac_sync;
