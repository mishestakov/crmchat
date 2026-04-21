// Extract per-file source content from a webpack sourcemap into a directory tree.
// Used to reconstruct fork sources from main.*.js.map before fingerprinting.
//
// Usage:
//   node extract-sources.js <path/to/main.js.map> <OUT_DIR> [--prefix=webpack://telegram-t/]
//
// Strips the prefix and leading './' from each `sources[i]` entry and writes the
// corresponding `sourcesContent[i]` to OUT_DIR/<relative path>. Webpack-internal
// synthetic modules (sources starting with "webpack/") are skipped.

const fs = require('fs');
const path = require('path');

const [, , MAP, OUT, ...rest] = process.argv;
if (!MAP || !OUT) {
  console.error('Usage: node extract-sources.js <map> <out> [--prefix=webpack://telegram-t/]');
  process.exit(2);
}
const prefix = (rest.find(a => a.startsWith('--prefix=')) || '--prefix=webpack://telegram-t/').slice(9);

const m = JSON.parse(fs.readFileSync(MAP, 'utf8'));
if (!Array.isArray(m.sourcesContent)) {
  console.error('sourcemap has no sourcesContent — cannot reconstruct');
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });
let written = 0, skipped = 0;
for (let i = 0; i < m.sources.length; i++) {
  const src = m.sources[i];
  const c = m.sourcesContent[i];
  if (c == null) { skipped++; continue; }
  if (!src.startsWith(prefix)) { skipped++; continue; }
  let rel = src.slice(prefix.length);
  if (rel.startsWith('webpack/')) { skipped++; continue; }
  if (rel.startsWith('./')) rel = rel.slice(2);
  rel = rel.replace(/\?[a-f0-9]+$/, ''); // strip webpack CSS-module suffixes
  const abs = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, c);
  written++;
}
console.log('wrote', written, 'files to', OUT, '(skipped', skipped + ')');
