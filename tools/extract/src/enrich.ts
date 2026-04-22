/**
 * Phase 2.2 — LLM enrichment of the capability matrix.
 *
 * For each route row in capability_matrix.json, call `claude -p` with a
 * compact, facts-only prompt and ask for a PM-readable description of the
 * screen. Output: static-analysis/capability_matrix.enriched.json.
 *
 * Incremental: if the enriched file already exists, rows already enriched
 * are skipped. Safe to interrupt and resume.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(process.cwd(), "..", "..");
const IN = path.join(ROOT, "static-analysis", "capability_matrix.json");
const OUT = path.join(ROOT, "static-analysis", "capability_matrix.enriched.json");

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
  i18n_prefixes: string[];
  zod_schemas: string[];
  feature_flags: string[];
  env_vars: string[];
  reachable_files: number;
}

interface Enriched {
  id: string;
  headline: string;
  what_user_sees: string;
  likely_actions: string[];
  why_it_exists: string;
  confidence: "high" | "medium" | "low";
  notes?: string;
}

const matrix = JSON.parse(fs.readFileSync(IN, "utf8")) as { meta: any; rows: Row[] };

let prior: Record<string, Enriched> = {};
if (fs.existsSync(OUT)) {
  const p = JSON.parse(fs.readFileSync(OUT, "utf8"));
  for (const e of p.enriched ?? []) prior[e.id] = e;
  console.log(`[=] resume: ${Object.keys(prior).length} rows already enriched`);
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "what_user_sees", "likely_actions", "why_it_exists", "confidence"],
  properties: {
    headline: { type: "string", description: "Short 3-7 word label in Russian" },
    what_user_sees: { type: "string", description: "1-2 sentence description of the UI in Russian" },
    likely_actions: {
      type: "array",
      items: { type: "string" },
      description: "User actions available on this screen, in Russian, short phrases",
    },
    why_it_exists: { type: "string", description: "1 sentence on product purpose, in Russian" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    notes: { type: "string", description: "Optional caveats, in Russian" },
  },
} as const;

const SYSTEM = `You analyze static-extraction facts from a web SPA and infer, in Russian, what each screen likely does for the user. The app is a CRM for Telegram-based sales/outreach. Base inferences ONLY on the facts given — do not invent endpoints or features. Set confidence=low if signals are thin. Output strict JSON matching the provided schema. Russian prose, English identifiers preserved as-is where unavoidable.`;

function buildPrompt(r: Row): string {
  const lines: string[] = [];
  lines.push(`URL pattern: ${r.url_pattern ?? "—"}`);
  lines.push(`Route file: ${r.route_file ?? "—"}`);
  lines.push(`Domain (heuristic): ${r.domain}`);
  if (r.trpc.length) lines.push(`tRPC procedures: ${r.trpc.join(", ")}`);
  if (r.orpc.length) lines.push(`oRPC (public REST) procedures: ${r.orpc.join(", ")}`);
  if (r.firestore_ops.length) lines.push(`Firestore ops (transitive): ${r.firestore_ops.slice(0, 20).join(", ")}${r.firestore_ops.length > 20 ? ` (+${r.firestore_ops.length - 20} more)` : ""}`);
  if (r.firebase_auth.length) lines.push(`Firebase Auth fns: ${r.firebase_auth.join(", ")}`);
  if (r.posthog_events.length) lines.push(`PostHog events: ${r.posthog_events.join(", ")}`);
  if (r.i18n_prefixes.length) lines.push(`i18n prefixes: ${r.i18n_prefixes.join(", ")}`);
  if (r.zod_schemas.length) lines.push(`Zod schemas: ${r.zod_schemas.slice(0, 8).join(", ")}`);
  if (r.feature_flags.length) lines.push(`Feature flags: ${r.feature_flags.join(", ")}`);
  if (r.reachable_files) lines.push(`Reachable file count: ${r.reachable_files}`);

  return `Facts about one screen of the app:\n\n${lines.join("\n")}\n\nDescribe this screen in Russian for a product manager. Output JSON per schema.`;
}

function callClaude(prompt: string): Enriched | null {
  const args = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(SCHEMA),
    "--system-prompt",
    SYSTEM,
    prompt,
  ];
  const r = spawnSync("claude", args, { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0) {
    console.error("[!] claude exited", r.status, r.stderr?.slice(0, 500));
    return null;
  }
  try {
    const outer = JSON.parse(r.stdout);
    if (outer.is_error) {
      console.error("[!] api error:", outer.result?.slice?.(0, 200));
      return null;
    }
    if (outer.structured_output) return outer.structured_output as Enriched;
    // Fallback: some builds put it into result as a JSON string
    if (typeof outer.result === "string") {
      try { return JSON.parse(outer.result) as Enriched; } catch {}
    }
    console.error("[!] no structured_output in response; keys:", Object.keys(outer).join(","));
    return null;
  } catch (e: any) {
    console.error("[!] parse error:", e.message);
    console.error("stdout head:", r.stdout.slice(0, 400));
    return null;
  }
}

// Skip orphan procedures — those have no UI and a useless enrichment.
// Skip layout-only roots (__root, ProtectedIndex, ProtectedRoute, Logout) — trivial.
const SKIP_IDS = new Set(["__root", "ProtectedIndex", "ProtectedRoute", "LogoutRoute"]);
const targets = matrix.rows.filter((r) => r.kind === "route" && !SKIP_IDS.has(r.id));
console.log(`[+] target rows: ${targets.length} (total ${matrix.rows.length}, skipped ${matrix.rows.length - targets.length})`);

const enriched: Enriched[] = Object.values(prior);
const enrichedIds = new Set(enriched.map((e) => e.id));

const t0 = Date.now();
let done = 0;
for (const row of targets) {
  if (enrichedIds.has(row.id)) {
    done++;
    continue;
  }
  const i = done + 1;
  const tag = `[${i}/${targets.length}]`;
  process.stdout.write(`${tag} ${row.domain} · ${row.label} ... `);
  const t = Date.now();
  const e = callClaude(buildPrompt(row));
  const dt = ((Date.now() - t) / 1000).toFixed(1);
  if (e) {
    const full: Enriched = { id: row.id, ...e };
    enriched.push(full);
    enrichedIds.add(row.id);
    console.log(`ok (${dt}s) — "${e.headline}"`);
    // Flush after each row so we can resume.
    fs.writeFileSync(
      OUT,
      JSON.stringify(
        {
          meta: {
            source: "capability_matrix.json",
            generated_at: new Date().toISOString(),
            total_targets: targets.length,
            completed: enriched.length,
          },
          enriched,
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`FAIL (${dt}s)`);
  }
  done++;
}

const total = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`[+] done in ${total}s, wrote ${OUT}`);
