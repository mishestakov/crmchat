/**
 * RPC detection shared by capture.ts (live) and rebuild.ts (replay).
 *
 * tRPC:  /trpc/<proc>?batch=1            → proc name in URL
 * oRPC:  /v1/workspaces/{id}/members     → proc name lives ONLY in the code
 *                                           contract; we resolve via
 *                                           api-contract.generated.json
 *                                           (METHOD + path-pattern → proc).
 */

import * as fs from "node:fs";
import * as path from "node:path";

export interface OrpcRoute {
  proc: string;       // dot-notation, e.g. "workspaces.getMembers"
  method: string;     // GET | POST | PATCH | DELETE
  pathRegex: RegExp;  // matches URL pathname, with or without /v1 prefix
  pathSpec: string;   // original spec, e.g. "/workspaces/{workspaceId}/members" — for debug
}

// Walk the nested contract JSON and collect all leaves with ~orpc.route set.
function walkContract(obj: unknown, prefix: string[], out: OrpcRoute[]): void {
  if (!obj || typeof obj !== "object") return;
  const rec = obj as Record<string, unknown>;
  const marker = rec["~orpc"] as { route?: { method?: string; path?: string } } | undefined;
  if (marker?.route?.method && marker.route.path) {
    const proc = prefix.join(".");
    const method = marker.route.method.toUpperCase();
    const spec = marker.route.path;
    // "/workspaces/{workspaceId}/members" → optional /v1 prefix + spec with {param}→[^/]+
    const body = spec.replace(/\{[^}]+\}/g, "[^/]+");
    const pathRegex = new RegExp("^(?:/v\\d+)?" + body + "/?$");
    out.push({ proc, method, pathRegex, pathSpec: spec });
    return;
  }
  for (const [k, v] of Object.entries(rec)) {
    if (k === "~orpc") continue;
    walkContract(v, [...prefix, k], out);
  }
}

/**
 * Load oRPC contract from reconstructed source. Returns [] if file missing,
 * so capture keeps working even if `reconstructed/` was deleted.
 */
export function loadOrpcRoutes(projectRoot: string): OrpcRoute[] {
  const p = path.join(projectRoot, "reconstructed", "src", "lib", "api-contract.generated.json");
  if (!fs.existsSync(p)) {
    console.warn(`[!] ${p} not found — oRPC detection disabled`);
    return [];
  }
  const contract = JSON.parse(fs.readFileSync(p, "utf8"));
  const out: OrpcRoute[] = [];
  walkContract(contract, [], out);
  // Specificity: more path segments first (so /sequences/{id}/accounts beats /sequences/{id})
  out.sort((a, b) => b.pathSpec.length - a.pathSpec.length);
  return out;
}

export interface DetectResult {
  kind: "trpc" | "orpc" | "unknown";
  procs: string[];
}

export function detectRpc(
  url: string,
  method: string | undefined,
  orpcRoutes: OrpcRoute[],
): DetectResult {
  try {
    const u = new URL(url);
    // tRPC batching: /trpc/<proc> or /trpc/<a,b,c>?batch=1
    if (u.pathname.includes("/trpc/")) {
      const tail = u.pathname.split("/trpc/")[1] ?? "";
      const first = tail.split("?")[0];
      const procs = first.split(",").filter(Boolean);
      return { kind: "trpc", procs };
    }
    // oRPC: match method + path against generated contract
    if (orpcRoutes.length > 0) {
      const m = (method ?? "GET").toUpperCase();
      for (const r of orpcRoutes) {
        if (r.method !== m) continue;
        if (r.pathRegex.test(u.pathname)) {
          return { kind: "orpc", procs: [r.proc] };
        }
      }
    }
  } catch {}
  return { kind: "unknown", procs: [] };
}
