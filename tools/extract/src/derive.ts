/**
 * Phase 1: derive by_route.json and by_backend.json from static_inventory.json.
 *
 * by_route[routeId] = everything the route touches, resolved via the transitive
 * import closure (non-type-only edges) starting from the route file + its
 * .split-component sibling.
 *
 * by_backend[unit_key] = inversion: all routes/files that consume the unit,
 * with inputExpr samples when available.
 *
 * Re-runs on identical input MUST produce byte-identical output (stable keys,
 * stable sort, deterministic JSON).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  Project,
  SourceFile,
  SyntaxKind,
  ImportDeclaration,
} from "ts-morph";

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");
const SRC_ROOT = path.join(REPO_ROOT, "reconstructed");
const OUT_DIR = path.join(REPO_ROOT, "static-analysis");
fs.mkdirSync(OUT_DIR, { recursive: true });
const INV_FILE = path.join(OUT_DIR, "static_inventory.json");
const OUT_BY_ROUTE = path.join(OUT_DIR, "by_route.json");
const OUT_BY_BACKEND = path.join(OUT_DIR, "by_backend.json");
const OUT_MD = path.join(OUT_DIR, "by_route.md");

if (!fs.existsSync(INV_FILE)) {
  console.error(`[x] ${INV_FILE} not found — run extract.ts first`);
  process.exit(1);
}

interface Inventory {
  meta: any;
  routes: Array<{ id: string; importFrom: string; file: string | null }>;
  openapi_endpoints: Array<{ key: string; method: string; path: string; summary: string | null; tags: string[] }>;
  trpc_calls: Array<{ file: string; line: number; chain: string[]; kind: string; procedure: string; inputExpr: string | null }>;
  orpc_calls: Array<{ file: string; line: number; chain: string[]; kind: string; procedure: string; inputExpr: string | null; matchedOpenApi: string | null }>;
  firestore_refs: Array<{ file: string; line: number; fn: string; path: string | null; raw: string; op: string | null }>;
  firebase_auth: Array<{ file: string; line: number; fn: string; args: string[] }>;
  zod_schemas: Array<{ file: string; line: number; name: string | null; snippet: string; shape: string[] | null }>;
  fetch_urls: Array<{ file: string; line: number; kind: string; url: string | null; raw: string }>;
  posthog_events: Array<{ file: string; line: number; name: string; propsExpr: string | null }>;
  feature_flags: Array<{ file: string; line: number; name: string; caller: string }>;
  i18n_keys: Array<{ file: string; line: number; key: string; caller: string }>;
  env_vars: Array<{ file: string; line: number; name: string }>;
}

const inv: Inventory = JSON.parse(fs.readFileSync(INV_FILE, "utf-8"));

function norm(p: string): string {
  return p.replace(/\\/g, "/");
}
function rel(p: string): string {
  return norm(path.relative(SRC_ROOT, p));
}
function abs(r: string): string {
  return norm(path.resolve(SRC_ROOT, r));
}

function stableStringify(obj: any): string {
  return JSON.stringify(obj, null, 2);
}
function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

// ---------------------------------------------------------------------------
// Build import graph
// ---------------------------------------------------------------------------

console.log(`[+] loading sources from ${SRC_ROOT}`);
const project = new Project({
  useInMemoryFileSystem: false,
  skipAddingFilesFromTsConfig: true,
  compilerOptions: {
    allowJs: true,
    target: 99,
    module: 99,
    jsx: 1,
    moduleResolution: 100,
    allowArbitraryExtensions: true,
    allowSyntheticDefaultImports: true,
    baseUrl: SRC_ROOT,
  },
});
const files = project.addSourceFilesAtPaths([
  `${SRC_ROOT}/**/*.ts`,
  `${SRC_ROOT}/**/*.tsx`,
]);
console.log(`[+] loaded ${files.length} source files`);

const RESOLVE_EXT = [".ts", ".tsx", ".js", ".jsx"];
const filePathSet = new Set(files.map((f) => norm(f.getFilePath())));

// Project path aliases (inferred from layout: src/, packages/*/src/)
const ALIASES: Array<[RegExp, string]> = [
  [/^@\/(.*)$/, norm(path.join(SRC_ROOT, "src")) + "/$1"],
  [/^@repo\/core(\/.*)?$/, norm(path.join(SRC_ROOT, "packages/core/src")) + "$1"],
  [/^@repo\/csv-parse(\/.*)?$/, norm(path.join(SRC_ROOT, "packages/csv-parse/src")) + "$1"],
  [/^@repo\/message-formatter(\/.*)?$/, norm(path.join(SRC_ROOT, "packages/message-formatter/src")) + "$1"],
];

function resolveSpec(fromFile: string, spec: string): string | null {
  // alias expansion
  for (const [re, tmpl] of ALIASES) {
    const m = spec.match(re);
    if (m) {
      const expanded = tmpl.replace(/\$(\d)/g, (_, i) => m[Number(i)] ?? "");
      return resolveAbsolute(expanded);
    }
  }
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null; // bare (node_modules)
  const baseDir = path.dirname(fromFile);
  const resolved = norm(path.resolve(baseDir, spec));
  return resolveAbsolute(resolved);
}

function resolveAbsolute(resolved: string): string | null {
  if (filePathSet.has(resolved)) return resolved;
  for (const ext of RESOLVE_EXT) {
    const cand = resolved + ext;
    if (filePathSet.has(cand)) return cand;
  }
  for (const ext of RESOLVE_EXT) {
    const cand = norm(path.join(resolved, "index" + ext));
    if (filePathSet.has(cand)) return cand;
  }
  if (resolved.endsWith(".js")) {
    const tsCand = resolved.replace(/\.js$/, ".ts");
    if (filePathSet.has(tsCand)) return tsCand;
    const tsxCand = resolved.replace(/\.js$/, ".tsx");
    if (filePathSet.has(tsxCand)) return tsxCand;
  }
  return null;
}

const graph: Map<string, Set<string>> = new Map();
for (const sf of files) {
  const from = norm(sf.getFilePath());
  const deps = new Set<string>();
  for (const imp of sf.getImportDeclarations()) {
    if (imp.isTypeOnly()) continue;
    // also skip pure-type specifiers (const-only would still be runtime)
    const hasRuntimeImport =
      imp.getDefaultImport() !== undefined ||
      imp.getNamespaceImport() !== undefined ||
      imp.getNamedImports().some((ni) => !ni.isTypeOnly()) ||
      (!imp.getDefaultImport() && !imp.getNamespaceImport() && imp.getNamedImports().length === 0);
    if (!hasRuntimeImport) continue;
    const spec = imp.getModuleSpecifierValue();
    const target = resolveSpec(from, spec);
    if (target) deps.add(target);
  }
  // Also pick up dynamic import("...") expressions
  sf.forEachDescendant((node) => {
    if (node.isKind(SyntaxKind.CallExpression)) {
      const call = node.asKindOrThrow(SyntaxKind.CallExpression);
      const expr = call.getExpression();
      if (expr.getKind() === SyntaxKind.ImportKeyword) {
        const arg0 = call.getArguments()[0];
        if (arg0 && arg0.isKind(SyntaxKind.StringLiteral)) {
          const t = resolveSpec(from, arg0.getLiteralText());
          if (t) deps.add(t);
        }
      }
    }
  });
  graph.set(from, deps);
}
console.log(`[+] built import graph (${graph.size} nodes)`);

// ---------------------------------------------------------------------------
// Transitive closure per route
// ---------------------------------------------------------------------------

function closure(seedFiles: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...seedFiles];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const deps = graph.get(cur);
    if (deps) for (const d of deps) if (!seen.has(d)) stack.push(d);
  }
  return seen;
}

// Build file -> bucket indexes once
type LocItem = { file: string };
function indexByFile<T extends LocItem>(arr: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of arr) {
    const a = m.get(x.file) ?? [];
    a.push(x);
    m.set(x.file, a);
  }
  return m;
}

const idxTrpc = indexByFile(inv.trpc_calls);
const idxOrpc = indexByFile(inv.orpc_calls);
const idxFs = indexByFile(inv.firestore_refs);
const idxFbAuth = indexByFile(inv.firebase_auth);
const idxZod = indexByFile(inv.zod_schemas);
const idxFetch = indexByFile(inv.fetch_urls);
const idxPosthog = indexByFile(inv.posthog_events);
const idxFlags = indexByFile(inv.feature_flags);
const idxI18n = indexByFile(inv.i18n_keys);
const idxEnv = indexByFile(inv.env_vars);

interface RouteDerivation {
  id: string;
  file: string;
  seedFiles: string[];
  reachableFiles: number;
  trpc_procedures: string[];
  orpc_procedures: string[];
  firestore_ops: string[];      // "fn:path" pairs
  firebase_auth_fns: string[];
  zod_schemas: string[];        // names (unique, null dropped)
  fetch_urls: string[];
  posthog_events: string[];
  feature_flags: string[];
  i18n_keys_count: number;      // they're huge — don't inline, just count
  env_vars: string[];
}

const byRoute: Record<string, RouteDerivation> = {};

for (const r of inv.routes) {
  if (!r.file) continue;
  const seedAbs = abs(r.file);
  if (!filePathSet.has(seedAbs)) continue;

  // also include split-component sibling if present
  const seeds = [seedAbs];
  const splitVariants = [
    seedAbs.replace(/\.tsx$/, ".split-component.tsx"),
    seedAbs.replace(/\.ts$/, ".split-component.ts"),
  ];
  for (const v of splitVariants) if (filePathSet.has(v)) seeds.push(v);

  const reach = closure(seeds);

  const trpc = new Set<string>();
  const orpc = new Set<string>();
  const fs_ = new Set<string>();
  const fbAuth = new Set<string>();
  const zodNames = new Set<string>();
  const fetchSet = new Set<string>();
  const posthog = new Set<string>();
  const flags = new Set<string>();
  const envs = new Set<string>();
  let i18nCount = 0;

  for (const fAbs of reach) {
    const fRel = rel(fAbs);
    for (const c of idxTrpc.get(fRel) ?? []) trpc.add(c.procedure);
    for (const c of idxOrpc.get(fRel) ?? []) orpc.add(c.procedure);
    for (const c of idxFs.get(fRel) ?? []) fs_.add(`${c.fn}${c.path ? ":" + c.path : ""}`);
    for (const c of idxFbAuth.get(fRel) ?? []) fbAuth.add(c.fn);
    for (const c of idxZod.get(fRel) ?? []) if (c.name) zodNames.add(c.name);
    for (const c of idxFetch.get(fRel) ?? []) fetchSet.add(c.url ?? c.raw);
    for (const c of idxPosthog.get(fRel) ?? []) posthog.add(c.name);
    for (const c of idxFlags.get(fRel) ?? []) flags.add(c.name);
    for (const _ of idxI18n.get(fRel) ?? []) i18nCount++;
    for (const c of idxEnv.get(fRel) ?? []) envs.add(c.name);
  }

  byRoute[r.id] = {
    id: r.id,
    file: r.file,
    seedFiles: seeds.map(rel).sort(),
    reachableFiles: reach.size,
    trpc_procedures: [...trpc].sort(),
    orpc_procedures: [...orpc].sort(),
    firestore_ops: [...fs_].sort(),
    firebase_auth_fns: [...fbAuth].sort(),
    zod_schemas: [...zodNames].sort(),
    fetch_urls: [...fetchSet].sort(),
    posthog_events: [...posthog].sort(),
    feature_flags: [...flags].sort(),
    i18n_keys_count: i18nCount,
    env_vars: [...envs].sort(),
  };
}

// Sort routes by id
const byRouteSorted: Record<string, RouteDerivation> = {};
for (const id of Object.keys(byRoute).sort()) byRouteSorted[id] = byRoute[id];

// ---------------------------------------------------------------------------
// Inversion: by_backend
// ---------------------------------------------------------------------------

interface BackendUnit {
  kind: "trpc" | "orpc" | "firestore" | "firebase_auth" | "posthog" | "feature_flag" | "fetch" | "env";
  key: string;                // procedure / path / event / flag / url / var
  call_sites: Array<{ file: string; line: number; inputExpr?: string | null }>;
  routes: string[];           // route ids that reach this unit
  extra?: Record<string, any>;
}

const units: Map<string, BackendUnit> = new Map();

function getUnit(kind: BackendUnit["kind"], key: string, extra?: Record<string, any>): BackendUnit {
  const k = `${kind}::${key}`;
  let u = units.get(k);
  if (!u) {
    u = { kind, key, call_sites: [], routes: [] };
    if (extra) u.extra = extra;
    units.set(k, u);
  }
  return u;
}

for (const c of inv.trpc_calls) {
  getUnit("trpc", c.procedure).call_sites.push({ file: c.file, line: c.line, inputExpr: c.inputExpr });
}
for (const c of inv.orpc_calls) {
  const u = getUnit("orpc", c.procedure, c.matchedOpenApi ? { openapi: c.matchedOpenApi } : undefined);
  u.call_sites.push({ file: c.file, line: c.line, inputExpr: c.inputExpr });
}
// group firestore refs by `fn:path` OR by collection root (first path segment) when path literal
for (const c of inv.firestore_refs) {
  const key = `${c.fn}${c.path ? ":" + c.path : ""}`;
  getUnit("firestore", key).call_sites.push({ file: c.file, line: c.line });
}
for (const c of inv.firebase_auth) {
  getUnit("firebase_auth", c.fn).call_sites.push({ file: c.file, line: c.line });
}
for (const c of inv.posthog_events) {
  getUnit("posthog", c.name).call_sites.push({ file: c.file, line: c.line });
}
for (const c of inv.feature_flags) {
  getUnit("feature_flag", c.name).call_sites.push({ file: c.file, line: c.line });
}
for (const c of inv.fetch_urls) {
  if (c.url) getUnit("fetch", c.url).call_sites.push({ file: c.file, line: c.line });
}
for (const c of inv.env_vars) {
  getUnit("env", c.name).call_sites.push({ file: c.file, line: c.line });
}

// reverse: routes per unit. Build file→routes index first, then for each call site
const fileToRoutes: Map<string, Set<string>> = new Map();
for (const [routeId, rd] of Object.entries(byRouteSorted)) {
  const reach = closure([abs(rd.file), ...rd.seedFiles.map(abs)]);
  for (const f of reach) {
    const rfile = rel(f);
    const s = fileToRoutes.get(rfile) ?? new Set();
    s.add(routeId);
    fileToRoutes.set(rfile, s);
  }
}

for (const u of units.values()) {
  const routes = new Set<string>();
  for (const cs of u.call_sites) {
    const rs = fileToRoutes.get(cs.file);
    if (rs) for (const r of rs) routes.add(r);
  }
  u.routes = [...routes].sort();
  u.call_sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

const byBackendSorted: BackendUnit[] = [...units.values()].sort(
  (a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key),
);

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

const byRouteOut = {
  meta: {
    generated_from: "static_inventory.json",
    source_inventory_sha: inv.meta?.sha256 ?? null,
    route_count: Object.keys(byRouteSorted).length,
  },
  routes: byRouteSorted,
};
fs.writeFileSync(OUT_BY_ROUTE, stableStringify(byRouteOut));
console.log(`[+] wrote ${OUT_BY_ROUTE} (${fs.statSync(OUT_BY_ROUTE).size.toLocaleString()} bytes)`);

const byBackendOut = {
  meta: {
    generated_from: "static_inventory.json",
    source_inventory_sha: inv.meta?.sha256 ?? null,
    unit_count: byBackendSorted.length,
    by_kind: Object.fromEntries(
      [...new Set(byBackendSorted.map((u) => u.kind))].map((k) => [
        k,
        byBackendSorted.filter((u) => u.kind === k).length,
      ]),
    ),
  },
  units: byBackendSorted,
};
fs.writeFileSync(OUT_BY_BACKEND, stableStringify(byBackendOut));
console.log(`[+] wrote ${OUT_BY_BACKEND} (${fs.statSync(OUT_BY_BACKEND).size.toLocaleString()} bytes)`);

// Human summary (by_route.md)
const md: string[] = [];
md.push(`# by_route — per-screen backend surface\n`);
md.push(`Derived from \`static_inventory.json\` over ${files.length} files / ${Object.keys(byRouteSorted).length} routes.\n`);
for (const [rid, rd] of Object.entries(byRouteSorted)) {
  md.push(`\n## ${rid}`);
  md.push(`- file: \`${rd.file}\``);
  md.push(`- reachable files: ${rd.reachableFiles}`);
  if (rd.trpc_procedures.length) md.push(`- tRPC: ${rd.trpc_procedures.map(s=>`\`${s}\``).join(", ")}`);
  if (rd.orpc_procedures.length) md.push(`- oRPC: ${rd.orpc_procedures.map(s=>`\`${s}\``).join(", ")}`);
  if (rd.firestore_ops.length) md.push(`- Firestore: ${rd.firestore_ops.map(s=>`\`${s}\``).join(", ")}`);
  if (rd.firebase_auth_fns.length) md.push(`- Firebase Auth: ${rd.firebase_auth_fns.join(", ")}`);
  if (rd.posthog_events.length) md.push(`- Posthog: ${rd.posthog_events.map(s=>`\`${s}\``).join(", ")}`);
  if (rd.feature_flags.length) md.push(`- Flags: ${rd.feature_flags.map(s=>`\`${s}\``).join(", ")}`);
  if (rd.env_vars.length) md.push(`- Env: ${rd.env_vars.join(", ")}`);
  if (rd.fetch_urls.length) md.push(`- fetch: ${rd.fetch_urls.slice(0,6).join(", ")}`);
  md.push(`- i18n keys: ${rd.i18n_keys_count}`);
}
fs.writeFileSync(OUT_MD, md.join("\n"));
console.log(`[+] wrote ${OUT_MD}`);
