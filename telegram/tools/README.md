# Fork-base detection tooling

Three-step pipeline that pins an obfuscated webpack bundle back to an exact upstream commit and lists per-file diffs. Used to identify that `tg-client.crmchat.ai` is a fork of `Ajaxy/telegram-tt` at commit `60aaf900` (v12.0.22, 2026-04-08).

## Prerequisites

- Node.js.
- `git` on PATH.
- A published sourcemap for the bundle (`main.*.js.map` with `sourcesContent: true`).
- A local clone of the suspected upstream repo.

## Pipeline

```bash
# 1. Download bundle + sourcemap.
curl -sO https://tg-client.crmchat.ai/main.de7f9b53a55223e896f0.js.map

# 2. Reconstruct sources from sourcemap.
node extract-sources.js main.de7f9b53a55223e896f0.js.map ./fork-src

# 3. Clone the suspected upstream.
git clone --filter=blob:none https://github.com/Ajaxy/telegram-tt ./telegram-tt

# 4. Find the fork base: score every upstream commit by blob-SHA equality.
node fp.js ./fork-src ./telegram-tt --since=2025-01-01 --ref=origin/master
#  → prints top-10 candidate commits and writes fp-results.json

# 5. Enumerate what the fork changed against that base.
node diff.js ./fork-src ./telegram-tt <BASE_COMMIT_SHA>
#  → prints ADDED / MODIFIED lists and writes fork-modified.json

# 6. Produce a real patch for visual inspection.
for f in $(node -e "const j=require('./fork-modified.json'); j.modified.forEach(p=>console.log(p))"); do
  U=$(mktemp)
  git -C ./telegram-tt show <BASE>:$f > "$U" 2>/dev/null
  diff -u --label "a/$f" --label "b/$f" "$U" "./fork-src/$f"
  rm "$U"
done > fork.patch
```

## Why this beats checkout-and-diff

Naive approach: `for commit in history; do git checkout; overlay fork; git diff --stat; done` and pick argmin. Correct but takes minutes-to-hours on a repo with thousands of commits.

This approach: for each commit do one `git ls-tree -r` (dumps the whole tree as `path → blob-SHA` in one pass) and count byte-equal matches. Two files with equal blob SHAs are byte-for-byte equal by SHA-1 collision resistance. No line diff, no checkout, no working tree churn — the same argmax in ~30 s.

## Notes

- False positives in "modified" list: for webpack's CSS-modules, sourcemaps contain shim modules like `{"root":"omYjO7To",...}` at `*.module.scss` paths — not the real SCSS. Ignore `.module.scss` entries when counting real changes.
- The fork base is unambiguous only if the top score is unique. A plateau of N coincident top-scorers means those N commits don't touch any file the fork modified — fork was cut somewhere inside that window; the latest commit of the plateau is the safest pick.
