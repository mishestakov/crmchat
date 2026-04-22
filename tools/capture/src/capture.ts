/**
 * Passive CDP capture: attaches to the Chrome launched by launch-chrome.ts
 * (remote-debugging-port=9222), listens to Network/Page events on every
 * app.crmchat.ai tab, and writes:
 *
 *   raw/session-<ts>.jsonl          — append-only CDP event log (source of truth)
 *   processed/routes/<id>/...png    — screenshot at various triggers
 *   processed/routes/<id>/...html   — DOM snapshot
 *   processed/routes/<id>/history.jsonl — one line per visit
 *   processed/rpc/<proc>/<ts>.json  — one file per RPC call
 *   state.json                      — persistent checklist + unexpected lists
 *
 * Dashboard on http://localhost:7000 shows live progress.
 *
 * Usage:
 *   1. npm run launch   (in another terminal — starts Chrome, you log in)
 *   2. npm run start    (this script — cabin is now being recorded)
 */

import CDP from "chrome-remote-interface";
import * as fs from "node:fs";
import * as path from "node:path";
import * as http from "node:http";
import { loadOrpcRoutes, detectRpc } from "./rpc-detect.js";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const CAP = process.cwd();
const ROOT = path.resolve(CAP, "..", "..");
const SCOPE_FILE = path.join(ROOT, "scope.json");
const RAW_DIR = path.join(CAP, "raw");
const PROC_DIR = path.join(CAP, "processed");
const ROUTES_DIR = path.join(PROC_DIR, "routes");
const RPC_DIR = path.join(PROC_DIR, "rpc");
const STATE_FILE = path.join(CAP, "state.json");

for (const d of [RAW_DIR, PROC_DIR, ROUTES_DIR, RPC_DIR]) fs.mkdirSync(d, { recursive: true });

// ---------------------------------------------------------------------------
// Scope loading + route matching
// ---------------------------------------------------------------------------

interface ScopeEntry {
  decision: "keep" | "drop" | "undecided";
  domain: string;
  label: string;
  url_pattern: string | null;
  route_file: string | null;
  trpc: string[];
  orpc: string[];
  firestore_ops: number;
}
interface Scope {
  decisions: Record<string, ScopeEntry>;
}

const scope = JSON.parse(fs.readFileSync(SCOPE_FILE, "utf8")) as Scope;

interface RouteMatcher {
  id: string;
  label: string;
  domain: string;
  urlPattern: string;
  regex: RegExp;
  trpcKnown: Set<string>;
  orpcKnown: Set<string>;
}

function patternToRegex(pattern: string): RegExp {
  // /w/{workspaceId}/contacts/{contactId}  → ^/w/[^/]+/contacts/[^/]+/?$
  // /mini-app/{}                           → ^/mini-app/.*$   (splat)
  // /                                      → ^/?$
  let p = pattern.replace(/\{[^}]*\}/g, (m) => (m === "{}" ? ".*" : "[^/]+"));
  p = p.replace(/\/$/, "");
  return new RegExp("^" + p + "/?$");
}

const keepRoutes: RouteMatcher[] = [];
const allKnownTrpc = new Set<string>();
const allKnownOrpc = new Set<string>();
for (const [id, e] of Object.entries(scope.decisions)) {
  for (const p of e.trpc) allKnownTrpc.add(p);
  for (const p of e.orpc) allKnownOrpc.add(p);
  if (e.decision !== "keep") continue;
  if (!e.url_pattern || !e.route_file) continue;
  keepRoutes.push({
    id,
    label: e.label,
    domain: e.domain,
    urlPattern: e.url_pattern,
    regex: patternToRegex(e.url_pattern),
    trpcKnown: new Set(e.trpc),
    orpcKnown: new Set(e.orpc),
  });
}
// Specificity: fewer dynamic segments wins (so /.../new beats /.../{id}),
// tiebreak by longer pattern (so /a/b/c beats /a/b).
function dynSegs(p: string) { return p.split("/").filter((s) => s.startsWith("{")).length; }
keepRoutes.sort((a, b) => {
  const da = dynSegs(a.urlPattern), db = dynSegs(b.urlPattern);
  if (da !== db) return da - db;
  return b.urlPattern.length - a.urlPattern.length;
});

const orpcRoutes = loadOrpcRoutes(ROOT);
console.log(`[+] loaded ${keepRoutes.length} keep routes from scope.json`);
console.log(`[+] known tRPC: ${allKnownTrpc.size}, known oRPC: ${allKnownOrpc.size}, contract oRPC routes: ${orpcRoutes.length}`);

function matchRoute(pathname: string): RouteMatcher | null {
  for (const r of keepRoutes) if (r.regex.test(pathname)) return r;
  return null;
}

// ---------------------------------------------------------------------------
// State (persistent checklist)
// ---------------------------------------------------------------------------

interface VisitState {
  count: number;
  first_at: number;
  last_at: number;
  urls: string[]; // unique full hrefs, capped (for ref)
  paths: Record<string, { count: number; last_at: number }>; // distinct pathnames
  screenshots: number;
}

interface UnexpectedUrl {
  url: string;
  pathname: string;
  count: number;
  last_at: number;
}
interface UnexpectedRpc {
  procedure: string;
  kind: "trpc" | "orpc" | "unknown";
  count: number;
  last_at: number;
  sample_url: string;
}

interface State {
  version: 1;
  started_at: number;
  updated_at: number;
  visits: Record<string, VisitState>;
  unexpected_urls: Record<string, UnexpectedUrl>;
  unexpected_rpcs: Record<string, UnexpectedRpc>;
  rpc_counts: Record<string, { count: number; last_at: number }>;
  rpc_per_route: Record<string, Record<string, number>>;  // routeId → { proc: count }
}

function loadState(): State {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const s = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as State;
      // Backfill fields added in later versions so older state files keep working
      s.rpc_per_route ??= {};
      s.rpc_counts ??= {};
      s.unexpected_urls ??= {};
      s.unexpected_rpcs ??= {};
      s.visits ??= {};
      for (const v of Object.values(s.visits)) {
        v.paths ??= {};
        // Synthesize paths from urls[] if missing
        if (Object.keys(v.paths).length === 0 && v.urls?.length) {
          for (const href of v.urls) {
            try {
              const p = new URL(href).pathname;
              v.paths[p] = { count: 1, last_at: v.last_at };
            } catch {}
          }
        }
      }
      return s;
    } catch {}
  }
  return {
    version: 1,
    started_at: Date.now(),
    updated_at: Date.now(),
    visits: {},
    unexpected_urls: {},
    unexpected_rpcs: {},
    rpc_counts: {},
    rpc_per_route: {},
  };
}

const state = loadState();
let saveTimer: NodeJS.Timeout | null = null;
function saveState() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    state.updated_at = Date.now();
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_FILE);
    saveTimer = null;
    sseBroadcast({ type: "state" });
  }, 300);
}

// ---------------------------------------------------------------------------
// Raw event log
// ---------------------------------------------------------------------------

const sessionId = new Date().toISOString().replace(/[:.]/g, "-");
const rawPath = path.join(RAW_DIR, `session-${sessionId}.jsonl`);
const rawStream = fs.createWriteStream(rawPath, { flags: "a" });
console.log(`[+] raw log: ${rawPath}`);

function rawLog(tabId: string, type: string, params: any) {
  rawStream.write(JSON.stringify({ t: Date.now(), tab: tabId, type, params }) + "\n");
}

// ---------------------------------------------------------------------------
// CDP attachment
// ---------------------------------------------------------------------------

interface TabCtx {
  id: string;
  client: CDP.Client;
  currentRouteId: string | null;
  currentUrl: string | null;
  // requestId → meta for body fetching
  reqs: Map<string, {
    url: string;
    method: string;
    postData?: string;
    startedAt: number;
    responseStatus?: number;
    responseHeaders?: Record<string, string>;
  }>;
  // Debounced "response-settled" screenshot
  settleTimer: NodeJS.Timeout | null;
  // Firestore-triggered snapshots on chat routes — rate-limited to 1/sec
  lastFirestoreSnapAt: number;
}

const tabs = new Map<string, TabCtx>();

async function attachTab(target: { id: string; type: string; url: string }) {
  if (tabs.has(target.id)) return;
  if (target.type !== "page") return;
  let client: CDP.Client;
  try {
    client = await CDP({ host: "127.0.0.1", port: 9222, target: target.id });
  } catch (e: any) {
    console.error(`[!] attach failed for ${target.id}: ${e.message}`);
    return;
  }
  const ctx: TabCtx = {
    id: target.id,
    client,
    currentRouteId: null,
    currentUrl: null,
    reqs: new Map(),
    settleTimer: null,
    lastFirestoreSnapAt: 0,
  };
  tabs.set(target.id, ctx);
  console.log(`[+] attached tab ${target.id.slice(0, 8)} url=${target.url}`);

  const { Network, Page, DOM, Runtime } = client;
  await Promise.all([
    Network.enable({}),
    Page.enable(),
    DOM.enable(),
    Runtime.enable(),
  ]);

  wireTab(ctx);

  client.on("disconnect", () => {
    tabs.delete(target.id);
    console.log(`[=] tab ${target.id.slice(0, 8)} detached`);
  });

  // If we attached to a tab that's already on an app URL, snapshot now
  if (target.url.startsWith("http")) {
    try {
      const u = new URL(target.url);
      handleNavigation(ctx, u, "attach");
    } catch {}
  }
}

function wireTab(ctx: TabCtx) {
  const { client } = ctx;

  client.on("Page.frameNavigated", (p: any) => {
    if (p.frame.parentId) return; // main frame only
    rawLog(ctx.id, "Page.frameNavigated", { url: p.frame.url });
    console.log(`  → frameNavigated ${p.frame.url}`);
    try {
      const u = new URL(p.frame.url);
      handleNavigation(ctx, u, "nav");
    } catch {}
  });

  // SPA pushState / replaceState — the main navigation signal for TanStack Router
  client.on("Page.navigatedWithinDocument", (p: any) => {
    rawLog(ctx.id, "Page.navigatedWithinDocument", p);
    console.log(`  → pushState ${p.url}`);
    try {
      const u = new URL(p.url);
      handleNavigation(ctx, u, "pushstate");
    } catch {}
  });

  client.on("Page.loadEventFired", (p: any) => {
    rawLog(ctx.id, "Page.loadEventFired", p);
    // Longer delay for animation settle
    setTimeout(() => captureScreenAndDom(ctx, "loaded+1500"), 1500);
  });

  client.on("Network.requestWillBeSent", (p: any) => {
    rawLog(ctx.id, "Network.requestWillBeSent", p);
    ctx.reqs.set(p.requestId, {
      url: p.request.url,
      method: p.request.method,
      postData: p.request.postData,
      startedAt: Date.now(),
    });
  });

  client.on("Network.responseReceived", (p: any) => {
    rawLog(ctx.id, "Network.responseReceived", p);
    const req = ctx.reqs.get(p.requestId);
    if (req) {
      req.responseStatus = p.response.status;
      req.responseHeaders = p.response.headers;
    }
    // Chat screens are Firestore-driven — no HTTP to our backend on new messages.
    // Snap on Firestore responses while on a chat route, rate-limited to 1/sec.
    // Small delay so React has a chance to render the incoming data.
    if (isChatRoute(ctx.currentRouteId) && /firestore\.googleapis\.com/.test(p.response.url)) {
      const now = Date.now();
      if (now - ctx.lastFirestoreSnapAt >= 1000) {
        ctx.lastFirestoreSnapAt = now;
        setTimeout(() => captureScreenAndDom(ctx, "firestore"), 300);
      }
    }
  });

  client.on("Network.loadingFinished", async (p: any) => {
    rawLog(ctx.id, "Network.loadingFinished", p);
    const req = ctx.reqs.get(p.requestId);
    if (!req) return;
    // Only fetch body for interesting requests (XHR/fetch to our backends)
    if (!isInteresting(req.url)) {
      ctx.reqs.delete(p.requestId);
      return;
    }
    let body = "", base64 = false;
    try {
      const r = await client.Network.getResponseBody({ requestId: p.requestId });
      body = r.body;
      base64 = !!r.base64Encoded;
    } catch (e: any) {
      // body may be unavailable for preflight, 204, etc.
    }
    rawLog(ctx.id, "__body", { requestId: p.requestId, base64, body });

    handleRpc(ctx, req, body, base64);
    ctx.reqs.delete(p.requestId);

    // Debounced "response settled" screenshot
    if (ctx.settleTimer) clearTimeout(ctx.settleTimer);
    ctx.settleTimer = setTimeout(() => captureScreenAndDom(ctx, "response-settle"), 800);
  });

  client.on("Network.loadingFailed", (p: any) => {
    rawLog(ctx.id, "Network.loadingFailed", p);
    ctx.reqs.delete(p.requestId);
  });
}

// ---------------------------------------------------------------------------
// Navigation + snapshot
// ---------------------------------------------------------------------------

function handleNavigation(ctx: TabCtx, u: URL, trigger: string) {
  console.log(`  [nav/${trigger}] host=${u.host} path=${u.pathname}`);
  if (!u.host.includes("crmchat")) {
    console.log(`  [nav/${trigger}] skip — host doesn't contain "crmchat"`);
    ctx.currentRouteId = null;
    ctx.currentUrl = u.href;
    return;
  }
  ctx.currentUrl = u.href;
  const m = matchRoute(u.pathname);
  if (m) {
    console.log(`  [nav/${trigger}] MATCH → ${m.id} (${m.label})`);
    const was = ctx.currentRouteId;
    ctx.currentRouteId = m.id;
    if (was !== m.id) recordVisit(m, u);
  } else {
    console.log(`  [nav/${trigger}] NO MATCH for ${u.pathname} — adding to unexpected`);
    ctx.currentRouteId = null;
    const key = u.pathname;
    const cur = state.unexpected_urls[key] ?? {
      url: u.href, pathname: u.pathname, count: 0, last_at: 0,
    };
    cur.count++;
    cur.last_at = Date.now();
    cur.url = u.href;
    state.unexpected_urls[key] = cur;
    saveState();
  }
  // Snapshot shortly after navigation
  setTimeout(() => captureScreenAndDom(ctx, "nav+500"), 500);
}

function recordVisit(r: RouteMatcher, u: URL) {
  const v = state.visits[r.id] ?? {
    count: 0, first_at: Date.now(), last_at: 0, urls: [], paths: {}, screenshots: 0,
  };
  v.paths ??= {};
  v.count++;
  v.last_at = Date.now();
  if (!v.urls.includes(u.href) && v.urls.length < 20) v.urls.push(u.href);
  const pathKey = u.pathname;
  const p = v.paths[pathKey] ?? { count: 0, last_at: 0 };
  p.count++;
  p.last_at = Date.now();
  v.paths[pathKey] = p;
  state.visits[r.id] = v;
  saveState();
  console.log(`  ✓ visit [${r.domain}] ${r.label}  ← ${u.pathname} (${p.count}×, ${Object.keys(v.paths).length} distinct paths)`);
}

async function captureScreenAndDom(ctx: TabCtx, trigger: string) {
  if (!ctx.currentRouteId) return;
  const routeId = ctx.currentRouteId;
  const dir = path.join(ROUTES_DIR, routeId);
  fs.mkdirSync(dir, { recursive: true });
  const ts = Date.now();
  const stem = `${ts}_${trigger}`;
  try {
    const shot = await ctx.client.Page.captureScreenshot({ format: "png", captureBeyondViewport: true });
    fs.writeFileSync(path.join(dir, stem + ".png"), Buffer.from(shot.data, "base64"));
    const doc = await ctx.client.DOM.getDocument({ depth: -1 });
    const html = await ctx.client.DOM.getOuterHTML({ nodeId: doc.root.nodeId });
    fs.writeFileSync(path.join(dir, stem + ".html"), html.outerHTML);
    const hist = { ts, trigger, url: ctx.currentUrl, stem };
    fs.appendFileSync(path.join(dir, "history.jsonl"), JSON.stringify(hist) + "\n");
    const v = state.visits[routeId];
    if (v) { v.screenshots++; saveState(); }
  } catch (e: any) {
    // tab may have navigated away mid-capture
  }
}

// ---------------------------------------------------------------------------
// RPC detection (tRPC / oRPC)
// ---------------------------------------------------------------------------

// Routes where Firestore-driven updates carry real UI state (chat messages, etc.).
// We trigger extra snapshots here since our standard triggers won't fire.
const CHAT_ROUTE_IDS = new Set<string>([
  "ProtectedWWorkspaceIdTelegramRouteImport",
]);
function isChatRoute(routeId: string | null): boolean {
  return routeId !== null && CHAT_ROUTE_IDS.has(routeId);
}

function isInteresting(url: string): boolean {
  if (!/^https?:\/\//.test(url)) return false;
  // Skip static assets
  if (/\.(js|css|woff2?|ttf|png|jpg|jpeg|gif|svg|ico|map)(\?|$)/i.test(url)) return false;
  // Skip known noise
  if (url.includes("posthog.com")) return false;
  if (url.includes("sentry")) return false;
  if (url.includes("google-analytics")) return false;
  return true;
}

function handleRpc(
  ctx: TabCtx,
  req: { url: string; method: string; postData?: string; responseStatus?: number },
  body: string,
  base64: boolean,
) {
  const d = detectRpc(req.url, req.method, orpcRoutes);
  if (d.procs.length === 0) return; // not an RPC we recognize
  for (const proc of d.procs) {
    // Counters
    const c = state.rpc_counts[proc] ?? { count: 0, last_at: 0 };
    c.count++;
    c.last_at = Date.now();
    state.rpc_counts[proc] = c;

    // Per-route tally (only if user is on a known route)
    if (ctx.currentRouteId) {
      const pr = state.rpc_per_route[ctx.currentRouteId] ?? {};
      pr[proc] = (pr[proc] ?? 0) + 1;
      state.rpc_per_route[ctx.currentRouteId] = pr;
    }

    const known = d.kind === "trpc" ? allKnownTrpc.has(proc) : allKnownOrpc.has(proc);
    if (!known) {
      const ux = state.unexpected_rpcs[proc] ?? {
        procedure: proc, kind: d.kind, count: 0, last_at: 0, sample_url: req.url,
      };
      ux.count++;
      ux.last_at = Date.now();
      state.unexpected_rpcs[proc] = ux;
    }

    // Per-RPC file
    const dir = path.join(RPC_DIR, sanitize(proc));
    fs.mkdirSync(dir, { recursive: true });
    const record = {
      ts: Date.now(),
      kind: d.kind,
      procedure: proc,
      known,
      request: { url: req.url, method: req.method, body: req.postData ?? null },
      response: { status: req.responseStatus, body, base64 },
      route: ctx.currentRouteId,
      page_url: ctx.currentUrl,
    };
    fs.writeFileSync(path.join(dir, `${Date.now()}.json`), JSON.stringify(record, null, 2));
  }
  saveState();
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// ---------------------------------------------------------------------------
// Tab discovery loop
// ---------------------------------------------------------------------------

let lastDiscoverOk = false;
async function discoverTabs() {
  try {
    const list = await CDP.List({ host: "127.0.0.1", port: 9222 });
    if (!lastDiscoverOk) {
      console.log(`[+] CDP online: ${list.length} targets (${list.filter((t:any)=>t.type==="page").length} pages)`);
      lastDiscoverOk = true;
    }
    for (const t of list) await attachTab(t as any);
  } catch (e: any) {
    if (lastDiscoverOk) console.log(`[!] CDP offline — is Chrome running via 'npm run launch'?`);
    lastDiscoverOk = false;
  }
}

setInterval(discoverTabs, 1500);
discoverTabs();

// ---------------------------------------------------------------------------
// Dashboard (SSE)
// ---------------------------------------------------------------------------

const sseClients = new Set<http.ServerResponse>();
function sseBroadcast(msg: any) {
  const data = "data: " + JSON.stringify(msg) + "\n\n";
  for (const r of sseClients) { try { r.write(data); } catch {} }
}

// Load enriched descriptions (optional, may be partial)
const ENRICHED_FILE = path.join(ROOT, "static-analysis", "capability_matrix.enriched.json");
function loadEnriched(): Record<string, any> {
  if (!fs.existsSync(ENRICHED_FILE)) return {};
  try {
    const d = JSON.parse(fs.readFileSync(ENRICHED_FILE, "utf8"));
    const m: Record<string, any> = {};
    for (const e of d.enriched ?? []) m[e.id] = e;
    return m;
  } catch { return {}; }
}

function listScreenshots(routeId: string): Array<{ stem: string; ts: number; trigger: string }> {
  const dir = path.join(ROUTES_DIR, routeId);
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
  return files
    .map((f) => {
      const stem = f.slice(0, -4);
      const m = stem.match(/^(\d+)_(.+)$/);
      return { stem, ts: m ? Number(m[1]) : 0, trigger: m ? m[2] : "" };
    })
    .sort((a, b) => b.ts - a.ts);
}

const DASHBOARD_PORT = 7000;
const srv = http.createServer(async (req, res) => {
  const u = new URL(req.url!, "http://localhost");
  if (u.pathname === "/") {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(renderDashboard());
    return;
  }
  if (u.pathname === "/api/state") {
    res.setHeader("content-type", "application/json");
    const enriched = loadEnriched();
    const routes = keepRoutes.map((r) => {
      const scopeEntry = scope.decisions[r.id];
      return {
        id: r.id,
        label: r.label,
        domain: r.domain,
        url_pattern: r.urlPattern,
        expected_trpc: scopeEntry?.trpc ?? [],
        expected_orpc: scopeEntry?.orpc ?? [],
        enriched: enriched[r.id] ?? null,
        screenshots: listScreenshots(r.id),
      };
    });
    res.end(JSON.stringify({ state, routes }));
    return;
  }
  if (u.pathname === "/api/events") {
    res.setHeader("content-type", "text/event-stream");
    res.setHeader("cache-control", "no-cache");
    res.setHeader("connection", "keep-alive");
    res.write(": connected\n\n");
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }
  if (u.pathname === "/api/reset-route") {
    const id = u.searchParams.get("id");
    if (id && state.visits[id]) {
      delete state.visits[id];
      const dir = path.join(ROUTES_DIR, id);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
      saveState();
    }
    res.end("ok");
    return;
  }
  if (u.pathname.startsWith("/file/")) {
    const rel = decodeURIComponent(u.pathname.slice("/file/".length));
    const abs = path.resolve(PROC_DIR, rel);
    if (!abs.startsWith(PROC_DIR) || !fs.existsSync(abs)) {
      res.statusCode = 404; res.end("nf"); return;
    }
    const ext = path.extname(abs).toLowerCase();
    res.setHeader("content-type", ext === ".png" ? "image/png" : ext === ".html" ? "text/html" : "text/plain");
    fs.createReadStream(abs).pipe(res);
    return;
  }
  res.statusCode = 404; res.end("not found");
});
srv.listen(DASHBOARD_PORT, () => {
  console.log(`[+] dashboard: http://localhost:${DASHBOARD_PORT}`);
});

function renderDashboard(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>crmchat capture</title>
<style>
  * { box-sizing: border-box; }
  body { font: 13px ui-monospace, Consolas, monospace; margin: 0; background: #0f1116; color: #d8dde6; }
  .top { padding: 10px 14px; background: #151822; border-bottom: 1px solid #222735; display: flex; gap: 14px; align-items: center; }
  .top h1 { margin: 0; font-size: 14px; color: #93c5fd; letter-spacing: 0.04em; }
  .top .stats { color: #9ca3af; }
  .top .now { color: #fbbf24; }
  .wrap { display: grid; grid-template-columns: 1fr 360px; gap: 10px; padding: 10px; height: calc(100vh - 48px); }
  .col { overflow: auto; background: #151822; border: 1px solid #222735; border-radius: 6px; padding: 10px; }
  h2 { margin: 2px 0 10px; font-size: 12px; color: #93c5fd; text-transform: uppercase; letter-spacing: 0.05em; }
  h3 { margin: 14px 0 6px; font-size: 12px; color: #c8d0dd; border-bottom: 1px solid #222735; padding-bottom: 3px; text-transform: uppercase; }
  .domain { color: #93c5fd; font-weight: bold; margin: 14px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; }
  .card { background: #1a1e2b; border: 1px solid #222735; border-radius: 5px; margin-bottom: 6px; overflow: hidden; }
  .card.done { border-color: #2d5a3f; }
  .card.active { border-color: #fbbf24; box-shadow: 0 0 0 1px #fbbf24 inset; }
  .card-head { display: grid; grid-template-columns: 24px 1fr auto; gap: 8px; padding: 7px 10px; cursor: pointer; align-items: center; }
  .card-head:hover { background: #1f2535; }
  .card-head .chk { font-size: 15px; }
  .card-head .lbl { font-weight: bold; color: #e8ecf2; }
  .card-head .url { font-family: ui-monospace, monospace; font-size: 11px; color: #9ca3af; margin-left: 8px; font-weight: normal; }
  .card-head .meta { font-size: 11px; color: #9ca3af; text-align: right; white-space: nowrap; }
  .card-body { padding: 0 10px 10px; display: none; border-top: 1px solid #222735; }
  .card.open .card-body { display: block; }
  .card-body h4 { margin: 10px 0 4px; font-size: 11px; color: #93c5fd; text-transform: uppercase; letter-spacing: 0.05em; }
  .prose { color: #cdd4df; line-height: 1.5; margin: 6px 0; }
  .prose .head { color: #e8ecf2; font-weight: bold; }
  ul.actions { margin: 4px 0 4px 16px; padding: 0; }
  ul.actions li { margin: 2px 0; color: #cdd4df; }
  .rpc-list { margin: 0; padding: 0; list-style: none; font-size: 12px; }
  .rpc-list li { padding: 3px 6px; display: flex; justify-content: space-between; border-bottom: 1px solid #1f2535; }
  .rpc-list li.seen { color: #86efac; }
  .rpc-list li.missing { color: #9ca3af; }
  .rpc-list li.bonus { color: #c4b5fd; }
  .rpc-list li .proc { font-family: ui-monospace, monospace; }
  .rpc-list li .cnt { color: #6b7280; }
  .thumbs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 8px; }
  .thumbs .t { position: relative; }
  .thumbs img { width: 100%; border: 1px solid #2a3347; border-radius: 3px; cursor: pointer; display: block; }
  .thumbs .tag { position: absolute; bottom: 2px; left: 2px; background: rgba(0,0,0,0.7); color: #e8ecf2; padding: 1px 4px; font-size: 10px; border-radius: 2px; }
  .btn { background: #1e2636; border: 1px solid #2a3347; color: #d8dde6; padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 11px; }
  .btn:hover { background: #2a3347; }
  .ux { padding: 4px 6px; border-bottom: 1px solid #1a1e29; font-size: 11px; display: flex; justify-content: space-between; gap: 8px; }
  .ux .url { color: #fbbf24; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ux .proc { color: #a78bfa; font-family: ui-monospace, monospace; }
  .modal { position: fixed; inset: 0; background: rgba(0,0,0,0.9); display: none; align-items: center; justify-content: center; z-index: 100; padding: 20px; }
  .modal.show { display: flex; }
  .modal img { max-width: 100%; max-height: 100%; border: 1px solid #2a3347; }
</style></head>
<body>
<div class="top">
  <h1>crmchat capture</h1>
  <div class="stats" id="stats">—</div>
  <div class="now" id="now"></div>
</div>
<div class="wrap">
  <div class="col" id="left"><div id="routes"></div></div>
  <div class="col" id="right">
    <h2>Неожиданное 🆕</h2>
    <h3>URLs</h3><div id="ux-urls"></div>
    <h3>RPCs</h3><div id="ux-rpcs"></div>
    <h3>Все RPC вызовы</h3><div id="rpc-all"></div>
  </div>
</div>
<div class="modal" id="modal" onclick="this.classList.remove('show')"><img id="modal-img" src=""></div>
<script>
let openCards = new Set(JSON.parse(localStorage.getItem('open-cards') || '[]'));
function saveOpen() { localStorage.setItem('open-cards', JSON.stringify([...openCards])); }

function esc(s) { return String(s || '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

function renderCard(rt, st) {
  const v = st.visits[rt.id];
  const done = !!v;
  const perRoute = (st.rpc_per_route || {})[rt.id] || {};
  const expectedTrpc = rt.expected_trpc || [];
  const expectedOrpc = rt.expected_orpc || [];
  const allExpected = new Set([...expectedTrpc, ...expectedOrpc]);
  const seenExpected = [...allExpected].filter(p => perRoute[p]);
  const missingExpected = [...allExpected].filter(p => !perRoute[p]);
  const bonus = Object.keys(perRoute).filter(p => !allExpected.has(p));

  const isOpen = openCards.has(rt.id);
  const e = rt.enriched;

  let html = '<div class="card ' + (done ? 'done' : '') + (isOpen ? ' open' : '') + '" data-id="' + rt.id + '">';
  html += '<div class="card-head" onclick="toggle(\\'' + rt.id + '\\')">';
  html += '<div class="chk">' + (done ? '✅' : '⬜') + '</div>';
  html += '<div><span class="lbl">' + esc(e?.headline || rt.label) + '</span><span class="url">' + esc(rt.url_pattern) + '</span></div>';
  html += '<div class="meta">' + (done ? v.count + '× · ' + v.screenshots + ' shots · ' + seenExpected.length + '/' + allExpected.size + ' RPC' : '—') + '</div>';
  html += '</div>';
  html += '<div class="card-body">';

  if (e) {
    html += '<div class="prose"><div class="head">' + esc(e.what_user_sees) + '</div></div>';
    if (e.likely_actions && e.likely_actions.length) {
      html += '<h4>Сценарии — прокликать</h4><ul class="actions">';
      for (const a of e.likely_actions) html += '<li>' + esc(a) + '</li>';
      html += '</ul>';
    }
    if (e.why_it_exists) html += '<div class="prose"><small>Зачем: ' + esc(e.why_it_exists) + '</small></div>';
    if (e.notes) html += '<div class="prose"><small style="color:#9ca3af">' + esc(e.notes) + '</small></div>';
  } else {
    html += '<div class="prose" style="color:#6b7280">Описание ещё не сгенерировано. Запусти: <code>cd tools/extract && npm run enrich</code></div>';
  }

  if (allExpected.size > 0 || bonus.length > 0) {
    html += '<h4>Ожидаемые RPC <small style="color:#6b7280">(' + seenExpected.length + '/' + allExpected.size + ')</small></h4>';
    html += '<ul class="rpc-list">';
    for (const p of seenExpected) html += '<li class="seen"><span class="proc">✓ ' + esc(p) + '</span><span class="cnt">' + perRoute[p] + '×</span></li>';
    for (const p of missingExpected) html += '<li class="missing"><span class="proc">○ ' + esc(p) + '</span><span class="cnt">—</span></li>';
    if (bonus.length) {
      html += '<li style="margin-top:4px;font-size:10px;color:#a78bfa">БОНУС (не в scope):</li>';
      for (const p of bonus) html += '<li class="bonus"><span class="proc">+ ' + esc(p) + '</span><span class="cnt">' + perRoute[p] + '×</span></li>';
    }
    html += '</ul>';
  }

  if (rt.screenshots && rt.screenshots.length) {
    html += '<h4>Скриншоты (' + rt.screenshots.length + ')</h4><div class="thumbs">';
    for (const s of rt.screenshots.slice(0, 9)) {
      const src = '/file/routes/' + encodeURIComponent(rt.id) + '/' + encodeURIComponent(s.stem) + '.png';
      html += '<div class="t"><img src="' + src + '" onclick="event.stopPropagation();showModal(\\'' + src + '\\')"><span class="tag">' + esc(s.trigger) + '</span></div>';
    }
    html += '</div>';
  }

  html += '<div style="margin-top:8px"><button class="btn" onclick="event.stopPropagation();reset(\\'' + rt.id + '\\')">Reset this route</button>';
  if (v && v.urls.length) html += '<small style="margin-left:10px;color:#6b7280">Последний URL: ' + esc(v.urls[v.urls.length-1]) + '</small>';
  html += '</div>';

  html += '</div></div>';
  return html;
}

function showModal(src) { document.getElementById('modal-img').src = src; document.getElementById('modal').classList.add('show'); }
function toggle(id) {
  console.log('[toggle]', id, 'was open?', openCards.has(id));
  if (openCards.has(id)) openCards.delete(id); else openCards.add(id);
  saveOpen();
  refresh();
}
async function reset(id) { if (!confirm('Clear captures for this route?')) return; await fetch('/api/reset-route?id=' + encodeURIComponent(id)); refresh(); }

let refreshCount = 0;
async function refresh() {
  refreshCount++;
  console.log('[refresh #' + refreshCount + '] fetching /api/state');
  let r;
  try {
    r = await fetch('/api/state').then(r => r.json());
  } catch (e) {
    console.error('[refresh] fetch failed:', e);
    document.getElementById('stats').textContent = 'ERROR: ' + e.message;
    return;
  }
  console.log('[refresh] got', r.routes?.length, 'routes,', Object.keys(r.state?.visits || {}).length, 'visits,', Object.keys(r.state?.rpc_counts || {}).length, 'RPCs');
  try {
  const byDom = {};
  for (const rt of r.routes) (byDom[rt.domain] = byDom[rt.domain] || []).push(rt);
  let html = '';
  let done = 0, total = r.routes.length;
  for (const dom of Object.keys(byDom)) {
    const doneInDom = byDom[dom].filter(rt => r.state.visits[rt.id]).length;
    html += '<div class="domain">' + dom + ' <small style="color:#6b7280">' + doneInDom + '/' + byDom[dom].length + '</small></div>';
    for (const rt of byDom[dom]) {
      if (r.state.visits[rt.id]) done++;
      html += renderCard(rt, r.state);
    }
  }
  document.getElementById('routes').innerHTML = html;
  document.getElementById('stats').textContent = done + ' / ' + total + ' routes visited · ' + Object.keys(r.state.rpc_counts).length + ' RPCs captured';

  const uxu = Object.values(r.state.unexpected_urls).sort((a,b)=>b.last_at-a.last_at).slice(0,50);
  document.getElementById('ux-urls').innerHTML = uxu.map(u =>
    '<div class="ux"><span class="url" title="' + esc(u.url) + '">' + esc(u.pathname) + '</span><span>' + u.count + '×</span></div>').join('') || '<small style="color:#6b7280">пусто</small>';
  const uxr = Object.values(r.state.unexpected_rpcs).sort((a,b)=>b.last_at-a.last_at).slice(0,50);
  document.getElementById('ux-rpcs').innerHTML = uxr.map(u =>
    '<div class="ux"><span class="proc">[' + u.kind + '] ' + esc(u.procedure) + '</span><span>' + u.count + '×</span></div>').join('') || '<small style="color:#6b7280">пусто</small>';
  const all = Object.entries(r.state.rpc_counts).sort((a,b)=>b[1].count-a[1].count).slice(0,80);
  document.getElementById('rpc-all').innerHTML = all.map(([k,v]) =>
    '<div class="ux"><span class="proc">' + esc(k) + '</span><span>' + v.count + '×</span></div>').join('') || '<small style="color:#6b7280">пусто</small>';
    document.getElementById('now').textContent = '· last refresh: ' + new Date().toLocaleTimeString();
  } catch (e) {
    console.error('[refresh] render failed:', e);
    document.getElementById('stats').textContent = 'RENDER ERROR: ' + e.message + ' (см. консоль)';
  }
}

refresh();
const ev = new EventSource('/api/events');
ev.onmessage = () => refresh();
setInterval(refresh, 4000);
</script></body></html>`;
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

process.on("SIGINT", () => {
  console.log("\n[=] shutting down...");
  saveState();
  rawStream.end();
  for (const t of tabs.values()) t.client.close().catch(() => {});
  srv.close();
  setTimeout(() => process.exit(0), 500);
});
