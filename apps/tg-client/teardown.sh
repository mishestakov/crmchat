#!/usr/bin/env bash
# Удаляет всё что создано setup.sh, оставляя только наш custom-set.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

# Безопасный список того что мы храним в репо.
KEEP=(
  "setup.sh"
  "teardown.sh"
  "patches"
  "UPSTREAM.md"
  "CRMCHAT.md"
  "README.md"
  ".gitignore"
)

echo "[teardown] Удаляю всё кроме: ${KEEP[*]}"
cd "$DIR"
for entry in * .[!.]*; do
  if [ -e "$entry" ]; then
    keep=0
    for k in "${KEEP[@]}"; do
      [ "$entry" = "$k" ] && keep=1 && break
    done
    if [ "$keep" -eq 0 ]; then
      rm -rf "$entry"
    fi
  fi
done

echo "[teardown] Готово. Чтобы поднять обратно: ./setup.sh"
