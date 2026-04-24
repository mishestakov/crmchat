# TWA upstream

Вендорим [Ajaxy/telegram-tt](https://github.com/Ajaxy/telegram-tt) — официальный
Telegram Web A.

Базовая отметка vendor'инга:

- **commit:** `e5da72b5e0406194d1de077b6cbb363f460b79c7` (master, `[Build]`)
- **package.json version:** `12.0.25`
- **дата vendor'инга:** 2026-04-24

Удалено при vendor'инге:
- `.git/` — был nested-repo, конфликтовал с outer monorepo.
- `dist/` — billd-артефакт, генерится `npm run build:dev`.

`node_modules/` и `dist/` находятся в outer-`.gitignore`, не коммитятся.

## Как обновить с upstream

Патчей у нас немного (см. CRMCHAT.md). Процесс:

```bash
# 1. Свежий клон в /tmp.
cd /tmp && git clone https://github.com/Ajaxy/telegram-tt twa-fresh && cd twa-fresh

# 2. Зафиксируй новую целевую SHA (HEAD master или конкретный тег).
NEW_SHA=$(git rev-parse HEAD)

# 3. Diff между нашей текущей vendored-копией и фрешем.
diff -ru /home/mike/crmchat/apps/tg-client . > /tmp/upstream.diff

# 4. Read /tmp/upstream.diff, проверь не сломал ли upstream наши патчи (CRMCHAT.md).
#    Конфликты разрули вручную.

# 5. Перенеси новые файлы в наш apps/tg-client/.
#    Сохрани наш .gitignore, наш UPSTREAM.md, наш CRMCHAT.md, наш src/util/crmchat.ts.

# 6. Обнови SHA + version + дату выше.
```

Чтобы найти что именно поменяло upstream в файлах что мы трогали:

```bash
git -C /tmp/twa-fresh diff e5da72b..HEAD -- src/util/sessions.ts src/config.ts ...
```
