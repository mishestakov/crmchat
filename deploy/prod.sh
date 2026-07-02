#!/usr/bin/env bash
# Обёртка над docker compose для ПРОДА (Yandex VM).
# Всегда подставляет ОБА compose-файла и --env-file, чтобы нельзя было забыть
# docker-compose.port.yml (gateway/IPv6/MTU) и сломать сетевую топологию.
# См. DEPLOY.md.
#
# Использование (из /opt/crmchat):
#   ./deploy/prod.sh ps
#   ./deploy/prod.sh up -d
#   ./deploy/prod.sh build
#   ./deploy/prod.sh --profile migrate run --rm api-migrate   # схема (нужен TTY: ssh -t)
#   ./deploy/prod.sh logs api --since 5m
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env.production}"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "prod.sh: нет $ENV_FILE (запускать на проде из /opt/crmchat)" >&2
  exit 1
fi

# sudo — docker на проде без него недоступен. SUDO='' чтобы отключить.
SUDO="${SUDO-sudo}"

exec $SUDO docker compose \
  --env-file "$ENV_FILE" \
  -f docker-compose.prod.yml \
  -f docker-compose.port.yml \
  "$@"
