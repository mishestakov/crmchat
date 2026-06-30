# Синк «Каналы Яндекса» (CPC/CPA → Postgres)

Суточный джоб: тянет активность каналов с рекл-платформ Яндекса (CPC=tgads,
CPA=cpa_network) из YT и заливает в `platform_active_channels`. Питает гейт
«уже работает» в аутриче и справочник «Каналы Яндекса».

Архитектура и решения — в `specs/yt-platform-active.md`. Код — `platform_active_sync.py`.

## Состав

| Файл | Что |
|---|---|
| `platform_active_sync.py` | сам синк: YT-выгрузки → нормализация → bulk-replace + guard |
| `requirements.txt` | `ytsaurus-client` (`yt.wrapper`) + `psycopg` |
| `Dockerfile` | oneshot-образ джоба |
| `sql/pac_sync_role.sql` | scoped DB-роль `pac_sync` (только `platform_active_*`) |
| `systemd/pac-sync.{service,timer}` | планировщик на хосте |
| `sql/deploy.sql` / `sql/rollback.sql` | накат/откат таблиц-зеркала (см. DEPLOY.md) |
| `DEPLOY.md` | прод-деплой: миграции + накат/откат фичи |

## Почему так

- джоб **обязан крутиться в compose-сети** — `postgres` наружу не опубликован,
  host-native python к нему не достучится;
- поэтому это **oneshot-контейнер** (`profiles: ["jobs"]`, `up -d` его не
  поднимает), а расписание — **systemd-timer на хосте** (логи в journald,
  `Persistent=true` догоняет пропуски, `OnFailure=` для алерта). cron-в-докере
  не берём — env/PID-1-боль;
- джоб пишет **сырую идентичность**, `match_key` выводит generated-колонка в
  БД (единый источник правды матчинга с `channel-match-keys.ts`);
- отдельный юзер `pac_sync` — не основной `DATABASE_URL`.

## Установка на проде (один раз)

1. **env** (`.env.production`):
   ```
   PAC_SYNC_PASSWORD=<надёжный пароль>
   YT_TOKEN_FILE=/root/.yt/token       # путь к YT OAuth-токену на хосте
   ```
2. **scoped-роль** в Postgres:
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml \
     exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -v dbname="$POSTGRES_DB" -v pw="$PAC_SYNC_PASSWORD" \
     -f - < yt/sql/pac_sync_role.sql
   ```
3. **проверка вручную** (соберёт образ и прогонит синк):
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml \
     --profile jobs run --rm pac-sync
   ```
   Сначала можно `--dry-run` (не пишет БД):
   ```bash
   docker compose ... --profile jobs run --rm pac-sync --dry-run
   ```
4. **расписание** (systemd):
   ```bash
   sudo cp yt/systemd/pac-sync.service yt/systemd/pac-sync.timer /etc/systemd/system/
   # поправь WorkingDirectory в pac-sync.service под путь репо
   sudo systemctl daemon-reload
   sudo systemctl enable --now pac-sync.timer
   systemctl list-timers pac-sync.timer        # проверить следующий запуск
   journalctl -u pac-sync.service -f           # логи прогона
   ```

## Проверить результат

Страница **«Каналы Яндекса»** в приложении: шапка покажет «Обновлено N назад · X
записей». Если синк упал на guard'е (пустая/усохшая выгрузка) — данные остаются
прошлые, а на странице жёлтая плашка с текстом из `platform_active_sync.last_status`.
