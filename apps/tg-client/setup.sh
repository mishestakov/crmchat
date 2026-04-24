#!/usr/bin/env bash
# Bootstrap apps/tg-client/: clone TWA upstream + apply CRMchat patch.
# В git коммитим только setup.sh + patches/ + наши .md. Сама кодовая база
# upstream не в репозитории.
set -euo pipefail

UPSTREAM_REPO="https://github.com/Ajaxy/telegram-tt"
UPSTREAM_SHA="e5da72b5e0406194d1de077b6cbb363f460b79c7"
DIR="$(cd "$(dirname "$0")" && pwd)"
PATCH="$DIR/patches/crmchat.patch"
MARKER="$DIR/.crmchat-patched"

if [ -f "$MARKER" ]; then
  echo "[setup] tg-client уже инициализирован."
  echo "        Хочешь переинициализировать — сначала: ./teardown.sh"
  exit 0
fi
# Если src/ есть, но marker нет — partial-failure от прошлого запуска. Сносим.
if [ -d "$DIR/src" ]; then
  echo "[setup] Найдены остатки от неудачного setup'а. Сношу..."
  "$DIR/teardown.sh"
fi

echo "[setup] Клонирую TWA @$UPSTREAM_SHA..."
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# git fetch by SHA: shallow + конкретный коммит
git -C "$TMP" init -q twa
cd "$TMP/twa"
git remote add origin "$UPSTREAM_REPO"
git fetch --depth=1 origin "$UPSTREAM_SHA" -q
git checkout -q FETCH_HEAD
rm -rf .git dist

echo "[setup] Копирую upstream-код в $DIR/ (cp -n, не трогаем наши custom-файлы)..."
# `-n` no-clobber: README.md, .gitignore, CRMCHAT.md, UPSTREAM.md, setup.sh,
# teardown.sh, patches/ — они уже есть в нашем git'е и должны остаться.
shopt -s dotglob
cp -rn "$TMP/twa/"* "$DIR/"
shopt -u dotglob

echo "[setup] Применяю CRMchat-патч..."
cd "$DIR"
if ! patch -p1 --no-backup-if-mismatch < "$PATCH"; then
  echo ""
  echo "[setup] ERROR: patch не применился чисто."
  echo "        Возможно UPSTREAM_SHA в setup.sh устарел (upstream ушёл вперёд)."
  echo "        См. UPSTREAM.md — раздел «Как обновить»."
  exit 1
fi

touch "$MARKER"
echo ""
echo "[setup] Готово."
echo "        Дальше: cd $DIR && npm install && npm run dev"
