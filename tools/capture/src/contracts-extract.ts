/**
 * API contracts extractor — сливает все captured-вызовы по каждому proc,
 * выводит inferred signature (required vs optional top-level).
 *
 *   Input:  tools/capture/processed/rpc/<proc>/*.json
 *   Output: specs/api-contracts.md
 *
 * Unwrapping:
 *   tRPC req:  {"0": {input}}                → input
 *   tRPC resp: [{"result":{"data": output}}] → output
 *   oRPC req:  plain body                    → as-is (path-params — в URL)
 *   oRPC resp: {"data": output} | output     → output
 */

import * as fs from "node:fs";
import * as path from "node:path";

const CAP = process.cwd();
const ROOT = path.resolve(CAP, "..", "..");
const RPC_DIR = path.join(CAP, "processed", "rpc");
const OUT = path.join(ROOT, "specs", "api-contracts.md");
const STORIES = fs.existsSync(path.join(ROOT, "user-stories.md"))
  ? fs.readFileSync(path.join(ROOT, "user-stories.md"), "utf8") : "";
const INV = JSON.parse(fs.readFileSync(path.join(ROOT, "code-inventory.json"), "utf8"));
const SCOPE = JSON.parse(fs.readFileSync(path.join(ROOT, "scope.json"), "utf8"));

// --- parse / unwrap -----------------------------------------------------------
function safeParse(s: string | null | undefined): unknown {
  if (s == null || s === "") return undefined;
  try { return JSON.parse(s); } catch { return undefined; }
}
function unwrapTrpcReq(b: unknown): unknown {
  if (b && typeof b === "object" && "0" in (b as any)) return (b as any)["0"];
  return b;
}
function unwrapTrpcResp(b: unknown): unknown {
  if (Array.isArray(b) && b[0]?.result?.data !== undefined) return b[0].result.data;
  return b;
}
function unwrapOrpcResp(b: unknown): unknown {
  if (b && typeof b === "object" && "data" in (b as any) && Object.keys(b as any).length === 1) return (b as any).data;
  return b;
}

// --- type inference -----------------------------------------------------------
type Kind = "string" | "number" | "boolean" | "null" | "array" | "object" | "undefined";
function kindOf(v: unknown): Kind {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return "array";
  return typeof v as Kind;
}

interface FieldStat { seen: number; kinds: Set<Kind> }
function collectFields(samples: unknown[]): Map<string, FieldStat> {
  const stat = new Map<string, FieldStat>();
  for (const s of samples) {
    if (!s || typeof s !== "object" || Array.isArray(s)) continue;
    for (const [k, v] of Object.entries(s)) {
      const cur = stat.get(k) ?? { seen: 0, kinds: new Set<Kind>() };
      cur.seen++;
      cur.kinds.add(kindOf(v));
      stat.set(k, cur);
    }
  }
  return stat;
}

function summarizeFields(stat: Map<string, FieldStat>, N: number): { required: string[]; optional: string[] } {
  const required: string[] = [], optional: string[] = [];
  const sorted = [...stat.entries()].sort(([a], [b]) => a.localeCompare(b));
  for (const [name, s] of sorted) {
    const kinds = [...s.kinds].filter((k) => k !== "undefined").sort().join(" | ");
    const line = `${name}: ${kinds || "?"}`;
    if (s.seen === N) required.push(line);
    else optional.push(`${line}  (seen ${s.seen}/${N})`);
  }
  return { required, optional };
}

// --- main ---------------------------------------------------------------------
interface ProcData { proc: string; kind: "trpc" | "orpc"; calls: any[] }
const procs: ProcData[] = [];
for (const name of fs.readdirSync(RPC_DIR).sort()) {
  const dir = path.join(RPC_DIR, name);
  if (!fs.statSync(dir).isDirectory()) continue;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const calls = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
    .filter((c) => c.request?.method !== "OPTIONS"); // preflight мусор
  if (calls.length === 0) continue;
  procs.push({ proc: name, kind: calls[0].kind, calls });
}

// story crossref: matches backticks in user-stories.md
function storiesFor(proc: string): string[] {
  const re = /^###\s+(US-[0-9]+[a-z]?)\s+/gm;
  const hits: { id: string; start: number }[] = [];
  let m; while ((m = re.exec(STORIES))) hits.push({ id: m[1], start: m.index });
  const out = new Set<string>();
  for (let i = 0; i < hits.length; i++) {
    const body = STORIES.slice(hits[i].start, i + 1 < hits.length ? hits[i + 1].start : STORIES.length);
    const bt = new Set<string>();
    const bRe = /`([^`]+)`/g; let b;
    while ((b = bRe.exec(body))) bt.add(b[1]);
    for (const t of bt) {
      if (t === proc || proc.endsWith("." + t)) { out.add(hits[i].id); break; }
    }
  }
  return [...out].sort();
}

// --- render -------------------------------------------------------------------
const lines: string[] = [];
lines.push("# API contracts");
lines.push("");
lines.push("Справочник REST-ручек (`/v1/*`). Единый контракт обслуживает UI и внешние интеграции; аутентификация — Firebase id-token (UI) или API-key (интеграции).");
lines.push("");
lines.push("Формы данных выведены из реальных вызовов оригинального сервиса.");
lines.push("");
lines.push(`> Сгенерировано из \`tools/capture/processed/rpc/*\`. Не редактируй вручную — правь генератор \`tools/capture/src/contracts-extract.ts\`. Источник: ${procs.length} ручек, ${procs.reduce((n, p) => n + p.calls.length, 0)} зафиксированных вызовов.`);
lines.push("");
lines.push("## Обозначения");
lines.push("- `required` — поле присутствует во всех N вызовах.");
lines.push("- `optional (seen X/N)` — поле есть не везде. При N=1 optional не детектируется (все поля показаны как required — «assumed»).");
lines.push("- Вложенные объекты и массивы показаны as-is из одного свежего примера, не мёржатся.");
lines.push("- В реимплементации timestamp'ы сериализуются как ISO-8601 строки; в captured-примерах встречается формат `{_seconds, _nanoseconds}` — особенность перехваченного транспорта, не целевой контракт.");
lines.push("");

for (const { proc, kind, calls } of procs) {
  const N = calls.length;
  const reqBodies = calls.map((c) => {
    const raw = safeParse(c.request?.body);
    return kind === "trpc" ? unwrapTrpcReq(raw) : raw;
  });
  const respBodies = calls.map((c) => {
    const raw = safeParse(c.response?.body);
    return kind === "trpc" ? unwrapTrpcResp(raw) : unwrapOrpcResp(raw);
  });

  const reqStat = collectFields(reqBodies);
  const respStat = collectFields(respBodies);
  const reqSum = summarizeFields(reqStat, N);
  const respSum = summarizeFields(respStat, N);

  const used = storiesFor(proc);
  const sampleReq = reqBodies.find((b) => b && typeof b === "object") ?? null;
  const sampleResp = respBodies.find((b) => b && typeof b === "object") ?? null;
  const urls = [...new Set(calls.map((c) => c.request?.url).filter(Boolean))].slice(0, 2);
  const methods = [...new Set(calls.map((c) => c.request?.method).filter(Boolean))];

  lines.push(`## ${proc}`);
  lines.push("");
  lines.push(`- **Kind**: ${kind.toUpperCase()} · **HTTP**: ${methods.join(", ")}`);
  lines.push(`- **Captured calls**: ${N}${N === 1 ? " _(optional-детектор отключён)_" : ""}`);
  lines.push(`- **Used by**: ${used.length ? used.join(", ") : "_(нет stories, см. scope.json/rpc_decisions)_"}`);
  if (kind === "orpc" && urls.length) lines.push(`- **URL**: \`${urls[0]}\``);
  lines.push("");

  lines.push(`### Input`);
  if (reqSum.required.length) { lines.push("Required:"); for (const f of reqSum.required) lines.push(`- \`${f}\``); }
  if (reqSum.optional.length) { lines.push("Optional:"); for (const f of reqSum.optional) lines.push(`- \`${f}\``); }
  if (!reqSum.required.length && !reqSum.optional.length) lines.push("_пустой / в URL_");
  if (sampleReq) {
    lines.push("");
    lines.push("Sample:");
    lines.push("```json");
    lines.push(JSON.stringify(sampleReq, null, 2));
    lines.push("```");
  }
  lines.push("");

  lines.push(`### Output`);
  if (respSum.required.length) { lines.push("Required:"); for (const f of respSum.required) lines.push(`- \`${f}\``); }
  if (respSum.optional.length) { lines.push("Optional:"); for (const f of respSum.optional) lines.push(`- \`${f}\``); }
  if (!respSum.required.length && !respSum.optional.length) lines.push("_пустой_");
  if (sampleResp) {
    lines.push("");
    lines.push("Sample:");
    lines.push("```json");
    lines.push(JSON.stringify(sampleResp, null, 2));
    lines.push("```");
  }
  lines.push("");
}

// --- Declared but not captured -----------------------------------------------
const captured = new Set(procs.map((p) => p.proc));
const declared: { name: string; kind: "trpc" | "orpc" }[] = [
  ...(INV.rpc.trpc.items as string[]).map((n) => ({ name: n, kind: "trpc" as const })),
  ...(INV.rpc.orpc.items as string[]).map((n) => ({ name: n, kind: "orpc" as const })),
];
const missing = declared.filter((d) => !captured.has(d.name)).sort((a, b) => a.name.localeCompare(b.name));
const decisions = SCOPE.rpc_decisions ?? {};

lines.push("---");
lines.push("");
lines.push("# Declared but not captured");
lines.push("");
lines.push(`${missing.length} proc'ов объявлены в коде, но ни разу не вызывались в нашей capture-сессии. Сигнатур нет — только имя и решение из \`scope.rpc_decisions\`.`);
lines.push("");
lines.push("| Proc | Kind | Decision | Reason |");
lines.push("|------|------|----------|--------|");
for (const m of missing) {
  const d = decisions[m.name];
  const decision = d?.decision ?? "_(не решено)_";
  const reason = d?.reason ?? "—";
  lines.push(`| \`${m.name}\` | ${m.kind.toUpperCase()} | ${decision} | ${reason} |`);
}
lines.push("");

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, lines.join("\n"));
console.log(`[+] wrote ${OUT}`);
console.log(`  procs: ${procs.length}`);
console.log(`  calls: ${procs.reduce((n, p) => n + p.calls.length, 0)}`);
console.log(`  N=1 procs (no optional detection): ${procs.filter((p) => p.calls.length === 1).length}`);
