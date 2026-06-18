#!/usr/bin/env bash
# Прод-деплой на Яндекс-VM. Единственный правильный путь: иначе легко потерять
# второй -f и поднять прод без яндекс-оверлея (IPv6/MTU/gateway). Ровно это и
# случилось с docker-compose.yandex-ipv6.yml — урезанной копией port.yml без
# MTU 1280: прод-сеть встала на MTU 1500 при пути 1400 → ICMPv6 PMTUD
# black-hole тяжёлых TG-апдейтов (инцидент 18.06.26, getUpdates timeouts).
#
# Оверлей поверх базового prod-compose:
#   docker-compose.port.yml — IPv6-сеть, MTU 1280 (фикс доставляемости TG),
#                             gateway на host-сети, сброс IPv4-форсинга.
#
# ВАЖНО: опции сети (MTU) применяются только при СОЗДАНИИ docker-сети. Если
# менялся блок networks: в compose — сперва пересоздать сеть:
#   ./deploy-yandex.sh --down   # down БЕЗ -v: volume не трогаем, миграций нет
# потом обычный ./deploy-yandex.sh. Просто up существующую сеть не пересоздаёт
# и старый MTU не поправит.
set -euo pipefail
cd "$(dirname "$0")"

compose() {
  docker compose --env-file .env.production \
    -f docker-compose.prod.yml \
    -f docker-compose.port.yml "$@"
}

if [[ "${1:-}" == "--down" ]]; then
  # Пересоздание сети: гасим без -v (данные/volume сохраняем), затем поднимаем.
  compose down
  shift
fi

compose up -d --build "$@"
