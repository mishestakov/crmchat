# Прод-деплой: миграции схемы + фича «Каналы Яндекса»

## Модель миграций (с этого изменения)

Авто-`drizzle-kit push --force` из `api-migrate` **убран**: force сравнивал всю
схему и при дрейфе мог молча снести данные. Прод живёт с данными → схему
применяем **осознанно**, не на каждый `up`:

- **обычные (аддитивные) изменения** — интерактивный `push` руками, он
  показывает дифф и спрашивает перед дропами:
  ```bash
  docker compose --env-file .env.production -f docker-compose.prod.yml \
    --profile migrate run --rm api-migrate
  ```
- **деструктивные** (смена типа колонки, дроп) — явным SQL-скриптом, не через
  push (push на такое спросил бы неудобно/непредсказуемо).

`docker compose up -d` сам схему больше **не трогает**.

## Накат фичи «Каналы Яндекса»

Меняются только **производные таблицы-зеркала** (`platform_active_channels`,
`platform_active_sync`) — бизнес-данные (channels/contacts/projects/leads/
messages) не трогаются.

1. Задеплоить код (pull / checkout тега).
2. Применить схему руками (тут деструктив — `match_key` сменил тип `text→text[]`):
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml \
     exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -f - < yt/sql/deploy.sql
   ```
3. Поднять приложение:
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
   ```
4. Завести синк (один раз) — scoped-роль, env, systemd-таймер: см. **yt/README.md**.
   До первого прогона синка справочник «Каналы Яндекса» и бейдж пустые — безвредно.

## Откат

1. Вернуть старую форму таблицы-зеркала (под старый код):
   ```bash
   docker compose --env-file .env.production -f docker-compose.prod.yml \
     exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
     -f - < yt/sql/rollback.sql
   ```
2. Задеплоить прошлый код + `up -d --build`. Снятие гейта откатывается само
   (это просто старый код). Реальные данные не теряются (зеркало).
3. Остановить/снять systemd-таймер синка, если ставили.

Асимметрии нет: и накат, и откат — один ручной SQL по мирор-таблице (тип колонки
меняется, push сам не умеет). Безопасно, т.к. данные derived.
