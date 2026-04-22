# Capture

Passive CDP-based capture. Chrome runs with persistent profile, you click through scenarios, everything is recorded.

## Files

```
tools/capture/
├── profile/                 # Chrome user-data-dir (login persists)
├── raw/session-*.jsonl      # every CDP event — never touched, source of truth
├── processed/
│   ├── routes/<id>/         # screenshots, DOM snapshots, history per visit
│   └── rpc/<proc>/          # one .json per call (req + resp body)
├── state.json               # checklist progress — survives restarts
└── src/
    ├── launch-chrome.ts     # starts Chrome on port 9222 with profile
    ├── capture.ts           # attaches to Chrome, records, serves dashboard
    └── rebuild.ts           # rebuilds processed/rpc/ from raw/ (no re-clicking)
```

## Usage

```
cd tools/capture
npm install

# Terminal A — starts Chrome with persistent profile on port 9222
npm run launch

# Terminal B — attaches and records. Open http://localhost:7000 for checklist.
npm run start
```

Log in to `app.crmchat.ai` once in the launched Chrome — the profile remembers.

## Bootstrapping from a fresh clone

`raw/`, `processed/`, `state.json` are **gitignored** — they weigh ~300MB combined and `raw/` isn't reproducible without re-running a full capture session. If you're starting fresh:

1. `npm install && npm run launch` — opens Chrome with persistent profile.
2. Log in to `app.crmchat.ai` once.
3. `npm run start` — records as you click through the checklist at `http://localhost:7000`.
4. Re-derive downstream artifacts: `npm run inventory && npm run contracts && npm run coverage`.

`locales/chunks/` (for `npm run ui-extract`) is also gitignored — grab from `app.crmchat.ai/assets/*.js` via `download_complete.py` at the repo root.

## Resume / update semantics

| Action | Effect |
| --- | --- |
| Stop and restart `npm run start` | ✅ checklist preserved, new session appended |
| Edit capture.ts, restart | ✅ checklist preserved, old `raw/` intact, new behavior from now on |
| `npm run rebuild` | Nukes `processed/rpc/` and re-derives it from all `raw/session-*.jsonl`. Checklist (`state.json` visits) untouched. Screenshots **not** regenerated — CDP can't replay them. |
| Dashboard → "reset" on one row | Clears `processed/routes/<id>/` and that row's visit counter. Visit again to re-capture. |

## What gets captured

- **On every main-frame navigation**: screenshot + DOM snapshot after 500ms (animation settle)
- **On `loadEventFired`**: screenshot + DOM after 1500ms
- **On response cluster quiescence (800ms after last response)**: screenshot + DOM — catches SPA re-renders after user actions
- **All XHR/fetch**: full request + response body in raw log
- **Recognized RPCs** (known tRPC/oRPC procedures from scope.json): extracted into `processed/rpc/<proc>/`
- **Unrecognized URLs and RPCs**: flagged as "unexpected" in dashboard — may indicate new features

## Blind spots

- Requires passive observation. We do not simulate clicks.
- If the page uses a service worker / local cache, some requests may never hit the network → invisible to CDP.
- Chrome must be launched via `npm run launch` (or at least with `--remote-debugging-port=9222`) — attaching to a normal Chrome instance won't work.
