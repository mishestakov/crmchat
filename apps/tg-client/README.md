# apps/tg-client

Форк [Telegram Web A](https://github.com/Ajaxy/telegram-tt) (TWA) для встраивания
в наш CRM как iframe.

**В git коммитим только bootstrap + патч**, не кодовую базу TWA. Так чище для
ревью, нет 100MB+ чужого кода в нашей репе.

## Поднять локально

```bash
cd apps/tg-client
./setup.sh         # склонит upstream@SHA + apply patches/crmchat.patch
npm install        # ~5–10 минут, ~600MB node_modules
npm run dev        # webpack-dev-server на http://localhost:1234
```

## Снести (вернуть к коммитному состоянию)

```bash
./teardown.sh      # удалит всё кроме setup/teardown/patches/*.md/.gitignore
```

## Что менять / зачем менять

См.:
- [`CRMCHAT.md`](./CRMCHAT.md) — какие файлы upstream мы патчим и зачем
- [`UPSTREAM.md`](./UPSTREAM.md) — какой commit upstream мы зафиксировали + как обновляться
- [`patches/crmchat.patch`](./patches/crmchat.patch) — единый diff (12 файлов: 11 модифицированных + 1 новый `src/util/crmchat.ts`)

## Регенерация патча после редактирования

После того как поправил что-то в файлах upstream'а (т.е. после `setup.sh` ты
лазил в `src/...`), обнови `patches/crmchat.patch`. Удобный one-shot:

```bash
SHA=$(grep '^UPSTREAM_SHA=' setup.sh | cut -d'"' -f2)
TMP=$(mktemp -d)
git -C "$TMP" init -q twa-clean && cd "$TMP/twa-clean"
git remote add origin https://github.com/Ajaxy/telegram-tt
git fetch --depth=1 origin "$SHA" -q && git checkout -q FETCH_HEAD
rm -rf .git dist
diff -urN \
  --exclude='.git' --exclude='dist' --exclude='node_modules' \
  --exclude='UPSTREAM.md' --exclude='CRMCHAT.md' --exclude='README.md' \
  --exclude='setup.sh' --exclude='teardown.sh' --exclude='patches' --exclude='.gitignore' \
  "$TMP/twa-clean" /home/mike/crmchat/apps/tg-client \
  > /home/mike/crmchat/apps/tg-client/patches/crmchat.patch
sed -i \
  -e "s|^--- $TMP/twa-clean/|--- a/|" \
  -e "s|^+++ /home/mike/crmchat/apps/tg-client/|+++ b/|" \
  -e 's|^diff -urN.*$|diff (CRMchat patch)|' \
  /home/mike/crmchat/apps/tg-client/patches/crmchat.patch
```

## Обновить upstream до новой версии

См. [`UPSTREAM.md`](./UPSTREAM.md).
