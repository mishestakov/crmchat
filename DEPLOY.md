# Деплой прода

Прод крутится на **Yandex VM** `mikeshestakov-vm-654378825.sas.yp-c.yandex.net`,
каталог `/opt/crmchat`. Docker — только через `sudo`.

## ⚠️ Главное правило: ВСЕГДА два compose-файла

```
-f docker-compose.prod.yml -f docker-compose.port.yml
```

`docker-compose.port.yml` **не опциональный**. В нём живёт то, без чего прод —
не прод:

- сервис **`gateway`** (nginx, `network_mode: host`, внешний вход `:3102`) —
  его нет в `prod.yml` вообще;
- **IPv6-сеть** `crmchat_default` (`enable_ipv6: true`, `fd00:3102::/64`) и
  **MTU 1280** (иначе тяжёлые TG-апдейты чёрно-дырятся);
- пиннинг `api.telegram.org` через Yandex **NAT64**, сброс IPv4-форсинга.

> Шапка `docker-compose.prod.yml` описывает ДРУГОЙ хост (tgdesk.su на Timeweb:
> Caddy, IPv4-only, команда с одним файлом). **Не** копируй её команды на
> Yandex-VM — одиночный `-f docker-compose.prod.yml` ломает сетевую топологию.

Чтобы не держать это в голове — есть обёртка [`deploy/prod.sh`](deploy/prod.sh),
которая сама подставляет оба файла и `--env-file`:

```bash
cd /opt/crmchat
./deploy/prod.sh ps
./deploy/prod.sh up -d
```

## Канонический деплой (код + аддитивная схема)

```bash
cd /opt/crmchat
DC="sudo docker compose --env-file .env.production \
      -f docker-compose.prod.yml -f docker-compose.port.yml"

# 0. Бэкап БД (всегда перед схемой)
$DC exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  > ~/crmchat_backup_$(date +%Y%m%d_%H%M%S).sql

# 1. Свежий код
git pull --ff-only

# 2. Собрать образы из нового кода (api собирает TDLib — небыстро)
$DC build

# 3. Применить схему (аддитивно). drizzle-kit push ИНТЕРАКТИВЕН → нужен TTY (ssh -t).
#    Деструктив (смена типа колонки, дроп) — НЕ через push, а явным yt/sql/*.sql. См. yt/DEPLOY.md.
$DC --profile migrate run --rm api-migrate

# 4. Поднять новые образы
$DC up -d
```

`up -d` схему **не трогает** (профиль `migrate` не поднимается сам). `pac-sync`
(суточный синк «Каналы Яндекса») тоже за профилем `jobs` — вручную.

## Грабли (проверено 2026-07-02, живой инцидент)

1. **`down`/`up`/`run` одним файлом = поломка.** Compose видит другой проектный
   граф и «чинит» топологию: сносит `gateway`, пересоздаёт сеть без IPv6/MTU.
2. **Потеря DNS-алиаса.** После кривого пересоздания сети контейнер `postgres`
   может остаться без service-алиаса → `api` ловит `getaddrinfo ENOTFOUND
   postgres`, все запросы к сессиям падают, пользователей разлогинивает.
   - Диагностика: `sudo docker inspect crmchat-postgres-1 --format '{{range .NetworkSettings.Networks}}{{.Aliases}}{{end}}'` → должно быть `[crmchat-postgres-1 postgres]`, не `[]`.
   - Починка: `./deploy/prod.sh up -d --force-recreate` (обоими файлами).
3. **`run --rm api-migrate` — тоже с обоими файлами.** Иначе п.1.
4. **После `git pull` образы НЕ обновляются сами.** Нужен `build` + `up -d`.
   Пока не пересобрал — крутится старый код (это норм, не аварийно).

## Проверка «жив ли прод»

```bash
./deploy/prod.sh ps                                    # 4 сервиса Up, postgres healthy
curl -s -o /dev/null -w '%{http_code}\n' localhost:3102/         # 200 (внешний вход)
curl -s localhost:3102/v1/auth/me                      # {"message":"no session"} 401 = ОК (API живой)
sudo docker exec crmchat-api-1 getent hosts postgres   # резолвится в fd00:3102::...
./deploy/prod.sh logs api --since 2m | grep -ic error  # 0
```

API-путь наружу — **`/v1/`** (не `/api/`). gateway: `/v1/`→api:3000, `/`→web:8081.

## Откат

Код — `git checkout <прошлый тег/коммит>` + `build` + `up -d` (оба файла).
Схема — см. `yt/DEPLOY.md` (мирор-таблицы derived, откат — ручной SQL).
БД — из дампа: `$DC exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < backup.sql`.
