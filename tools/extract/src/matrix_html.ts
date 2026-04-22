/**
 * Render capability_matrix.json as a single self-contained HTML file.
 *
 * Open directly from file:// — no web server. All data is inlined as
 * window.__DATA__. Checkbox state persists in localStorage. Export
 * produces scope.json (a keep/defer/drop decision per row).
 */

import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(process.cwd(), "..", "..");
const IN = path.join(ROOT, "static-analysis", "capability_matrix.json");
const IN_ENRICHED = path.join(ROOT, "static-analysis", "capability_matrix.enriched.json");
const OUT = path.join(ROOT, "static-analysis", "capability_matrix.html");

const data = JSON.parse(fs.readFileSync(IN, "utf8"));

// Merge LLM-enriched prose (if available) by row id.
let enrichedCount = 0;
if (fs.existsSync(IN_ENRICHED)) {
  const en = JSON.parse(fs.readFileSync(IN_ENRICHED, "utf8"));
  const byId = new Map<string, any>();
  for (const e of en.enriched ?? []) byId.set(e.id, e);
  for (const r of data.rows) {
    const e = byId.get(r.id);
    if (e) { r.enriched = e; enrichedCount++; }
  }
}

// Compute "global" procedures: those attached to more than 50% of routeful rows.
const routeRows = data.rows.filter((r: any) => r.kind === "route");
const totalRoutes = routeRows.length;
const proc2count = new Map<string, number>();
function bump(key: string) { proc2count.set(key, (proc2count.get(key) ?? 0) + 1); }
for (const r of routeRows) {
  for (const p of r.trpc) bump("trpc:" + p);
  for (const p of r.orpc) bump("orpc:" + p);
}
const GLOBAL_THRESHOLD = 0.5;
const globals = new Set<string>();
for (const [k, v] of proc2count) {
  if (v / totalRoutes > GLOBAL_THRESHOLD) globals.add(k);
}

// Default scope decisions derived from user's explicit keep/drop rules.
// These are seeded into localStorage on first load and whenever the user hits
// "Clear decisions". Manual edits always win.
function defaultDecision(r: any): "keep" | "drop" | null {
  const p = (r.url_pattern || r.id || "").toLowerCase();
  const d = r.domain;

  // Hard drop — user explicitly excluded
  if (/\/wallet\b/.test(p)) return "drop";
  if (/\/subscription\b/.test(p)) return "drop";
  if (/\/affiliate\b/.test(p)) return "drop";
  if (/\/api-keys\b/.test(p)) return "drop";
  if (/\/google-calendar\b/.test(p)) return "drop";
  if (/\bpayment-callback\b/.test(p)) return "drop";
  if (/^\/cello\b/.test(p)) return "drop";
  if (/\/buy\b/.test(p)) return "drop";
  if (d === "Infra") return "drop";

  // Hard keep — user explicitly wanted
  if (d === "Workspaces") return "keep";
  if (d === "CRM") return "keep";
  if (d === "Telegram") return "keep";
  if (d === "Outreach") return "keep";
  if (d === "Onboarding") return "keep";
  if (d === "Host integration") return "keep";
  if (d === "App shell") return "keep";

  // Settings — pick core, leave ambiguous as undecided
  if (d === "Settings") {
    if (/\/settings\/organization\b/.test(p)) return "keep";
    if (/\/settings\/properties\b/.test(p)) return "keep";
    if (/\/settings\/members\b/.test(p)) return "keep";
    if (/\/settings\/notifications\b/.test(p)) return "keep";
    if (/\/settings\/locale\b/.test(p)) return "keep";
    if (/\/settings\/help\b/.test(p)) return "keep";
    if (/\/settings\/connect-crm\b/.test(p)) return "keep";
    if (/\/settings\/export\b/.test(p)) return "keep";
    if (/\/settings$/.test(p)) return "keep";   // settings index
    if (/\/settings\/feature-flags\b/.test(p)) return null;  // internal tool, user checks
  }

  // Integrations — callbacks may or may not be in scope
  if (d === "Integrations") return null;

  return null;
}

const defaultDecisions: Record<string, "keep" | "drop"> = {};
for (const r of data.rows) {
  const d = defaultDecision(r);
  if (d) defaultDecisions[r.id] = d;
}

const enriched = {
  ...data,
  meta: {
    ...data.meta,
    globals: {
      threshold_ratio: GLOBAL_THRESHOLD,
      total_route_rows: totalRoutes,
      procedures: [...globals].sort().map((k) => ({ key: k, ratio: (proc2count.get(k)! / totalRoutes).toFixed(2) })),
    },
    default_decisions: {
      total: Object.keys(defaultDecisions).length,
      keep: Object.values(defaultDecisions).filter((x) => x === "keep").length,
      drop: Object.values(defaultDecisions).filter((x) => x === "drop").length,
    },
  },
  default_decisions: defaultDecisions,
};

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Capability matrix — CRMchat reconstruction</title>
<style>
  :root {
    --bg: #0f1115;
    --panel: #171a21;
    --row: #1c1f27;
    --row-alt: #191c23;
    --border: #2a2f3a;
    --fg: #e4e6ea;
    --fg-muted: #8a93a4;
    --accent: #78c2ff;
    --keep: #78ff9b;
    --defer: #ffdf78;
    --drop: #ff8a8a;
    --global: #4a5060;
    --chip-bg: #252a34;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; background: var(--bg); color: var(--fg); font: 13px/1.45 ui-monospace,Menlo,Consolas,monospace; }
  header { position: sticky; top: 0; z-index: 50; background: var(--panel); border-bottom: 1px solid var(--border); padding: 12px 18px; }
  h1 { margin: 0 0 4px 0; font-size: 15px; font-weight: 600; }
  .meta { color: var(--fg-muted); font-size: 11px; }
  .controls { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; align-items: center; }
  .controls input[type="search"] { flex: 1; min-width: 200px; background: var(--row); border: 1px solid var(--border); color: var(--fg); padding: 6px 10px; border-radius: 4px; font: inherit; }
  .controls label { display: flex; align-items: center; gap: 4px; color: var(--fg-muted); font-size: 11px; }
  .controls button { background: var(--row); border: 1px solid var(--border); color: var(--fg); padding: 6px 10px; border-radius: 4px; cursor: pointer; font: inherit; }
  .controls button:hover { background: var(--chip-bg); }
  .controls button.primary { background: var(--accent); color: #000; border-color: var(--accent); }
  .domain-chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
  .chip { background: var(--chip-bg); border: 1px solid var(--border); color: var(--fg-muted); padding: 2px 8px; border-radius: 10px; cursor: pointer; font-size: 11px; user-select: none; }
  .chip.active { background: var(--accent); color: #000; border-color: var(--accent); }
  main { padding: 16px 18px 120px; max-width: 1600px; }
  .domain-group { margin-bottom: 22px; }
  .domain-group h2 { font-size: 13px; margin: 0 0 6px 0; color: var(--fg-muted); font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase; }
  .bulk { display: inline-flex; gap: 4px; margin-left: 10px; }
  .bulk button { background: transparent; border: 1px solid var(--border); color: var(--fg-muted); padding: 1px 6px; border-radius: 3px; font: inherit; font-size: 10px; cursor: pointer; }
  .bulk button.keep:hover { color: var(--keep); border-color: var(--keep); }
  .bulk button.defer:hover { color: var(--defer); border-color: var(--defer); }
  .bulk button.drop:hover { color: var(--drop); border-color: var(--drop); }
  table { width: 100%; border-collapse: collapse; background: var(--row); border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { background: var(--panel); color: var(--fg-muted); font-weight: 600; font-size: 11px; position: sticky; top: 52px; z-index: 10; }
  tr:nth-child(even) td { background: var(--row-alt); }
  tr.hidden { display: none; }
  tr.expanded td { border-bottom: none; }
  td.scope { width: 120px; }
  td.scope .scope-radio { display: inline-flex; gap: 2px; }
  td.scope label { display: inline-block; padding: 1px 6px; border: 1px solid var(--border); border-radius: 3px; cursor: pointer; color: var(--fg-muted); font-size: 10px; }
  td.scope input { display: none; }
  td.scope input[value="keep"]:checked + label { background: rgba(120,255,155,0.15); color: var(--keep); border-color: var(--keep); }
  td.scope input[value="defer"]:checked + label { background: rgba(255,223,120,0.15); color: var(--defer); border-color: var(--defer); }
  td.scope input[value="drop"]:checked + label { background: rgba(255,138,138,0.15); color: var(--drop); border-color: var(--drop); }
  td.label { min-width: 260px; max-width: 320px; }
  td.label .label-main { font-weight: 600; }
  td.label .url { color: var(--fg-muted); font-size: 11px; word-break: break-all; margin-top: 2px; }
  td.label .confidence { display: inline-block; margin-left: 6px; font-size: 9px; padding: 1px 4px; border-radius: 2px; text-transform: uppercase; letter-spacing: 0.05em; }
  td.label .confidence.high { background: rgba(120,255,155,0.15); color: var(--keep); }
  td.label .confidence.medium { background: rgba(255,223,120,0.15); color: var(--defer); }
  td.label .confidence.low { background: rgba(255,138,138,0.15); color: var(--drop); }
  td.prose { min-width: 360px; font-size: 12px; line-height: 1.5; }
  td.prose .headline { font-size: 13px; font-weight: 600; color: var(--fg); margin-bottom: 4px; }
  td.prose .what { color: var(--fg); margin-bottom: 6px; }
  td.prose .why { color: var(--fg-muted); font-size: 11px; font-style: italic; }
  td.prose .actions { margin: 4px 0 6px 0; padding-left: 16px; color: var(--fg); }
  td.prose .actions li { margin: 0; }
  td.prose .missing { color: var(--fg-muted); font-style: italic; font-size: 11px; }
  td.prose .tech { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border); font-size: 11px; color: var(--fg-muted); display: none; }
  td.prose .i18n-list { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 3px; }
  td.prose .i18n-list .i18n-chip { background: rgba(120,194,255,0.08); border: 1px solid rgba(120,194,255,0.3); color: #a9cbe8; font-size: 10px; padding: 1px 5px; border-radius: 3px; white-space: nowrap; }
  td.prose .i18n-list .i18n-chip.hidden-extra { display: none; }
  td.prose .i18n-list.all-shown .i18n-chip.hidden-extra { display: inline-block; }
  td.prose .i18n-list .i18n-more { font-size: 10px; color: var(--fg-muted); cursor: pointer; text-decoration: underline dotted; background: transparent; border: 0; padding: 1px 5px; }
  tr.tech-open td.prose .tech { display: block; }
  td.backend { font-size: 11px; display: none; }
  tr.tech-open td.backend { display: table-cell; }
  th.tech-col, td.signals, td.reach { display: none; }
  tr.tech-open td.signals, tr.tech-open td.reach { display: table-cell; }
  body.tech-global th.tech-col { display: table-cell; }
  body.tech-global td.backend, body.tech-global td.signals, body.tech-global td.reach { display: table-cell; }
  body.tech-global td.prose .tech { display: block; }
  .proc { display: inline-block; padding: 1px 5px; background: var(--chip-bg); border-radius: 3px; margin: 1px 2px 1px 0; white-space: nowrap; }
  .proc.global { color: var(--global); }
  .proc.trpc { }
  .proc.orpc { border: 1px solid #5a8c5a; }
  .count { color: var(--fg-muted); font-size: 11px; }
  td.actions { width: 80px; text-align: right; }
  td.actions button { background: transparent; border: 1px solid var(--border); color: var(--fg-muted); padding: 2px 6px; border-radius: 3px; font: inherit; font-size: 10px; cursor: pointer; }
  td.actions button:hover { color: var(--fg); }
  tr.proof-row td { background: var(--bg); padding: 10px 14px; }
  .proof-block { color: var(--fg-muted); font-size: 11px; }
  .proof-block .cite { display: block; padding: 2px 0; }
  .proof-block .cite code { color: var(--accent); }
  footer { position: fixed; bottom: 0; left: 0; right: 0; background: var(--panel); border-top: 1px solid var(--border); padding: 10px 18px; z-index: 40; display: flex; gap: 12px; align-items: center; font-size: 11px; color: var(--fg-muted); }
  footer .tally { display: flex; gap: 16px; }
  footer .tally .keep { color: var(--keep); }
  footer .tally .defer { color: var(--defer); }
  footer .tally .drop { color: var(--drop); }
  footer .tally .undecided { color: var(--fg-muted); }
  footer button { margin-left: auto; }
</style>
</head>
<body>
<header>
  <h1>Capability matrix — CRMchat reconstruction (code-derived)</h1>
  <div class="meta" id="meta"></div>
  <div class="controls">
    <input type="search" id="q" placeholder="Filter by label, URL, procedure..." />
    <label><input type="checkbox" id="showTech" /> show tech columns</label>
    <label><input type="checkbox" id="hideGlobal" checked /> hide globals (proc on ≥50% routes)</label>
    <label><input type="checkbox" id="hideUndecided" /> only decided rows</label>
    <button id="clearScope">Reset to defaults</button>
  </div>
  <div class="domain-chips" id="domainChips"></div>
</header>

<main id="main"></main>

<footer>
  <div class="tally" id="tally"></div>
  <button class="primary" id="exportBtn">Export scope.json</button>
</footer>

<script id="data" type="application/json">${JSON.stringify(enriched)}</script>
<script>
(() => {
  const DATA = JSON.parse(document.getElementById('data').textContent);
  const ROWS = DATA.rows;
  const GLOBALS = new Set(DATA.meta.globals.procedures.map(p => p.key));
  const DEFAULTS = DATA.default_decisions || {};
  const STORAGE_KEY = 'crmchat-scope-v2';

  // Seed localStorage with default decisions on first load. Manual edits override.
  function seedDefaults() {
    const seeded = {};
    for (const id in DEFAULTS) seeded[id] = DEFAULTS[id];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }
  const stored = localStorage.getItem(STORAGE_KEY);
  const decisions = stored ? JSON.parse(stored) : seedDefaults();
  function saveDecisions() { localStorage.setItem(STORAGE_KEY, JSON.stringify(decisions)); renderTally(); }

  const domains = [...new Set(ROWS.map(r => r.domain))];
  const activeDomains = new Set(domains);
  const state = { q: '', hideGlobal: true, hideUndecided: false };

  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  function procChip(kind, p) {
    const isGlobal = GLOBALS.has(kind + ':' + p);
    return '<span class="proc ' + kind + (isGlobal ? ' global' : '') + '" title="' + escapeHtml(kind + ' ' + p) + '">' + escapeHtml(p) + '</span>';
  }

  function renderMeta() {
    const m = DATA.meta;
    const enrichedCount = ROWS.filter(r => r.enriched).length;
    const dd = m.default_decisions || { keep: 0, drop: 0 };
    document.getElementById('meta').innerHTML =
      'Rows: <b>' + m.total_rows + '</b> · ' +
      'LLM descriptions: <b>' + enrichedCount + '/' + m.total_rows + '</b> · ' +
      'pre-marked: <span style="color:var(--keep)">' + dd.keep + ' keep</span> / <span style="color:var(--drop)">' + dd.drop + ' drop</span> · ' +
      'tRPC covered <b>' + m.coverage.trpc_procedures.covered + '/' + m.coverage.trpc_procedures.total + '</b>';
  }

  function renderChips() {
    const host = document.getElementById('domainChips');
    host.innerHTML = '';
    for (const d of domains) {
      const el = document.createElement('span');
      el.className = 'chip active';
      const count = ROWS.filter(r => r.domain === d).length;
      el.textContent = d + ' (' + count + ')';
      el.onclick = () => {
        if (activeDomains.has(d)) activeDomains.delete(d); else activeDomains.add(d);
        el.classList.toggle('active');
        renderRows();
      };
      host.appendChild(el);
    }
  }

  function rowVisible(r) {
    if (!activeDomains.has(r.domain)) return false;
    if (state.hideUndecided && !decisions[r.id]) return false;
    if (!state.q) return true;
    const q = state.q.toLowerCase();
    const hay = [r.label, r.url_pattern || '', r.route_file || '', ...r.trpc, ...r.orpc].join(' ').toLowerCase();
    return hay.includes(q);
  }

  function filterProcs(procs, kind) {
    if (!state.hideGlobal) return procs;
    return procs.filter(p => !GLOBALS.has(kind + ':' + p));
  }

  function renderRows() {
    const main = document.getElementById('main');
    main.innerHTML = '';
    let prev = '';
    let group = null;
    let table = null;
    let tbody = null;

    for (const r of ROWS) {
      if (!rowVisible(r)) continue;
      if (r.domain !== prev) {
        prev = r.domain;
        group = document.createElement('div');
        group.className = 'domain-group';
        const h = document.createElement('h2');
        h.textContent = r.domain;
        const bulk = document.createElement('span');
        bulk.className = 'bulk';
        for (const v of ['keep','defer','drop']) {
          const b = document.createElement('button');
          b.className = v;
          b.textContent = 'all → ' + v;
          b.onclick = () => {
            for (const rr of ROWS) if (rr.domain === r.domain && rowVisible(rr)) decisions[rr.id] = v;
            saveDecisions();
            renderRows();
          };
          bulk.appendChild(b);
        }
        h.appendChild(bulk);
        group.appendChild(h);
        table = document.createElement('table');
        table.innerHTML = '<thead><tr><th>Scope</th><th>Screen</th><th>What this does</th><th class="tech-col">Backend</th><th class="tech-col">Signals</th><th class="tech-col">Reach</th><th></th></tr></thead>';
        tbody = document.createElement('tbody');
        table.appendChild(tbody);
        group.appendChild(table);
        main.appendChild(group);
      }

      const tr = document.createElement('tr');
      tr.dataset.id = r.id;

      const trpc = filterProcs(r.trpc, 'trpc');
      const orpc = filterProcs(r.orpc, 'orpc');

      const scopeCell =
        '<div class="scope-radio">' +
        ['keep','defer','drop'].map(v =>
          '<input type="radio" name="sc_' + r.id + '" value="' + v + '" id="sc_' + r.id + '_' + v + '"' +
          (decisions[r.id] === v ? ' checked' : '') + '>' +
          '<label for="sc_' + r.id + '_' + v + '">' + v + '</label>'
        ).join('') +
        '</div>';

      const e = r.enriched;
      const labelCell =
        '<div class="label-main">' + escapeHtml(r.label) +
        (e ? '<span class="confidence ' + e.confidence + '">' + e.confidence + '</span>' : '') +
        '</div>' +
        '<div class="url">' + escapeHtml(r.url_pattern || '—') + '</div>';

      const I18N_INIT = 18;
      const i18nChips = r.i18n_prefixes.length
        ? '<div class="i18n-list" data-row="' + r.id + '">' +
          r.i18n_prefixes.map((p, i) =>
            '<span class="i18n-chip' + (i >= I18N_INIT ? ' ghost hidden-extra' : '') + '">' + escapeHtml(p) + '</span>'
          ).join('') +
          (r.i18n_prefixes.length > I18N_INIT
            ? '<button class="i18n-more" data-act="i18n-more">+' + (r.i18n_prefixes.length - I18N_INIT) + ' more</button>'
            : '') +
          '</div>'
        : '';

      const proseCell = e
        ? '<div class="headline">' + escapeHtml(e.headline) + '</div>' +
          '<div class="what">' + escapeHtml(e.what_user_sees) + '</div>' +
          (e.likely_actions && e.likely_actions.length
            ? '<ul class="actions">' + e.likely_actions.map(a => '<li>' + escapeHtml(a) + '</li>').join('') + '</ul>'
            : '') +
          '<div class="why">' + escapeHtml(e.why_it_exists) + '</div>' +
          (e.notes ? '<div class="why">ℹ ' + escapeHtml(e.notes) + '</div>' : '') +
          i18nChips
        : '<span class="missing">(no LLM description yet — run npm run enrich)</span>' + i18nChips;

      tr.innerHTML =
        '<td class="scope">' + scopeCell + '</td>' +
        '<td class="label">' + labelCell + '</td>' +
        '<td class="prose">' + proseCell + '</td>' +
        '<td class="backend">' +
          (trpc.length ? '<div>tRPC: ' + trpc.map(p => procChip('trpc', p)).join(' ') + '</div>' : '') +
          (orpc.length ? '<div>oRPC: ' + orpc.map(p => procChip('orpc', p)).join(' ') + '</div>' : '') +
          (!trpc.length && !orpc.length ? '<span class="count">—</span>' : '') +
        '</td>' +
        '<td class="signals count">' +
          (r.firestore_ops.length ? 'firestore: ' + r.firestore_ops.length + ' · ' : '') +
          (r.firebase_auth.length ? 'auth: ' + r.firebase_auth.length + ' · ' : '') +
          (r.posthog_events.length ? 'posthog: ' + r.posthog_events.length + ' · ' : '') +
          (r.feature_flags.length ? 'flags: ' + r.feature_flags.length + ' · ' : '') +
          (r.zod_schemas.length ? 'zod: ' + r.zod_schemas.length + ' · ' : '') +
          (r.i18n_prefixes.length ? 'i18n: ' + r.i18n_prefixes.join(',') : '') +
        '</td>' +
        '<td class="reach count">' + r.reachable_files + '</td>' +
        '<td class="actions"><button data-act="tech" title="toggle tech details for this row">tech</button> <button data-act="proof">proof</button></td>';

      tr.querySelectorAll('input[type="radio"]').forEach(inp => {
        inp.addEventListener('change', (e) => {
          decisions[r.id] = e.target.value;
          saveDecisions();
        });
      });

      tr.querySelector('[data-act="tech"]').addEventListener('click', () => {
        tr.classList.toggle('tech-open');
      });
      const moreBtn = tr.querySelector('[data-act="i18n-more"]');
      if (moreBtn) {
        moreBtn.addEventListener('click', (ev) => {
          const list = ev.target.closest('.i18n-list');
          list.classList.toggle('all-shown');
          ev.target.textContent = list.classList.contains('all-shown') ? 'collapse' : '+' + (r.i18n_prefixes.length - I18N_INIT) + ' more';
        });
      }

      tr.querySelector('[data-act="proof"]').addEventListener('click', () => {
        const next = tr.nextElementSibling;
        if (next && next.classList.contains('proof-row')) { next.remove(); tr.classList.remove('expanded'); return; }
        const pr = document.createElement('tr');
        pr.className = 'proof-row';
        const cites = [];
        if (r.route_file) cites.push('<span class="cite">route file → <code>' + escapeHtml(r.route_file) + '</code></span>');
        for (const p of (r.proof?.trpc_examples || [])) cites.push('<span class="cite">tRPC <code>' + escapeHtml(p.proc) + '</code> → <code>' + escapeHtml(p.file) + ':' + p.line + '</code></span>');
        for (const p of (r.proof?.orpc_examples || [])) cites.push('<span class="cite">oRPC <code>' + escapeHtml(p.proc) + '</code> → <code>' + escapeHtml(p.file) + ':' + p.line + '</code></span>');
        for (const p of (r.proof?.firestore_examples || [])) cites.push('<span class="cite">firestore <code>' + escapeHtml(p.fn) + (p.path ? '(' + escapeHtml(p.path) + ')' : '') + '</code> → <code>' + escapeHtml(p.file) + ':' + p.line + '</code></span>');
        pr.innerHTML = '<td colspan="7"><div class="proof-block">' + (cites.length ? cites.join('') : '<i>(no proof snippets indexed for this row)</i>') + '</div></td>';
        tr.after(pr);
        tr.classList.add('expanded');
      });

      tbody.appendChild(tr);
    }
    renderTally();
  }

  function renderTally() {
    const t = { keep: 0, defer: 0, drop: 0, undecided: 0 };
    for (const r of ROWS) t[decisions[r.id] || 'undecided']++;
    document.getElementById('tally').innerHTML =
      '<span class="keep">keep: ' + t.keep + '</span>' +
      '<span class="defer">defer: ' + t.defer + '</span>' +
      '<span class="drop">drop: ' + t.drop + '</span>' +
      '<span class="undecided">undecided: ' + t.undecided + '</span>';
  }

  document.getElementById('q').oninput = (e) => { state.q = e.target.value; renderRows(); };
  document.getElementById('showTech').onchange = (e) => { document.body.classList.toggle('tech-global', e.target.checked); };
  document.getElementById('hideGlobal').onchange = (e) => { state.hideGlobal = e.target.checked; renderRows(); };
  document.getElementById('hideUndecided').onchange = (e) => { state.hideUndecided = e.target.checked; renderRows(); };
  document.getElementById('clearScope').onclick = () => {
    if (!confirm('Reset to default decisions? Your manual edits will be discarded.')) return;
    for (const k of Object.keys(decisions)) delete decisions[k];
    for (const id in DEFAULTS) decisions[id] = DEFAULTS[id];
    saveDecisions();
    renderRows();
  };
  document.getElementById('exportBtn').onclick = () => {
    const scope = { generated_at: new Date().toISOString(), decisions: {} };
    for (const r of ROWS) {
      const d = decisions[r.id];
      if (!d) continue;
      scope.decisions[r.id] = {
        decision: d,
        domain: r.domain,
        label: r.label,
        url_pattern: r.url_pattern,
        route_file: r.route_file,
        trpc: r.trpc,
        orpc: r.orpc,
        firestore_ops: r.firestore_ops.length,
      };
    }
    const blob = new Blob([JSON.stringify(scope, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'scope.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  renderMeta();
  renderChips();
  renderRows();
})();
</script>
</body>
</html>`;

fs.writeFileSync(OUT, html);
console.log(`[+] wrote ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(1)} KB)`);
console.log(`[+] globals: ${[...globals].join(", ") || "none"}`);
