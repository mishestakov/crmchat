/**
 * Rebuild processed/ from raw/session-*.jsonl, WITHOUT losing state.json
 * (checklist). Use when you've edited RPC detection / route matching logic
 * and want to re-derive artifacts from already-captured raw events.
 *
 * Note: screenshots and DOM snapshots were taken live — they cannot be
 * recreated here. This only rebuilds RPC files + rpc_counts + unexpected.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadOrpcRoutes, detectRpc } from "./rpc-detect.js";

const CAP = process.cwd();
const ROOT = path.resolve(CAP, "..", "..");
const SCOPE_FILE = path.join(ROOT, "scope.json");
const RAW_DIR = path.join(CAP, "raw");
const PROC_DIR = path.join(CAP, "processed");
const RPC_DIR = path.join(PROC_DIR, "rpc");
const STATE_FILE = path.join(CAP, "state.json");

const scope = JSON.parse(fs.readFileSync(SCOPE_FILE, "utf8"));
const allKnownTrpc = new Set<string>();
const allKnownOrpc = new Set<string>();
for (const e of Object.values<any>(scope.decisions)) {
  for (const p of e.trpc) allKnownTrpc.add(p);
  for (const p of e.orpc) allKnownOrpc.add(p);
}

// --- Route matchers (same logic as capture.ts; specificity-sorted) ---
interface RM { id: string; label: string; domain: string; urlPattern: string; regex: RegExp; trpc: Set<string>; orpc: Set<string>; }
function patternToRegex(p: string): RegExp {
  let s = p.replace(/\{[^}]*\}/g, (m) => (m === "{}" ? ".*" : "[^/]+"));
  s = s.replace(/\/$/, "");
  return new RegExp("^" + s + "/?$");
}
function dynSegs(p: string) { return p.split("/").filter((s) => s.startsWith("{")).length; }
const keepRoutes: RM[] = [];
for (const [id, e] of Object.entries<any>(scope.decisions)) {
  if (e.decision !== "keep" || !e.url_pattern || !e.route_file) continue;
  keepRoutes.push({
    id, label: e.label, domain: e.domain, urlPattern: e.url_pattern,
    regex: patternToRegex(e.url_pattern),
    trpc: new Set(e.trpc), orpc: new Set(e.orpc),
  });
}
keepRoutes.sort((a, b) => {
  const da = dynSegs(a.urlPattern), db = dynSegs(b.urlPattern);
  if (da !== db) return da - db;
  return b.urlPattern.length - a.urlPattern.length;
});
function matchRoute(pathname: string): RM | null {
  for (const r of keepRoutes) if (r.regex.test(pathname)) return r;
  return null;
}

// Wipe derived rpc/ only
if (fs.existsSync(RPC_DIR)) fs.rmSync(RPC_DIR, { recursive: true, force: true });
fs.mkdirSync(RPC_DIR, { recursive: true });

// Reset all derived fields; they'll be re-derived from raw below.
const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) : {};
state.version = 1;
state.started_at ??= Date.now();
state.updated_at = Date.now();
state.visits = {};
state.unexpected_urls = {};
state.unexpected_rpcs = {};
state.rpc_counts = {};
state.rpc_per_route = {};

// Track per-tab current route as we replay so we can attribute RPCs correctly
const tabRoute = new Map<string, string | null>();
function replayNav(tab: string, urlStr: string, ts: number) {
  let u: URL;
  try { u = new URL(urlStr); } catch { return; }
  if (!u.host.includes("crmchat")) { tabRoute.set(tab, null); return; }
  const m = matchRoute(u.pathname);
  if (m) {
    tabRoute.set(tab, m.id);
    const v = state.visits[m.id] ?? { count: 0, first_at: ts, last_at: ts, urls: [], paths: {}, screenshots: 0 };
    v.count++;
    v.last_at = ts;
    if (!v.urls.includes(u.href) && v.urls.length < 20) v.urls.push(u.href);
    const p = v.paths[u.pathname] ?? { count: 0, last_at: 0 };
    p.count++;
    p.last_at = ts;
    v.paths[u.pathname] = p;
    state.visits[m.id] = v;
  } else {
    tabRoute.set(tab, null);
    const ux = state.unexpected_urls[u.pathname] ?? { url: u.href, pathname: u.pathname, count: 0, last_at: 0 };
    ux.count++;
    ux.last_at = ts;
    ux.url = u.href;
    state.unexpected_urls[u.pathname] = ux;
  }
}

function sanitize(s: string) { return s.replace(/[^a-zA-Z0-9._-]/g, "_"); }
const orpcRoutes = loadOrpcRoutes(ROOT);
console.log(`[+] contract oRPC routes: ${orpcRoutes.length}`);

const files = fs.readdirSync(RAW_DIR).filter((f) => f.endsWith(".jsonl")).sort();
console.log(`[+] rebuilding from ${files.length} raw session(s)`);

for (const f of files) {
  const lines = fs.readFileSync(path.join(RAW_DIR, f), "utf8").split("\n").filter(Boolean);
  // Join request + response + body by requestId per session
  const reqs = new Map<string, any>();
  for (const line of lines) {
    const e = JSON.parse(line);
    if (e.type === "Page.frameNavigated") {
      replayNav(e.tab, e.params.url, e.t);
    } else if (e.type === "Page.navigatedWithinDocument") {
      replayNav(e.tab, e.params.url, e.t);
    } else if (e.type === "Network.requestWillBeSent") {
      reqs.set(e.params.requestId, {
        url: e.params.request.url,
        method: e.params.request.method,
        postData: e.params.request.postData,
        t: e.t,
      });
    } else if (e.type === "Network.responseReceived") {
      const r = reqs.get(e.params.requestId);
      if (r) r.status = e.params.response.status;
    } else if (e.type === "__body") {
      const r = reqs.get(e.params.requestId);
      if (!r) continue;
      const d = detectRpc(r.url, r.method, orpcRoutes);
      if (d.procs.length === 0) continue;
      for (const proc of d.procs) {
        const c = state.rpc_counts[proc] ?? { count: 0, last_at: 0 };
        c.count++;
        c.last_at = e.t;
        state.rpc_counts[proc] = c;
        // Attribute to the route the tab was on when the response finished
        const rid = tabRoute.get(e.tab);
        if (rid) {
          const pr = state.rpc_per_route[rid] ?? {};
          pr[proc] = (pr[proc] ?? 0) + 1;
          state.rpc_per_route[rid] = pr;
        }
        const known = d.kind === "trpc" ? allKnownTrpc.has(proc) : allKnownOrpc.has(proc);
        if (!known) {
          const ux = state.unexpected_rpcs[proc] ?? {
            procedure: proc, kind: d.kind, count: 0, last_at: 0, sample_url: r.url,
          };
          ux.count++;
          ux.last_at = e.t;
          state.unexpected_rpcs[proc] = ux;
        }
        const dir = path.join(RPC_DIR, sanitize(proc));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${e.t}.json`), JSON.stringify({
          ts: e.t,
          kind: d.kind,
          procedure: proc,
          known,
          request: { url: r.url, method: r.method, body: r.postData ?? null },
          response: { status: r.status, body: e.params.body, base64: e.params.base64 },
        }, null, 2));
      }
    }
  }
}

fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
console.log(`[+] visits: ${Object.keys(state.visits).length} routes`);
console.log(`[+] unexpected URLs: ${Object.keys(state.unexpected_urls).length}`);
console.log(`[+] tRPC+oRPC procedures seen: ${Object.keys(state.rpc_counts).length}`);
console.log(`[+] unexpected RPCs: ${Object.keys(state.unexpected_rpcs).length}`);
