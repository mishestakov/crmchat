/**
 * Capability matrix (Phase 2.1) — derive a human-reviewable scope table
 * straight from the static facts. No LLM yet. Rows are at the "one user
 * action / one screen" granularity: one row per route + one synthetic row
 * per backend procedure that isn't reachable from any route.
 *
 * Output: static-analysis/capability_matrix.{json,md}
 *
 * Each row records only PROVEN facts with file:line citations. Interpretive
 * labels (domain, short label) are computed from URL shape — not LLM'd.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(process.cwd(), "..", "..");
const IN_DIR = path.join(ROOT, "static-analysis");
const OUT_JSON = path.join(IN_DIR, "capability_matrix.json");

type Inv = any;
const inv: Inv = JSON.parse(fs.readFileSync(path.join(IN_DIR, "static_inventory.json"), "utf8"));
const byRoute: any = JSON.parse(fs.readFileSync(path.join(IN_DIR, "by_route.json"), "utf8"));
const byBackend: any = JSON.parse(fs.readFileSync(path.join(IN_DIR, "by_backend.json"), "utf8"));

// ---------------------------------------------------------------------------
// Domain / label inference from route file path
// ---------------------------------------------------------------------------

interface Row {
  id: string;
  domain: string;
  label: string;
  kind: "route" | "orphan_procedure";
  route_file: string | null;
  url_pattern: string | null;
  trpc: string[];
  orpc: string[];
  firestore_ops: string[];
  firebase_auth: string[];
  posthog_events: string[];
  i18n_prefixes: string[];       // top-level i18n namespaces found under the subtree
  zod_schemas: string[];
  feature_flags: string[];
  env_vars: string[];
  reachable_files: number;
  proof: {
    route_file: string | null;
    trpc_examples: Array<{ file: string; line: number; proc: string }>;
    orpc_examples: Array<{ file: string; line: number; proc: string }>;
    firestore_examples: Array<{ file: string; line: number; fn: string; path?: string | null }>;
  };
}

function inferDomainAndLabel(routeId: string, routeFile: string | null): { domain: string; label: string; urlPattern: string | null } {
  if (!routeFile) return { domain: "Unknown", label: routeId, urlPattern: null };
  const f = routeFile.replace(/^src\/routes\//, "").replace(/\.(tsx|ts)$/, "");

  // URL pattern derivation: TSR filename → path
  // "_protected" → (pathless layout), "w.$workspaceId" → "/w/{workspaceId}", "$foo" → "/{foo}"
  const segs = f.split("/").flatMap((s) => s.split("."));
  const urlSegs: string[] = [];
  for (const s of segs) {
    if (s === "_protected") continue;         // pathless layout
    if (s === "route") continue;              // layout file marker
    if (s === "index") continue;              // index file
    if (s === "split-component") continue;    // TSR split
    if (s.startsWith("$")) urlSegs.push("{" + s.slice(1) + "}");
    else urlSegs.push(s);
  }
  const urlPattern = "/" + urlSegs.join("/");

  // Domain by first meaningful URL segment
  let domain = "App shell";
  const path = f.toLowerCase();
  if (path.includes("/contacts")) domain = "CRM";
  else if (path.includes("/outreach")) domain = "Outreach";
  else if (path.includes("/telegram")) domain = "Telegram";
  else if (path.includes("/settings/workspace") || path.includes("/accept-invite")) domain = "Workspaces";
  else if (path.includes("/settings")) domain = "Settings";
  else if (path.includes("/wallet")) domain = "Billing";
  else if (path.includes("/onboarding")) domain = "Onboarding";
  else if (path.includes("mini-app")) domain = "Host integration";
  else if (path.match(/^(cello|custom-token-auth|google-calendar-callback|payment-callback|local-redirect)/)) domain = "Integrations";
  else if (path.includes("/w.$workspaceid/route") || path.match(/^_protected\/w\.\$workspaceid$/) || path === "_protected/w.$workspaceid/index") domain = "Workspaces";

  // Label: derive verb from the filename's tail relative to URL pattern
  // A /index.tsx under a dynamic segment is "Detail" (the dynamic page's root),
  // under a literal segment it's "List" (listing of that resource).
  const lastUrl = urlSegs[urlSegs.length - 1] ?? "";
  const lastUrlIsDynamic = lastUrl.startsWith("{");
  const endsIndex = f.endsWith("/index");
  const endsNew = f.endsWith("/new") || /\/new\.[^/]+$/.test(f);
  const endsEdit = f.endsWith("/edit");

  let verb = "";
  if (endsEdit) verb = "Edit";
  else if (endsNew) verb = "New";
  else if (endsIndex && lastUrlIsDynamic) verb = "Detail";
  else if (endsIndex && !lastUrlIsDynamic) verb = "List";
  else if (lastUrlIsDynamic && !endsIndex) verb = "Detail"; // e.g. contacts/$contactId.tsx directly

  let label = routeId.replace(/RouteImport$/, "");
  if (urlSegs.length) {
    const base = urlSegs.filter((s) => !s.startsWith("{")).join(" / ") || "root";
    label = verb ? `${base} — ${verb}` : base;
  }

  return { domain, label, urlPattern };
}

// i18n prefixes come from derive.ts (computed over the full transitive closure).

// ---------------------------------------------------------------------------
// Build rows from routes
// ---------------------------------------------------------------------------

const rows: Row[] = [];

for (const [routeId, rd] of Object.entries<any>(byRoute.routes)) {
  const { domain, label, urlPattern } = inferDomainAndLabel(routeId, rd.file);

  // Seed file set kept for proof-citation filtering (we don't have the full
  // reach list in by_route.json, only the size). i18n prefixes now come from
  // derive.ts, computed over the full transitive closure.
  const reachSeed = new Set<string>(rd.seedFiles);
  const i18nPref: string[] = rd.i18n_prefixes ?? [];

  // Proof snippets: first matching inventory item whose file is inside seed
  const trpcExamples = inv.trpc_calls
    .filter((c: any) => reachSeed.has(c.file) && rd.trpc_procedures.includes(c.procedure))
    .slice(0, 3)
    .map((c: any) => ({ file: c.file, line: c.line, proc: c.procedure }));
  const orpcExamples = inv.orpc_calls
    .filter((c: any) => reachSeed.has(c.file) && rd.orpc_procedures.includes(c.procedure))
    .slice(0, 3)
    .map((c: any) => ({ file: c.file, line: c.line, proc: c.procedure }));
  const fsExamples = inv.firestore_refs
    .filter((c: any) => reachSeed.has(c.file))
    .slice(0, 3)
    .map((c: any) => ({ file: c.file, line: c.line, fn: c.fn, path: c.path }));

  rows.push({
    id: routeId,
    domain,
    label,
    kind: "route",
    route_file: rd.file,
    url_pattern: urlPattern,
    trpc: rd.trpc_procedures,
    orpc: rd.orpc_procedures,
    firestore_ops: rd.firestore_ops,
    firebase_auth: rd.firebase_auth_fns,
    posthog_events: rd.posthog_events,
    i18n_prefixes: i18nPref,
    zod_schemas: rd.zod_schemas,
    feature_flags: rd.feature_flags,
    env_vars: rd.env_vars,
    reachable_files: rd.reachableFiles,
    proof: {
      route_file: rd.file,
      trpc_examples: trpcExamples,
      orpc_examples: orpcExamples,
      firestore_examples: fsExamples,
    },
  });
}

// ---------------------------------------------------------------------------
// Orphan procedures: backend units with routes=[] (only env vars currently)
// ---------------------------------------------------------------------------

for (const u of byBackend.units) {
  if (u.routes.length > 0) continue;
  rows.push({
    id: `orphan::${u.kind}::${u.key}`,
    domain: u.kind === "env" ? "Infra" : "Unknown",
    label: `${u.kind}: ${u.key}`,
    kind: "orphan_procedure",
    route_file: null,
    url_pattern: null,
    trpc: u.kind === "trpc" ? [u.key] : [],
    orpc: u.kind === "orpc" ? [u.key] : [],
    firestore_ops: u.kind === "firestore" ? [u.key] : [],
    firebase_auth: u.kind === "firebase_auth" ? [u.key] : [],
    posthog_events: u.kind === "posthog" ? [u.key] : [],
    i18n_prefixes: [],
    zod_schemas: [],
    feature_flags: u.kind === "feature_flag" ? [u.key] : [],
    env_vars: u.kind === "env" ? [u.key] : [],
    reachable_files: 0,
    proof: {
      route_file: null,
      trpc_examples: [],
      orpc_examples: [],
      firestore_examples: [],
    },
  });
}

// ---------------------------------------------------------------------------
// Coverage check: every inventory unit should attach to ≥1 row
// ---------------------------------------------------------------------------

const coveredTrpc = new Set<string>();
const coveredOrpc = new Set<string>();
const coveredFirestore = new Set<string>();
for (const r of rows) {
  for (const x of r.trpc) coveredTrpc.add(x);
  for (const x of r.orpc) coveredOrpc.add(x);
  for (const x of r.firestore_ops) coveredFirestore.add(x);
}
const allTrpc = new Set(inv.trpc_calls.map((c: any) => c.procedure));
const allOrpc = new Set(inv.orpc_calls.map((c: any) => c.procedure));
const missingTrpc = [...allTrpc].filter((k) => !coveredTrpc.has(k as string));
const missingOrpc = [...allOrpc].filter((k) => !coveredOrpc.has(k as string));

// ---------------------------------------------------------------------------
// Sort rows by domain then label
// ---------------------------------------------------------------------------

const DOMAIN_ORDER = [
  "App shell",
  "Workspaces",
  "Onboarding",
  "CRM",
  "Telegram",
  "Outreach",
  "Billing",
  "Settings",
  "Integrations",
  "Host integration",
  "Infra",
  "Unknown",
];
rows.sort((a, b) => {
  const da = DOMAIN_ORDER.indexOf(a.domain);
  const db = DOMAIN_ORDER.indexOf(b.domain);
  if (da !== db) return da - db;
  return a.label.localeCompare(b.label);
});

// ---------------------------------------------------------------------------
// Write JSON + Markdown
// ---------------------------------------------------------------------------

const byDomain: Record<string, number> = {};
for (const r of rows) byDomain[r.domain] = (byDomain[r.domain] ?? 0) + 1;

const out = {
  meta: {
    generated_from: ["static_inventory.json", "by_route.json", "by_backend.json"],
    total_rows: rows.length,
    by_domain: byDomain,
    coverage: {
      trpc_procedures: { total: allTrpc.size, covered: coveredTrpc.size, missing: missingTrpc },
      orpc_procedures: { total: allOrpc.size, covered: coveredOrpc.size, missing: missingOrpc },
    },
    disclaimer:
      "Domain and label columns are computed heuristically from route URL shape. Only trpc/orpc/firestore/i18n/posthog/files columns are direct machine facts with proof citations. Inferred LLM descriptions are NOT present in this file — they will be added in a separate capability_matrix.enriched.json pass.",
  },
  rows,
};
fs.writeFileSync(OUT_JSON, JSON.stringify(out, null, 2));

console.log(`[+] rows: ${rows.length}`);
console.log(`[+] by domain: ${Object.entries(byDomain).map(([k, v]) => `${k}=${v}`).join(", ")}`);
console.log(`[+] tRPC covered: ${coveredTrpc.size}/${allTrpc.size}${missingTrpc.length ? " (missing: " + missingTrpc.join(", ") + ")" : ""}`);
console.log(`[+] oRPC covered: ${coveredOrpc.size}/${allOrpc.size}${missingOrpc.length ? " (missing: " + missingOrpc.join(", ") + ")" : ""}`);
console.log(`[+] wrote ${OUT_JSON}`);
