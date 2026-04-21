// Fork-base detector. For each upstream commit, counts fork files that match
// its tree byte-for-byte via git blob SHA. Top result = likely base commit.
//
// Usage:
//   node fp.js <FORK_ROOT> <UPSTREAM_REPO> [--since=YYYY-MM-DD] [--ref=origin/master]
//
// FORK_ROOT:     directory with reconstructed fork sources (e.g. ./fork-src)
// UPSTREAM_REPO: path to a local clone of the upstream git repo
//
// Outputs top-10 to stdout and full scored list to ./fp-results.json.

const fs = require('fs');
const cp = require('child_process');
const path = require('path');

const [, , FORK_ROOT, UPSTREAM, ...rest] = process.argv;
if (!FORK_ROOT || !UPSTREAM) {
  console.error('Usage: node fp.js <FORK_ROOT> <UPSTREAM_REPO> [--since=YYYY-MM-DD] [--ref=origin/master]');
  process.exit(2);
}
const since = (rest.find(a => a.startsWith('--since=')) || '--since=2025-01-01').slice(8);
const ref   = (rest.find(a => a.startsWith('--ref='))   || '--ref=origin/master').slice(6);

function sh(cmd, args, opts={}) {
  return cp.execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...opts });
}

// 1. Blob SHA for every fork file (except node_modules).
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
console.log('fork tracked files:', forkMap.size);

// 2. Commits on upstream ref since given date.
const commits = sh('git', ['-C', UPSTREAM, 'log', ref, '--format=%H %ct %s', `--since=${since}`])
  .trim().split('\n').filter(Boolean).map(l => {
    const a = l.indexOf(' '), b = l.indexOf(' ', a + 1);
    return { h: l.slice(0, a), t: +l.slice(a + 1, b), s: l.slice(b + 1) };
  });
console.log('upstream commits to check:', commits.length);

// 3. Match fork blobs against each commit's tree.
const scored = [];
for (let i = 0; i < commits.length; i++) {
  const c = commits[i];
  const up = new Map();
  for (const line of sh('git', ['-C', UPSTREAM, 'ls-tree', '-r', c.h]).split('\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    up.set(line.slice(tab + 1), line.slice(0, tab).split(' ')[2]);
  }
  let match = 0, mismatch = 0, missing = 0;
  for (const [p, sha] of forkMap) {
    const u = up.get(p);
    if (u === undefined) missing++;
    else if (u === sha) match++;
    else mismatch++;
  }
  scored.push({ ...c, match, mismatch, missing });
  if ((i + 1) % 200 === 0) console.error('processed', i + 1, '/', commits.length);
}

scored.sort((a, b) => b.match - a.match || (a.mismatch + a.missing) - (b.mismatch + b.missing));
console.log('\n=== Top 10 candidate base commits ===');
for (const b of scored.slice(0, 10)) {
  console.log(`${b.h} match=${b.match} mismatch=${b.mismatch} missing=${b.missing} date=${new Date(b.t * 1000).toISOString().slice(0, 10)} :: ${b.s.slice(0, 80)}`);
}
fs.writeFileSync('fp-results.json', JSON.stringify(scored.slice(0, 50), null, 2));
console.log('\nwrote fp-results.json (top-50)');
