/**
 * Field-level diff between:
 *   A) api-contract.generated.json   — extracted from the app bundle (client view)
 *   B) api-docs/spec.json            — official OpenAPI (server truth)
 *
 * Level 1 check:  method + path + summary + tags  (what's in A)
 * Level 2 check:  parameters + requestBody + responses  (only in B, but we
 *                 record the B-side schema so later capture validation
 *                 can match runtime requests against it)
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(process.cwd(), "..", "..");
const CONTRACT = path.join(ROOT, "reconstructed", "src", "lib", "api-contract.generated.json");
const SPEC = path.join(ROOT, "api-docs", "spec.json");
const OUT = path.join(ROOT, "static-analysis", "contract_diff.json");
const OUT_MD = path.join(ROOT, "static-analysis", "contract_diff.md");

interface ClientEp {
  key: string;           // "organizations.list"
  method: string;
  path: string;
  summary: string | null;
  description: string | null;
  tags: string[];
}
interface SpecEp {
  key: string;           // operationId
  method: string;
  path: string;
  summary: string | null;
  description: string | null;
  tags: string[];
  parameters: any[];
  requestBody: any;
  responses: any;
}

// --- A: client contract ---
const contract = JSON.parse(fs.readFileSync(CONTRACT, "utf8"));
const clientEps: ClientEp[] = [];
function walkContract(obj: any, trail: string[]) {
  if (obj && typeof obj === "object") {
    if (obj["~orpc"] && obj["~orpc"].route) {
      const r = obj["~orpc"].route;
      clientEps.push({
        key: trail.join("."),
        method: r.method ?? "UNKNOWN",
        path: r.path ?? "",
        summary: r.summary ?? null,
        description: r.description ?? null,
        tags: r.tags ?? [],
      });
      return;
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k === "~orpc") continue;
      walkContract(v, [...trail, k]);
    }
  }
}
walkContract(contract, []);

// --- B: spec.json ---
const spec = JSON.parse(fs.readFileSync(SPEC, "utf8"));
const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];
const specEps: SpecEp[] = [];
for (const [p, pathItem] of Object.entries<any>(spec.paths ?? {})) {
  for (const m of METHODS) {
    const op = pathItem[m];
    if (!op) continue;
    specEps.push({
      key: op.operationId ?? `${m.toUpperCase()} ${p}`,
      method: m.toUpperCase(),
      path: p,
      summary: op.summary ?? null,
      description: op.description ?? null,
      tags: op.tags ?? [],
      parameters: op.parameters ?? [],
      requestBody: op.requestBody ?? null,
      responses: op.responses ?? null,
    });
  }
}

// --- key-level diff ---
const clientKeys = new Set(clientEps.map((e) => e.key));
const specKeys = new Set(specEps.map((e) => e.key));
const onlyClient = [...clientKeys].filter((k) => !specKeys.has(k));
const onlySpec = [...specKeys].filter((k) => !clientKeys.has(k));
const common = [...clientKeys].filter((k) => specKeys.has(k));

// --- per-common field diff ---
interface FieldDiff {
  key: string;
  differences: string[];            // list of field-level mismatches
  spec_parameters_count: number;
  spec_has_requestBody: boolean;
  spec_response_codes: string[];
}
const fieldDiffs: FieldDiff[] = [];
for (const key of common.sort()) {
  const a = clientEps.find((e) => e.key === key)!;
  const b = specEps.find((e) => e.key === key)!;
  const diffs: string[] = [];
  if (a.method !== b.method) diffs.push(`method: client=${a.method} spec=${b.method}`);
  // Client paths don't include servers prefix; spec paths are relative to "/v1" server URL.
  // Client has path like "/workspaces/{workspaceId}/contacts", spec path is "/workspaces/{workspaceId}/contacts" — same shape expected.
  if (a.path !== b.path) diffs.push(`path: client=${a.path} spec=${b.path}`);
  if ((a.summary ?? "").trim() !== (b.summary ?? "").trim()) diffs.push(`summary: client="${a.summary}" spec="${b.summary}"`);
  if ((a.description ?? "").trim() !== (b.description ?? "").trim()) diffs.push(`description differs`);
  // Tags: client has "public-api" extra tag usually; compare as sets sans "public-api"
  const aTags = new Set(a.tags.filter((t) => t !== "public-api"));
  const bTags = new Set(b.tags);
  const tagMiss = [...aTags].filter((t) => !bTags.has(t)).concat([...bTags].filter((t) => !aTags.has(t)));
  if (tagMiss.length) diffs.push(`tags differ: client=[${a.tags.join(",")}] spec=[${b.tags.join(",")}]`);

  fieldDiffs.push({
    key,
    differences: diffs,
    spec_parameters_count: b.parameters.length,
    spec_has_requestBody: !!b.requestBody,
    spec_response_codes: b.responses ? Object.keys(b.responses).sort() : [],
  });
}

const allClean = fieldDiffs.every((d) => d.differences.length === 0);
const out = {
  meta: {
    client_endpoints: clientEps.length,
    spec_endpoints: specEps.length,
    common: common.length,
    only_in_client: onlyClient,
    only_in_spec: onlySpec,
    all_common_fields_match: allClean,
  },
  field_diffs: fieldDiffs,
  webhooks: Object.keys(spec.webhooks ?? {}).sort(),
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

const md: string[] = [];
md.push(`# Contract diff — client bundle vs official OpenAPI\n`);
md.push(`- client endpoints (\`api-contract.generated.json\`): **${clientEps.length}**`);
md.push(`- spec endpoints (\`api-docs/spec.json\`): **${specEps.length}**`);
md.push(`- common: **${common.length}**`);
md.push(`- only in client (not in public spec): \`${onlyClient.join(", ") || "—"}\``);
md.push(`- only in spec (not in client bundle): \`${onlySpec.join(", ") || "—"}\``);
md.push(`- webhooks in spec: \`${Object.keys(spec.webhooks ?? {}).join(", ") || "—"}\``);
md.push(`- **all common-endpoint method+path+tag fields match: ${allClean ? "YES" : "NO"}**\n`);
if (!allClean) {
  md.push(`\n## Mismatches\n`);
  for (const d of fieldDiffs) {
    if (d.differences.length === 0) continue;
    md.push(`\n### \`${d.key}\``);
    for (const x of d.differences) md.push(`- ${x}`);
  }
}
md.push(`\n## Per-endpoint spec signal (what code cannot see)\n`);
md.push(`| endpoint | params | body | responses |`);
md.push(`|---|---|---|---|`);
for (const d of fieldDiffs) {
  md.push(`| \`${d.key}\` | ${d.spec_parameters_count} | ${d.spec_has_requestBody ? "yes" : "—"} | ${d.spec_response_codes.join(", ")} |`);
}
fs.writeFileSync(OUT_MD, md.join("\n"));

console.log(`[+] client endpoints: ${clientEps.length}`);
console.log(`[+] spec endpoints:   ${specEps.length}`);
console.log(`[+] common:           ${common.length}`);
console.log(`[+] only in client:   ${onlyClient.length} ${onlyClient.length ? '→ '+onlyClient.join(', ') : ''}`);
console.log(`[+] only in spec:     ${onlySpec.length} ${onlySpec.length ? '→ '+onlySpec.join(', ') : ''}`);
console.log(`[+] all fields match: ${allClean}`);
console.log(`[+] wrote ${OUT}`);
console.log(`[+] wrote ${OUT_MD}`);
