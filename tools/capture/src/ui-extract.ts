/**
 * UI string extractor — parses Russian translations inlined in app bundle chunks.
 *
 * Input:  locales/chunks/*.js (downloaded from app.crmchat.ai/assets/*.js)
 * Output: ui-strings.json { unique, items: [{value, keys, files}] }
 *
 * Bundle format: minified JS where translations appear as "key":"Russian value".
 * We extract every such pair where the value contains cyrillic.
 */

import * as fs from "node:fs";
import * as path from "node:path";

const CAP = process.cwd();
const ROOT = path.resolve(CAP, "..", "..");
const CHUNKS = path.join(ROOT, "locales", "chunks");
const OUT = path.join(ROOT, "ui-strings.json");

if (!fs.existsSync(CHUNKS)) {
  console.error(`[!] no chunks dir at ${CHUNKS}`);
  console.error(`    Download first: curl + all assets from https://app.crmchat.ai/`);
  process.exit(1);
}

// "key":"value"  (value supports escaped quotes)
const PAIR_RE = /"([A-Za-z0-9_.\-]{1,80})"\s*:\s*"((?:\\.|[^"\\])*)"/g;

const hits = new Map<string, { keys: Set<string>; files: Set<string> }>();
let totalOccurrences = 0;

const files = fs.readdirSync(CHUNKS).filter((f) => f.endsWith(".js"));
console.log(`[+] scanning ${files.length} chunks in ${CHUNKS}`);

for (const f of files) {
  const txt = fs.readFileSync(path.join(CHUNKS, f), "utf8");
  let m: RegExpExecArray | null;
  PAIR_RE.lastIndex = 0;
  while ((m = PAIR_RE.exec(txt))) {
    const value = m[2].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
    if (value.length < 3) continue;
    if (!/[\u0400-\u04FF]/.test(value)) continue;
    totalOccurrences++;
    const cur = hits.get(value) ?? { keys: new Set<string>(), files: new Set<string>() };
    cur.keys.add(m[1]);
    cur.files.add(f);
    hits.set(value, cur);
  }
}

const items = [...hits.entries()]
  .map(([value, v]) => ({ value, keys: [...v.keys].sort(), files: [...v.files].sort() }))
  .sort((a, b) => a.value.localeCompare(b.value, "ru"));

fs.writeFileSync(OUT, JSON.stringify({
  total_occurrences: totalOccurrences,
  unique: items.length,
  items,
}, null, 2));

console.log(`[+] wrote ${OUT}`);
console.log(`  unique russian UI strings: ${items.length}`);
console.log(`  total occurrences:         ${totalOccurrences}`);
