// List files modified/added by the fork relative to a chosen upstream base commit.
//
// Usage:
//   node diff.js <FORK_ROOT> <UPSTREAM_REPO> <BASE_COMMIT_SHA>
//
// Writes fork-modified.json and prints the lists to stdout.

const fs = require('fs');
const cp = require('child_process');
const path = require('path');

const [, , FORK_ROOT, UPSTREAM, BASE] = process.argv;
if (!FORK_ROOT || !UPSTREAM || !BASE) {
  console.error('Usage: node diff.js <FORK_ROOT> <UPSTREAM_REPO> <BASE_COMMIT_SHA>');
  process.exit(2);
}

function sh(cmd, args, opts={}) {
  return cp.execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...opts });
}

const forkFiles = [];
(function walk(d) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p);
    else forkFiles.push(p);
  }
})(FORK_ROOT);

const forkMap = new Map();
for (const f of forkFiles) {
  const rel = path.relative(FORK_ROOT, f).split(path.sep).join('/');
  if (rel.startsWith('node_modules/')) continue;
  forkMap.set(rel, sh('git', ['hash-object', '--', f]).trim());
}

const up = new Map();
for (const line of sh('git', ['-C', UPSTREAM, 'ls-tree', '-r', BASE]).split('\n')) {
  if (!line) continue;
  const tab = line.indexOf('\t');
  up.set(line.slice(tab + 1), line.slice(0, tab).split(' ')[2]);
}

const modified = [], added = [];
for (const [p, sha] of forkMap) {
  const u = up.get(p);
  if (u === undefined) added.push(p);
  else if (u !== sha) modified.push(p);
}
modified.sort(); added.sort();

console.log('=== ADDED by fork (' + added.length + ') ===');
for (const f of added) console.log('  +', f);
console.log('=== MODIFIED by fork (' + modified.length + ') ===');
for (const f of modified) console.log('  M', f);

fs.writeFileSync('fork-modified.json', JSON.stringify({ base: BASE, modified, added }, null, 2));
console.log('\nwrote fork-modified.json');
