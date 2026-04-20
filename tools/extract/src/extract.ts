/**
 * Static fact extractor for reconstructed CRMchat frontend.
 *
 * Parses every .ts/.tsx under reconstructed/ with ts-morph and emits a
 * single JSON file: static_inventory.json. Each category is a closed
 * syntactic predicate — i.e. if a call site matches category X, it is
 * in the output; if not, it is either (a) in `dynamic_call_sites` or
 * (b) outside the category definition. Re-runs on identical input
 * MUST produce byte-identical output.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  Project,
  SyntaxKind,
  Node,
  CallExpression,
  PropertyAccessExpression,
  StringLiteral,
  NoSubstitutionTemplateLiteral,
  TemplateExpression,
  JsxAttribute,
  JsxOpeningElement,
  JsxSelfClosingElement,
  SourceFile,
} from "ts-morph";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(process.cwd(), "..", "..");
const SRC_ROOT = path.join(REPO_ROOT, "reconstructed");
const OUT_DIR = path.join(REPO_ROOT, "static-analysis");
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT_FILE = path.join(OUT_DIR, "static_inventory.json");
const OUT_MD = path.join(OUT_DIR, "static_inventory.md");

if (!fs.existsSync(SRC_ROOT)) {
  console.error(`[x] ${SRC_ROOT} not found`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Loc {
  file: string;
  line: number;
}

interface RouteEntry {
  id: string;           // generated symbol name
  importFrom: string;   // "./routes/_protected/..."
  file: string | null;  // resolved relative file path
}

interface TrpcCall extends Loc {
  chain: string[];      // ["useTRPC","contacts","list","useQuery"]
  kind: string;         // "useQuery" | "useMutation" | "useSuspenseQuery" | ...
  procedure: string;    // "contacts.list" — namespace path before kind
  inputExpr: string | null; // raw text of first argument, or null
}

interface OrpcCall extends Loc {
  chain: string[];
  kind: string;
  procedure: string;
  inputExpr: string | null;
  matchedOpenApi: string | null; // e.g. "GET /workspaces/{workspaceId}/contacts"
}

interface OpenApiEndpoint {
  key: string;        // "contacts.list"
  method: string;
  path: string;
  summary: string | null;
  tags: string[];
}

interface FirestoreRef extends Loc {
  fn: string;           // "doc" | "collection" | "collectionGroup" | "query" | ...
  path: string | null;  // path template if derivable
  raw: string;          // raw argument text
  op: string | null;    // outer call: onSnapshot | getDoc | getDocs | setDoc | updateDoc | addDoc | deleteDoc
}

interface FirebaseAuthCall extends Loc {
  fn: string;           // signInWithCustomToken, signInWithPopup, GoogleAuthProvider, etc.
  args: string[];       // raw arg text
}

interface ZodSchema extends Loc {
  name: string | null;  // from VariableDeclaration if available
  snippet: string;      // first ~400 chars of the expression
  shape: string[] | null; // field names if z.object literal, else null
}

interface FetchUrl extends Loc {
  kind: string;         // "fetch" | "axios.get" | ...
  url: string | null;   // literal if derivable
  raw: string;          // raw arg text
}

interface PosthogEvent extends Loc {
  name: string;
  propsExpr: string | null;
}

interface FeatureFlag extends Loc {
  name: string;
  caller: string;
}

interface I18nKey extends Loc {
  key: string;
  caller: string;       // t() | Trans | i18nKey
}

interface EnvVar extends Loc {
  name: string;
}

interface DynamicCallSite extends Loc {
  category: string;     // which extractor gave up
  raw: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rel(p: string): string {
  return path.relative(SRC_ROOT, p).replace(/\\/g, "/");
}

function loc(node: Node): Loc {
  const sf = node.getSourceFile();
  return {
    file: rel(sf.getFilePath()),
    line: node.getStartLineNumber(),
  };
}

function asLiteralString(node: Node | undefined): string | null {
  if (!node) return null;
  if (node.isKind(SyntaxKind.StringLiteral)) {
    return (node as StringLiteral).getLiteralValue();
  }
  if (node.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    return (node as NoSubstitutionTemplateLiteral).getLiteralValue();
  }
  // template expression with no interpolations? handled above. Otherwise null.
  return null;
}

/** Walk a PropertyAccess chain back to a flat list of identifiers and final call name. */
function unfoldChain(node: Node): string[] {
  const parts: string[] = [];
  let cur: Node | undefined = node;
  while (cur) {
    if (cur.isKind(SyntaxKind.PropertyAccessExpression)) {
      const pae = cur as PropertyAccessExpression;
      parts.unshift(pae.getName());
      cur = pae.getExpression();
    } else if (cur.isKind(SyntaxKind.CallExpression)) {
      cur = (cur as CallExpression).getExpression();
    } else if (cur.isKind(SyntaxKind.Identifier)) {
      parts.unshift((cur as any).getText());
      cur = undefined;
    } else {
      break;
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Extract: Routes (from src/routeTree.gen.ts)
// ---------------------------------------------------------------------------

function extractRoutes(project: Project): RouteEntry[] {
  const routeTreeFile = project.getSourceFile((sf) =>
    sf.getFilePath().endsWith("/routeTree.gen.ts"),
  );
  if (!routeTreeFile) return [];
  const out: RouteEntry[] = [];
  for (const decl of routeTreeFile.getImportDeclarations()) {
    const from = decl.getModuleSpecifierValue();
    if (!from.startsWith("./routes")) continue;
    for (const namedImport of decl.getNamedImports()) {
      const id = namedImport.getAliasNode()?.getText() ?? namedImport.getName();
      // resolve file on disk (try .tsx / .ts / /index.*)
      const base = path.resolve(path.dirname(routeTreeFile.getFilePath()), from);
      const candidates = [
        `${base}.tsx`, `${base}.ts`,
        path.join(base, "index.tsx"), path.join(base, "index.ts"),
      ];
      const hit = candidates.find((p) => fs.existsSync(p));
      out.push({
        id,
        importFrom: from,
        file: hit ? rel(hit) : null,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extract: tRPC calls
// Pattern: useTRPC().<ns>.<proc...>.<useQuery|useMutation|useSuspenseQuery|useInfiniteQuery|queryOptions|...>(...)
// ---------------------------------------------------------------------------

const TRPC_KINDS = new Set([
  "useQuery", "useMutation", "useSuspenseQuery", "useInfiniteQuery",
  "useSuspenseInfiniteQuery", "queryOptions", "mutationOptions",
  "infiniteQueryOptions", "subscribeOptions", "useSubscription",
  "query", "mutate", "mutateAsync",
]);

function extractTrpc(project: Project, dynamics: DynamicCallSite[]): TrpcCall[] {
  const out: TrpcCall[] = [];
  for (const sf of project.getSourceFiles()) {
    sf.forEachDescendant((node) => {
      if (!node.isKind(SyntaxKind.CallExpression)) return;
      const call = node as CallExpression;
      const expr = call.getExpression();
      if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) return;
      const method = (expr as PropertyAccessExpression).getName();
      if (!TRPC_KINDS.has(method)) return;
      const chain = unfoldChain(expr);
      // Chain must start with useTRPC() or trpc (TRPCProvider client)
      const root = chain[0];
      if (root !== "useTRPC" && root !== "trpc") return;
      if (chain.length < 3) return; // need ns + proc + kind
      // strip root + trailing method, middle = procedure path
      const procedureParts = chain.slice(1, -1);
      if (procedureParts.length === 0) return;
      const args = call.getArguments();
      const inputExpr = args.length > 0 ? args[0].getText().slice(0, 500) : null;
      out.push({
        ...loc(node),
        chain,
        kind: method,
        procedure: procedureParts.join("."),
        inputExpr,
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extract: oRPC calls (orpc.X.Y.use*() and api.X.Y())
// ---------------------------------------------------------------------------

const ORPC_KINDS = new Set([
  ...TRPC_KINDS,
  "call", "key", "queryKey", "prefetch", "prefetchQuery",
]);

function extractOrpc(
  project: Project,
  contract: Map<string, OpenApiEndpoint>,
): OrpcCall[] {
  const out: OrpcCall[] = [];
  for (const sf of project.getSourceFiles()) {
    sf.forEachDescendant((node) => {
      if (!node.isKind(SyntaxKind.CallExpression)) return;
      const call = node as CallExpression;
      const expr = call.getExpression();
      if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) return;
      const chain = unfoldChain(expr);
      const root = chain[0];
      if (root !== "orpc" && root !== "api") return;
      const method = (expr as PropertyAccessExpression).getName();

      // For `orpc.X.Y.useQuery(...)`: chain = ["orpc","X","Y","useQuery"]
      // For `api.X.Y(...)`: chain = ["api","X","Y"] — treat entire chain as procedure
      let procedureParts: string[];
      let kind: string;
      if (root === "orpc" && ORPC_KINDS.has(method)) {
        procedureParts = chain.slice(1, -1);
        kind = method;
      } else if (root === "api") {
        procedureParts = chain.slice(1);
        kind = "call";
      } else {
        return;
      }
      if (procedureParts.length === 0) return;
      const procedure = procedureParts.join(".");
      const args = call.getArguments();
      const inputExpr = args.length > 0 ? args[0].getText().slice(0, 500) : null;
      const matched = contract.get(procedure);
      out.push({
        ...loc(node),
        chain,
        kind,
        procedure,
        inputExpr,
        matchedOpenApi: matched ? `${matched.method} ${matched.path}` : null,
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extract: OpenAPI endpoints from api-contract.generated.json
// ---------------------------------------------------------------------------

function extractOpenApi(): {
  endpoints: OpenApiEndpoint[];
  byKey: Map<string, OpenApiEndpoint>;
} {
  const p = path.join(SRC_ROOT, "src", "lib", "api-contract.generated.json");
  if (!fs.existsSync(p)) return { endpoints: [], byKey: new Map() };
  const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  const endpoints: OpenApiEndpoint[] = [];
  function walk(obj: any, trail: string[]) {
    if (obj && typeof obj === "object") {
      if (obj["~orpc"] && obj["~orpc"].route) {
        const r = obj["~orpc"].route;
        endpoints.push({
          key: trail.join("."),
          method: r.method ?? "UNKNOWN",
          path: r.path ?? "",
          summary: r.summary ?? null,
          tags: r.tags ?? [],
        });
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        if (k === "~orpc") continue;
        walk(v, [...trail, k]);
      }
    }
  }
  walk(raw, []);
  const byKey = new Map(endpoints.map((e) => [e.key, e]));
  return { endpoints, byKey };
}

// ---------------------------------------------------------------------------
// Extract: Firestore refs
// ---------------------------------------------------------------------------

const FS_FNS = new Set([
  "doc", "collection", "collectionGroup", "query",
  "where", "orderBy", "limit", "startAfter", "endBefore",
]);
const FS_OPS = new Set([
  "onSnapshot", "getDoc", "getDocs", "setDoc", "updateDoc", "addDoc",
  "deleteDoc", "deleteField", "writeBatch", "runTransaction", "serverTimestamp",
  "increment", "arrayUnion", "arrayRemove",
]);

function extractFirestore(project: Project): FirestoreRef[] {
  const out: FirestoreRef[] = [];
  for (const sf of project.getSourceFiles()) {
    sf.forEachDescendant((node) => {
      if (!node.isKind(SyntaxKind.CallExpression)) return;
      const call = node as CallExpression;
      const exprText = call.getExpression().getText();
      if (!FS_FNS.has(exprText) && !FS_OPS.has(exprText)) return;
      const args = call.getArguments();
      const raw = args.map((a) => a.getText()).join(", ").slice(0, 300);
      // find string literal among args (the path)
      let pathStr: string | null = null;
      for (const a of args) {
        const lit = asLiteralString(a);
        if (lit) { pathStr = lit; break; }
      }
      // try to detect outer op wrapping this (e.g. onSnapshot(collection(...)))
      let op: string | null = null;
      const parent = node.getParent();
      if (parent && parent.isKind(SyntaxKind.CallExpression)) {
        const parentFn = (parent as CallExpression).getExpression().getText();
        if (FS_OPS.has(parentFn)) op = parentFn;
      }
      out.push({
        ...loc(node),
        fn: exprText,
        path: pathStr,
        raw,
        op,
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extract: Firebase Auth usage
// ---------------------------------------------------------------------------

const FB_AUTH_FNS = [
  "signInWithCustomToken", "signInWithPopup", "signInWithRedirect",
  "signInWithEmailAndPassword", "signInWithEmailLink", "signInWithPhoneNumber",
  "signInAnonymously", "signInWithCredential",
  "createUserWithEmailAndPassword",
  "signOut", "linkWithPopup", "linkWithRedirect", "linkWithCredential",
  "onAuthStateChanged", "onIdTokenChanged",
  "sendPasswordResetEmail", "sendEmailVerification", "sendSignInLinkToEmail",
  "updateProfile", "updatePassword", "updateEmail",
  "GoogleAuthProvider", "FacebookAuthProvider", "OAuthProvider",
  "reauthenticateWithCredential", "reauthenticateWithPopup",
];
const FB_AUTH_SET = new Set(FB_AUTH_FNS);

function extractFirebaseAuth(project: Project): FirebaseAuthCall[] {
  const out: FirebaseAuthCall[] = [];
  for (const sf of project.getSourceFiles()) {
    sf.forEachDescendant((node) => {
      if (!node.isKind(SyntaxKind.CallExpression) && !node.isKind(SyntaxKind.NewExpression)) return;
      const call = node as CallExpression;
      const exprText = call.getExpression().getText();
      const tail = exprText.split(".").pop() ?? exprText;
      if (!FB_AUTH_SET.has(tail)) return;
      const args = call.getArguments().map((a) => a.getText().slice(0, 200));
      out.push({
        ...loc(node),
        fn: tail,
        args,
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extract: Zod schemas
// ---------------------------------------------------------------------------

function extractZod(project: Project): ZodSchema[] {
  const out: ZodSchema[] = [];
  for (const sf of project.getSourceFiles()) {
    sf.forEachDescendant((node) => {
      if (!node.isKind(SyntaxKind.CallExpression)) return;
      const call = node as CallExpression;
      const expr = call.getExpression();
      if (!expr.isKind(SyntaxKind.PropertyAccessExpression)) return;
      const pae = expr as PropertyAccessExpression;
      const obj = pae.getExpression().getText();
      const name = pae.getName();
      if (obj !== "z" || name !== "object") return;

      // try to grab variable name (const X = z.object(...))
      let varName: string | null = null;
      let parent: Node | undefined = node.getParent();
      while (parent) {
        if (parent.isKind(SyntaxKind.VariableDeclaration)) {
          varName = parent.getFirstChildByKind(SyntaxKind.Identifier)?.getText() ?? null;
          break;
        }
        parent = parent.getParent();
      }
      const args = call.getArguments();
      let shape: string[] | null = null;
      if (args.length > 0 && args[0].isKind(SyntaxKind.ObjectLiteralExpression)) {
        shape = (args[0] as any).getProperties().map((p: any) => {
          if (p.getName) return p.getName();
          return p.getText().split(":")[0].trim();
        });
      }
      out.push({
        ...loc(node),
        name: varName,
        snippet: call.getText().slice(0, 400),
        shape,
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extract: fetch / axios
// ---------------------------------------------------------------------------

function extractFetch(project: Project): FetchUrl[] {
  const out: FetchUrl[] = [];
  for (const sf of project.getSourceFiles()) {
    sf.forEachDescendant((node) => {
      if (!node.isKind(SyntaxKind.CallExpression)) return;
      const call = node as CallExpression;
      const exprText = call.getExpression().getText();
      const m = exprText.match(/^(fetch|axios(?:\.(?:get|post|put|patch|delete|request|head))?)$/);
      if (!m) return;
      const args = call.getArguments();
      if (args.length === 0) return;
      const url = asLiteralString(args[0]);
      out.push({
        ...loc(node),
        kind: exprText,
        url,
        raw: args[0].getText().slice(0, 300),
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extract: Posthog events
// ---------------------------------------------------------------------------

function extractPosthog(project: Project): PosthogEvent[] {
  const out: PosthogEvent[] = [];
  for (const sf of project.getSourceFiles()) {
    sf.forEachDescendant((node) => {
      if (!node.isKind(SyntaxKind.CallExpression)) return;
      const call = node as CallExpression;
      const exprText = call.getExpression().getText();
      if (!/(^|\.)posthog\.capture$/.test(exprText) &&
          !/capture$/.test(exprText.split(".").slice(-2).join("."))) return;
      // Narrow: only match identifier ending with "capture" AND accessed on something named posthog-ish
      if (!/posthog/i.test(exprText)) return;
      const args = call.getArguments();
      const name = args[0] ? asLiteralString(args[0]) : null;
      if (!name) return;
      const props = args[1]?.getText().slice(0, 300) ?? null;
      out.push({ ...loc(node), name, propsExpr: props });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extract: Feature flags
// ---------------------------------------------------------------------------

function extractFeatureFlags(project: Project): FeatureFlag[] {
  const out: FeatureFlag[] = [];
  for (const sf of project.getSourceFiles()) {
    sf.forEachDescendant((node) => {
      if (!node.isKind(SyntaxKind.CallExpression)) return;
      const call = node as CallExpression;
      const exprText = call.getExpression().getText();
      const tail = exprText.split(".").pop() ?? exprText;
      if (!/^(useFeatureFlag|isFeatureEnabled|hasFeature|getFeatureFlag|useFlag|useFeatureFlagEnabled|useFeatureFlagPayload)$/.test(tail)) return;
      const args = call.getArguments();
      const name = args[0] ? asLiteralString(args[0]) : null;
      if (!name) return;
      out.push({ ...loc(node), name, caller: exprText });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extract: i18n keys
// ---------------------------------------------------------------------------

function extractI18n(project: Project): I18nKey[] {
  const out: I18nKey[] = [];
  const seen = new Set<string>();
  for (const sf of project.getSourceFiles()) {
    sf.forEachDescendant((node) => {
      // 1) t("key") — tail of expression is exactly "t"
      if (node.isKind(SyntaxKind.CallExpression)) {
        const call = node as CallExpression;
        const exprText = call.getExpression().getText();
        const tail = exprText.split(".").pop() ?? exprText;
        if (tail === "t" || tail === "translate" || tail === "i18n") {
          const args = call.getArguments();
          const key = args[0] ? asLiteralString(args[0]) : null;
          if (key) {
            const l = loc(node);
            const sig = `${l.file}:${l.line}:${key}`;
            if (!seen.has(sig)) {
              seen.add(sig);
              out.push({ ...l, key, caller: exprText });
            }
          }
        }
      }
      // 2) <Trans i18nKey="..." /> JSX
      if (node.isKind(SyntaxKind.JsxAttribute)) {
        const attr = node as JsxAttribute;
        if (attr.getNameNode().getText() !== "i18nKey") return;
        const init = attr.getInitializer();
        if (!init) return;
        const val = init.isKind(SyntaxKind.StringLiteral)
          ? (init as StringLiteral).getLiteralValue()
          : null;
        if (val) {
          out.push({ ...loc(node), key: val, caller: "i18nKey" });
        }
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extract: Env vars
// ---------------------------------------------------------------------------

function extractEnv(project: Project): EnvVar[] {
  const out: EnvVar[] = [];
  const seen = new Set<string>();
  for (const sf of project.getSourceFiles()) {
    sf.forEachDescendant((node) => {
      if (!node.isKind(SyntaxKind.PropertyAccessExpression)) return;
      const pae = node as PropertyAccessExpression;
      const parent = pae.getExpression();
      // import.meta.env.FOO
      if (parent.isKind(SyntaxKind.PropertyAccessExpression)) {
        const p2 = parent as PropertyAccessExpression;
        if (p2.getName() === "env" &&
            p2.getExpression().getText() === "import.meta") {
          const name = pae.getName();
          const l = loc(node);
          const sig = `${l.file}:${name}`;
          if (!seen.has(sig)) { seen.add(sig); out.push({ ...l, name }); }
        }
      }
      // process.env.FOO
      if (parent.isKind(SyntaxKind.PropertyAccessExpression)) {
        const p2 = parent as PropertyAccessExpression;
        if (p2.getName() === "env" && p2.getExpression().getText() === "process") {
          const name = pae.getName();
          const l = loc(node);
          const sig = `${l.file}:${name}`;
          if (!seen.has(sig)) { seen.add(sig); out.push({ ...l, name }); }
        }
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

function stableStringify(obj: any): string {
  return JSON.stringify(obj, (_k, v) => v, 2);
}

function sha256(str: string): string {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function sortByLoc<T extends Loc>(arr: T[]): T[] {
  return [...arr].sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });
}

async function main() {
  console.log(`[+] scanning ${SRC_ROOT}`);
  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      allowJs: true,
      target: 99, // ESNext
      module: 99,
      jsx: 1,     // Preserve
      moduleResolution: 100,
      allowArbitraryExtensions: true,
      allowSyntheticDefaultImports: true,
    },
  });
  const files = project.addSourceFilesAtPaths([
    `${SRC_ROOT}/**/*.ts`,
    `${SRC_ROOT}/**/*.tsx`,
  ]);
  console.log(`[+] loaded ${files.length} source files`);

  const dynamics: DynamicCallSite[] = [];

  const openapi = extractOpenApi();
  console.log(`    openapi endpoints:  ${openapi.endpoints.length}`);

  const routes = extractRoutes(project);
  console.log(`    routes:             ${routes.length}`);

  const trpc = extractTrpc(project, dynamics);
  console.log(`    trpc calls:         ${trpc.length}`);

  const orpc = extractOrpc(project, openapi.byKey);
  console.log(`    orpc calls:         ${orpc.length}`);

  const firestore = extractFirestore(project);
  console.log(`    firestore refs:     ${firestore.length}`);

  const fbAuth = extractFirebaseAuth(project);
  console.log(`    firebase auth:      ${fbAuth.length}`);

  const zod = extractZod(project);
  console.log(`    zod schemas:        ${zod.length}`);

  const fetches = extractFetch(project);
  console.log(`    fetch/axios:        ${fetches.length}`);

  const posthog = extractPosthog(project);
  console.log(`    posthog events:     ${posthog.length}`);

  const flags = extractFeatureFlags(project);
  console.log(`    feature flags:      ${flags.length}`);

  const i18n = extractI18n(project);
  console.log(`    i18n keys:          ${i18n.length}`);

  const envs = extractEnv(project);
  console.log(`    env vars:           ${envs.length}`);

  // Sort everything deterministically
  const inventory = {
    routes: [...routes].sort((a, b) => a.id.localeCompare(b.id)),
    openapi_endpoints: [...openapi.endpoints].sort((a, b) => a.key.localeCompare(b.key)),
    trpc_calls: sortByLoc(trpc),
    orpc_calls: sortByLoc(orpc),
    firestore_refs: sortByLoc(firestore),
    firebase_auth: sortByLoc(fbAuth),
    zod_schemas: sortByLoc(zod),
    fetch_urls: sortByLoc(fetches),
    posthog_events: sortByLoc(posthog),
    feature_flags: sortByLoc(flags),
    i18n_keys: sortByLoc(i18n),
    env_vars: sortByLoc(envs),
    dynamic_call_sites: sortByLoc(dynamics),
  };

  // Per-category checksums (proof of idempotency)
  const hashes: Record<string, string> = {};
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(inventory)) {
    hashes[k] = sha256(stableStringify(v));
    counts[k] = (v as any[]).length;
  }

  const final = {
    meta: {
      generated_from: rel(SRC_ROOT),
      file_count: files.length,
      counts,
      sha256: hashes,
    },
    ...inventory,
  };

  fs.writeFileSync(OUT_FILE, stableStringify(final));
  console.log(`\n[+] wrote ${OUT_FILE}`);
  console.log(`[+] total bytes: ${fs.statSync(OUT_FILE).size.toLocaleString()}`);

  // Human summary
  const md: string[] = [];
  md.push(`# Static inventory\n`);
  md.push(`Scanned: ${files.length} files under \`${rel(SRC_ROOT)}\`\n`);
  md.push(`\n## Counts\n`);
  for (const [k, v] of Object.entries(counts)) {
    md.push(`- **${k}**: ${v}`);
  }
  md.push(`\n## Per-category SHA-256 (re-runs must match)\n`);
  for (const [k, v] of Object.entries(hashes)) {
    md.push(`- \`${k}\` = \`${v}\``);
  }
  fs.writeFileSync(OUT_MD, md.join("\n"));
  console.log(`[+] wrote ${OUT_MD}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
