/**
 * Coverage validator — проверяет что user-stories.md покрывает code-inventory.json.
 *
 * 4 assertions:
 *   A1 routes:      каждый keep-route упомянут в какой-то US-* (или помечен layout/deep-link)
 *   A2 rpc:         каждый proc ∈ (stories ∪ scope.rpc_decisions)
 *   A3 firestore:   каждая fn ∈ scope.firestore_decisions (approach A)
 *   A4 postMessage: каждый type упомянут в chat-spec.md
 */

import * as fs from "node:fs";
import * as path from "node:path";

const CAP = process.cwd();
const ROOT = path.resolve(CAP, "..", "..");
const INV   = JSON.parse(fs.readFileSync(path.join(ROOT, "code-inventory.json"), "utf8"));
const SCOPE = JSON.parse(fs.readFileSync(path.join(ROOT, "scope.json"), "utf8"));
const STORIES = fs.readFileSync(path.join(ROOT, "user-stories.md"), "utf8");
const CHAT_SPEC = fs.existsSync(path.join(ROOT, "chat-spec.md"))
  ? fs.readFileSync(path.join(ROOT, "chat-spec.md"), "utf8") : "";
const UI_STRINGS = fs.existsSync(path.join(ROOT, "ui-strings.json"))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, "ui-strings.json"), "utf8")) : null;
const UI_IGNORE = fs.existsSync(path.join(ROOT, "ui-ignore.json"))
  ? JSON.parse(fs.readFileSync(path.join(ROOT, "ui-ignore.json"), "utf8")) : { items: [], patterns: [] };

// --- Story parsing ---
interface Story { id: string; title: string; body: string; backticks: Set<string>; urls: Set<string> }
function parseStories(md: string): Story[] {
  const out: Story[] = [];
  const re = /^###\s+(US-[0-9]+[a-z]?)\s*[·\-–—:.]?\s*(.*?)\s*$/gm;
  const hits: { id: string; title: string; start: number }[] = [];
  let m;
  while ((m = re.exec(md))) hits.push({ id: m[1], title: m[2], start: m.index });
  for (let i = 0; i < hits.length; i++) {
    const s = hits[i].start;
    const e = i + 1 < hits.length ? hits[i + 1].start : md.length;
    const body = md.slice(s, e);
    const backticks = new Set<string>();
    let b;
    const bRe = /`([^`]+)`/g;
    while ((b = bRe.exec(body))) backticks.add(b[1]);
    const urls = new Set<string>();
    const uRe = /\(URL[^)]*?(\/[^)\s]+)\)/g;
    let u;
    while ((u = uRe.exec(body))) urls.add(u[1]);
    // Also pick up inline URL hints like "`/w/{id}/telegram`" from backticks
    for (const t of backticks) if (t.startsWith("/")) urls.add(t);
    out.push({ id: hits[i].id, title: hits[i].title, body, backticks, urls });
  }
  return out;
}

const stories = parseStories(STORIES);
console.log(`[+] parsed ${stories.length} stories from user-stories.md`);

// --- Normalization helpers ---
// Story URLs use "/w/{id}/contacts" or "/contacts/{id}"; scope uses "/w/{workspaceId}/contacts"
function normUrl(u: string): string {
  return u
    .replace(/\{[^}]*\}/g, "{}")        // drop param names
    .replace(/\/$/, "")
    .toLowerCase();
}
function urlSuffixMatch(storyUrl: string, routeUrl: string): boolean {
  const a = normUrl(storyUrl), b = normUrl(routeUrl);
  return a === b || b.endsWith(a) || a.endsWith(b);
}

// --- Hand-classified route exceptions (layout / deep-link / inline-edit) ---
const ROUTE_EXEMPT: Record<string, string> = {
  "rootRouteImport":                     "layout",
  "ProtectedRouteImport":                "layout",
  "ProtectedWWorkspaceIdRouteImport":    "layout",
  "AcceptInviteWorkspaceIdInviteCodeRouteImport":                                    "deep_link",
  "ProtectedWWorkspaceIdSettingsWorkspaceAcceptInviteWIdInviteCodeRouteImport":      "deep_link",
  "ProtectedWWorkspaceIdContactsContactIdActivitiesActivityIdEditRouteImport":       "inline_edit",
};

// ================================================================
// A1 routes
// ================================================================
interface RouteRow { id: string; url: string }
const keepRoutes: RouteRow[] = INV.routes.items
  .filter((r: any) => r.decision === "keep")
  .map((r: any) => ({ id: r.id, url: r.url_pattern }));

const routeGaps: RouteRow[] = [];
for (const r of keepRoutes) {
  if (ROUTE_EXEMPT[r.id]) continue;
  if (!r.url) { routeGaps.push(r); continue; }
  const covered = stories.some((s) => [...s.urls].some((u) => urlSuffixMatch(u, r.url)));
  if (!covered) routeGaps.push(r);
}

// ================================================================
// A2 RPC
// ================================================================
const allProcs: string[] = [...INV.rpc.trpc.items, ...INV.rpc.orpc.items];
const rpcDecided = new Set(Object.keys(SCOPE.rpc_decisions ?? {}));
const rpcInStories = new Set<string>();
// Match a story backtick against an inventory proc:
//   full match        — "workspace.createWorkspace" == "workspace.createWorkspace"
//   suffix match      — ".getSequenceStats" is shorthand for "outreach.getSequenceStats"
//   method segment    — "signIn" is shorthand for "telegram.client.signIn"
for (const s of stories) {
  for (const b of s.backticks) {
    if (b.length < 4) continue;
    for (const p of allProcs) {
      if (p === b) { rpcInStories.add(p); continue; }
      if (p.endsWith("." + b)) { rpcInStories.add(p); continue; }
    }
  }
}
const rpcGaps: string[] = allProcs.filter((p) => !rpcInStories.has(p) && !rpcDecided.has(p));
const rpcOverlap: string[] = allProcs.filter((p) => rpcInStories.has(p) && rpcDecided.has(p));

// ================================================================
// A3 Firestore
// ================================================================
const fsAll: string[] = [...new Set<string>(INV.firestore.items.map((x: any) => x.fn as string))];
const fsDecided = new Set(Object.keys(SCOPE.firestore_decisions ?? {}));
const fsGaps = fsAll.filter((f) => !fsDecided.has(f));

// ================================================================
// A4 postMessage
// ================================================================
const pmAll: string[] = [...new Set<string>(INV.postmessage.items.map((x: any) => x.type as string))];
const pmGaps = pmAll.filter((t) => !new RegExp("`" + t + "`").test(CHAT_SPEC));

// ================================================================
// A5 UI strings (Russian)
// ================================================================
const prose = (STORIES + "\n" + CHAT_SPEC).toLowerCase();
const ignoreLit = new Set<string>((UI_IGNORE.items ?? []).map((s: string) => s.toLowerCase()));
const ignoreRe: RegExp[] = (UI_IGNORE.patterns ?? []).map((p: any) => new RegExp(p.re, "iu"));
// Normalize: lowercase + strip leading/trailing punct + collapse inner whitespace
function norm(s: string): string {
  return s.toLowerCase()
    .replace(/[.,!?;:«»"„"''`()\[\]{}]+$/g, "")
    .replace(/^[.,!?;:«»"„"''`()\[\]{}]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
const proseN = norm(prose);
const uiGaps: string[] = [];
let uiTotal = 0, uiFound = 0, uiIgnored = 0;
if (UI_STRINGS) {
  for (const it of UI_STRINGS.items as { value: string }[]) {
    uiTotal++;
    const v = it.value.trim();
    if (ignoreLit.has(v.toLowerCase())) { uiIgnored++; continue; }
    if (ignoreRe.some((r) => r.test(v))) { uiIgnored++; continue; }
    if (proseN.includes(norm(v))) { uiFound++; continue; }
    uiGaps.push(v);
  }
}

// ================================================================
// Report
// ================================================================
const color = { red: (s: string) => `\x1b[31m${s}\x1b[0m`, green: (s: string) => `\x1b[32m${s}\x1b[0m`, dim: (s: string) => `\x1b[2m${s}\x1b[0m` };
function section(name: string, totals: string, gaps: string[]) {
  const ok = gaps.length === 0;
  console.log();
  console.log(`${ok ? color.green("✓") : color.red("✗")} ${name}  ${color.dim(totals)}`);
  if (!ok) for (const g of gaps) console.log(`  ${color.red("- " + g)}`);
}

console.log("\n=== coverage-check ===");
section("A1 routes",      `${keepRoutes.length} keep, ${Object.keys(ROUTE_EXEMPT).length} exempt, ${routeGaps.length} gaps`,
  routeGaps.map((r) => `${r.id}  (${r.url ?? "no url"})`));
section("A2 rpc",         `${allProcs.length} total, ${rpcInStories.size} in stories, ${rpcDecided.size} decided, ${rpcGaps.length} gaps`,
  rpcGaps);
section("A3 firestore",   `${fsAll.length} fns, ${fsDecided.size} decided, ${fsGaps.length} gaps`,
  fsGaps);
section("A4 postMessage", `${pmAll.length} types, ${pmGaps.length} gaps`,
  pmGaps);
if (UI_STRINGS) {
  section("A5 UI strings",   `${uiTotal} strings, ${uiFound} in prose, ${uiIgnored} ignored, ${uiGaps.length} gaps`,
    uiGaps.slice(0, 40).concat(uiGaps.length > 40 ? [`... and ${uiGaps.length - 40} more (full list in coverage.ui-gaps.txt)`] : []));
  if (uiGaps.length > 40) fs.writeFileSync(path.join(ROOT, "coverage.ui-gaps.txt"), uiGaps.join("\n"));
}

if (rpcOverlap.length) {
  console.log();
  console.log(color.dim(`note: ${rpcOverlap.length} proc(s) mentioned both in stories AND decisions (decision wins):`));
  for (const p of rpcOverlap) console.log(`  · ${p}`);
}

const fails = (routeGaps.length ? 1 : 0) + (rpcGaps.length ? 1 : 0) + (fsGaps.length ? 1 : 0) + (pmGaps.length ? 1 : 0) + (UI_STRINGS && uiGaps.length ? 1 : 0);
const totalSections = UI_STRINGS ? 5 : 4;
console.log();
console.log(fails === 0 ? color.green(`ALL GREEN — coverage proven.`) : color.red(`${fails}/${totalSections} sections have gaps.`));
process.exit(fails === 0 ? 0 : 1);
