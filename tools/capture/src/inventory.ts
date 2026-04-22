/**
 * Generate code-inventory.json — the static, deterministic truth about the app.
 * This is the LEFT side of the coverage equation (CODE → INVENTORY).
 *
 * Produces:
 *   routes       — every TanStack route (keep + drop)
 *   rpc.trpc     — every declared tRPC procedure (union from scope.json)
 *   rpc.orpc     — every oRPC procedure (walk api-contract.generated.json)
 *   firestore    — every exported function in lib/db/*.ts that reads/writes
 *   postmessage  — every postMessage.type used by chat iframe contract
 *
 * Writes to <repo>/code-inventory.json.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadOrpcRoutes } from "./rpc-detect.js";

const CAP = process.cwd();
const ROOT = path.resolve(CAP, "..", "..");
const SCOPE_FILE = path.join(ROOT, "scope.json");
const OUT_FILE = path.join(ROOT, "code-inventory.json");

// ---------------------------------------------------------------------------
// 1. Routes — from scope.json (already produced by earlier static analysis)
// ---------------------------------------------------------------------------
const scope = JSON.parse(fs.readFileSync(SCOPE_FILE, "utf8"));
interface RouteItem {
  id: string;
  decision: string;
  domain: string;
  label: string;
  url_pattern: string | null;
  route_file: string | null;
}
const routes: RouteItem[] = [];
for (const [id, e] of Object.entries<any>(scope.decisions)) {
  routes.push({
    id,
    decision: e.decision,
    domain: e.domain,
    label: e.label,
    url_pattern: e.url_pattern,
    route_file: e.route_file,
  });
}

// ---------------------------------------------------------------------------
// 2. tRPC procs — union of .trpc[] across all route decisions in scope.json.
//    (scope.json was produced by static analysis of the trpc client tree.)
// ---------------------------------------------------------------------------
const trpcSet = new Set<string>();
for (const e of Object.values<any>(scope.decisions)) {
  if (e.decision !== "keep") continue;
  for (const p of e.trpc) trpcSet.add(p);
}
const trpcProcs = [...trpcSet].sort();

// ---------------------------------------------------------------------------
// 3. oRPC procs — walk api-contract.generated.json (same loader as capture)
// ---------------------------------------------------------------------------
const orpcRoutes = loadOrpcRoutes(ROOT);
const orpcProcs = [...new Set(orpcRoutes.map((r) => r.proc))].sort();

// ---------------------------------------------------------------------------
// 4. Firestore ops — parse lib/db/*.ts for exported functions that call
//    addDoc/setDoc/updateDoc/deleteDoc/writeBatch (writes) or onSnapshot (reads).
// ---------------------------------------------------------------------------
interface FsOp {
  file: string;
  fn: string;
  kind: "write" | "read";
  op: string;
  line: number;
}
const dbDir = path.join(ROOT, "reconstructed", "src", "lib", "db");
const firestore: FsOp[] = [];
for (const f of fs.readdirSync(dbDir)) {
  if (!f.endsWith(".ts")) continue;
  const lines = fs.readFileSync(path.join(dbDir, f), "utf8").split("\n");
  let currentFn: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const fnMatch = ln.match(/^\s*export\s+(?:async\s+)?function\s+(\w+)/);
    if (fnMatch) currentFn = fnMatch[1];
    if (!currentFn) continue;
    const wm = ln.match(/\b(addDoc|setDoc|updateDoc|deleteDoc|writeBatch|updateDocument|mergeDocument)\b/);
    if (wm && !/^import\b/.test(ln.trim()) && !/^\s*\/\//.test(ln)) {
      firestore.push({ file: f, fn: currentFn, kind: "write", op: wm[1], line: i + 1 });
    }
    const rm = ln.match(/\bonSnapshot\b/);
    if (rm && !/^import\b/.test(ln.trim())) {
      firestore.push({ file: f, fn: currentFn, kind: "read", op: "onSnapshot", line: i + 1 });
    }
  }
}

// ---------------------------------------------------------------------------
// 5. postMessage types — scan chat iframe code for the contract.
//    Outgoing: sendMessageToIframe({ type: "X", ... })
//    Incoming: event.data.type === "X"
// ---------------------------------------------------------------------------
interface PmType { direction: "in" | "out"; type: string; file: string; line: number }
const pm: PmType[] = [];
const chatFiles = [
  path.join(ROOT, "reconstructed", "src", "features", "outreach", "chat", "chat-iframe.tsx"),
  path.join(ROOT, "reconstructed", "src", "components", "chat.tsx"),
];
for (const f of chatFiles) {
  if (!fs.existsSync(f)) continue;
  const txt = fs.readFileSync(f, "utf8");
  const rel = path.relative(ROOT, f).replace(/\\/g, "/");
  const seen = new Set<string>();
  const lineOf = (idx: number) => txt.slice(0, idx).split("\n").length;
  let m;
  const inRe = /event\.data\.type\s*===\s*["']([^"']+)["']/g;
  while ((m = inRe.exec(txt))) {
    const k = "in:" + m[1];
    if (!seen.has(k)) { seen.add(k); pm.push({ direction: "in", type: m[1], file: rel, line: lineOf(m.index) }); }
  }
  // Multiline-capable: sendMessageToIframe({ ... type: "X" ... })
  const outRe = /sendMessageToIframe\(\s*\{\s*[\s\S]*?type\s*:\s*["']([^"']+)["']/g;
  while ((m = outRe.exec(txt))) {
    const k = "out:" + m[1];
    if (!seen.has(k)) { seen.add(k); pm.push({ direction: "out", type: m[1], file: rel, line: lineOf(m.index) }); }
  }
  // EVENTS_WITH_DATA set — incoming types logged but not necessarily ===-checked
  const setRe = /EVENTS_WITH_DATA\s*=\s*new\s+Set\(\s*\[([\s\S]*?)\]\s*\)/;
  const sm = setRe.exec(txt);
  if (sm) {
    const strRe = /["']([^"']+)["']/g;
    let s;
    while ((s = strRe.exec(sm[1]))) {
      const k = "in:" + s[1];
      if (!seen.has(k)) { seen.add(k); pm.push({ direction: "in", type: s[1], file: rel, line: lineOf(sm.index) }); }
    }
  }
}

// ---------------------------------------------------------------------------
// Write inventory
// ---------------------------------------------------------------------------
const keepRoutes = routes.filter((r) => r.decision === "keep").length;
const inventory = {
  generated_at: new Date().toISOString(),
  routes: { total: routes.length, keep: keepRoutes, items: routes },
  rpc: {
    trpc: { total: trpcProcs.length, items: trpcProcs },
    orpc: { total: orpcProcs.length, items: orpcProcs },
  },
  firestore: { total: firestore.length, items: firestore },
  postmessage: { total: pm.length, items: pm },
};
fs.writeFileSync(OUT_FILE, JSON.stringify(inventory, null, 2));
console.log(`[+] wrote ${OUT_FILE}`);
console.log(`  routes:       ${inventory.routes.total} (${inventory.routes.keep} keep)`);
console.log(`  tRPC procs:   ${inventory.rpc.trpc.total}`);
console.log(`  oRPC procs:   ${inventory.rpc.orpc.total}`);
console.log(`  firestore:    ${inventory.firestore.total}`);
console.log(`  postMessage:  ${inventory.postmessage.total}`);
