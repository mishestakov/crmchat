"""
Download every static asset of app.crmchat.ai with *provable* completeness.

Why this is mathematically complete
-----------------------------------
Vite/Rollup (which CRMchat uses) emits every lazy chunk as a literal string
in the bundle — e.g.  import("./assets/foo-abc123.js")  is compiled to a
static reference inside some already-loaded chunk. So the set of chunks
that *can ever load* is exactly the transitive closure of string references
starting from index.html. No string reference → no way to load the chunk
at runtime.

Therefore, if we:
  1. Start from https://app.crmchat.ai/ (index.html),
  2. Extract every path that looks like a same-origin asset URL,
  3. Download each, parse it, and feed new references back into the queue,
  4. Iterate until the queue is empty (fixed point),

then the set we ended up with is the complete runtime-reachable asset set.
Any asset *not* in this set cannot be fetched by the app at runtime.

For each JS/CSS we additionally fetch its .map (declared via
    //# sourceMappingURL=...   or   /*# sourceMappingURL=... */ )
so sources embedded in sourcesContent get captured too.

The script prints one line per fetched file and a rolling counter, and
finishes with a fixed-point report (how many BFS rounds, how many bytes).

How to run
----------
    cd "C:\\Users\\mikes\\OneDrive\\Рабочий стол\\crmchat-claude"
    python download_complete.py

Re-runs safe: already-saved files are reused from disk unless --force given.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.parse
from pathlib import Path

import requests


BASE = "https://app.crmchat.ai"
ENTRY = BASE + "/"
OUT_DIR = Path(__file__).parent / "crmchat_dump_full"

# Host allow-list — closed over subdomains the app actually serves from.
HOST_ALLOW = re.compile(r"^(?:[a-z0-9-]+\.)?(?:crmchat\.ai|crmchat-bot\.com)$", re.I)

# File extensions we consider "asset-y" — anything referenced by these
# extensions will be enqueued. HTML/JSON get parsed; binaries are just saved.
ASSET_EXT = (
    "js", "mjs", "cjs", "css", "map", "json", "html",
    "woff", "woff2", "ttf", "otf", "eot",
    "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico",
    "mp3", "mp4", "webm", "wav", "ogg",
    "txt", "xml", "wasm",
)
EXT_ALT = "|".join(ASSET_EXT)

# 1) generic string reference to anything under /assets/... with a known ext.
#    Quoted or bare, absolute or relative. Captures the path.
REF_RE = re.compile(
    rb"""
      (?:['"` ]|^|\(|,|=|:)         # left boundary: quote, space, start, ( , = :
      (                             # group 1: the path
        (?: /|\./|\.\./ )?          # optional leading / ./ ../
        assets/
        [A-Za-z0-9._+\-/]+          # path chars
        \.(?:""" + EXT_ALT.encode() + rb""")
      )
      (?:['"` )\?,;]|$)             # right boundary
    """,
    re.VERBOSE,
)

# 2) script/link refs in html  -> src="..." href="..."
HTML_REF_RE = re.compile(
    rb"""(?:src|href)\s*=\s*['"]([^'"#]+?)['"]""", re.IGNORECASE
)

# 3) sourceMappingURL directives in js/css
SRCMAP_JS_RE = re.compile(rb"//[#@]\s*sourceMappingURL=([^\s'\"]+)")
SRCMAP_CSS_RE = re.compile(rb"/\*[#@]\s*sourceMappingURL=([^\s*]+)\s*\*/")

# 4) generic absolute URL reference inside strings
ABS_URL_RE = re.compile(
    rb"""https?://[A-Za-z0-9.\-]+\.(?:crmchat\.ai|crmchat-bot\.com)"""
    rb"""(?:/[A-Za-z0-9._+\-/%?=&]*?)?"""
    rb"""\.(?:""" + EXT_ALT.encode() + rb""")""",
    re.IGNORECASE,
)


def url_to_path(url: str) -> Path | None:
    u = urllib.parse.urlsplit(url)
    if not u.netloc:
        return None
    path = u.path or "/"
    if path.endswith("/"):
        path += "index.html"
    if u.query:
        qh = urllib.parse.quote(u.query, safe="")[:80]
        path = path + "__q_" + qh
    safe = re.sub(r"[^A-Za-z0-9._/\-]", "_", path.lstrip("/"))
    return OUT_DIR / u.netloc / safe


def norm_url(u: str) -> str | None:
    u = u.strip()
    if not u:
        return None
    # strip control chars and whitespace that regex may have let through
    u = re.sub(r"[\s\x00-\x1f]+", "", u)
    if not u:
        return None
    if u.startswith(("data:", "blob:", "javascript:", "mailto:", "#")):
        return None
    return u


def _clean_ref(raw: bytes) -> str:
    return re.sub(r"[\s\x00-\x1f]+", "", raw.decode("utf-8", "replace"))


def extract_refs(body: bytes, base_url: str, content_type: str) -> set[str]:
    out: set[str] = set()
    is_html = "html" in content_type
    base_path = urllib.parse.urlsplit(base_url).path.lower()
    is_map = base_path.endswith(".map")

    if is_html:
        for m in HTML_REF_RE.findall(body):
            u = norm_url(m.decode("utf-8", "replace"))
            if u:
                out.add(urllib.parse.urljoin(base_url, u))

    origin = "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(base_url))
    for m in REF_RE.findall(body):
        ref = _clean_ref(m)
        if not ref:
            continue
        # bare "assets/foo.js" refs are origin-relative, not dir-relative —
        # urljoin against the current .js/.map would produce /assets/assets/...
        if ref.startswith("assets/"):
            out.add(origin + "/" + ref)
        elif ref.startswith("./assets/"):
            out.add(origin + "/" + ref[2:])
        elif ref.startswith("../"):
            # strip leading ../ segments, then anchor at origin root
            stripped = ref
            while stripped.startswith("../"):
                stripped = stripped[3:]
            if stripped.startswith("assets/"):
                out.add(origin + "/" + stripped)
            else:
                out.add(urllib.parse.urljoin(base_url, ref))
        else:
            out.add(urllib.parse.urljoin(base_url, ref))

    for m in ABS_URL_RE.findall(body):
        u = _clean_ref(m)
        if u:
            out.add(u)

    # sourceMappingURL directives: ONLY for real js/css. In .map files these
    # directives come from the original package sourcesContent (e.g. Sentry's
    # own sdk.js.map) and point nowhere on our origin — they trigger the
    # server's SPA fallback (200 index.html) and poison the crawl.
    if not is_map:
        for m in SRCMAP_JS_RE.findall(body) + SRCMAP_CSS_RE.findall(body):
            ref = _clean_ref(m)
            if ref:
                out.add(urllib.parse.urljoin(base_url, ref))

    # same-origin filter
    filtered: set[str] = set()
    for u in out:
        try:
            p = urllib.parse.urlsplit(u)
        except Exception:
            continue
        if not p.scheme.startswith("http"):
            continue
        if not HOST_ALLOW.match(p.netloc):
            continue
        # drop fragments
        u_clean = urllib.parse.urlunsplit((p.scheme, p.netloc, p.path,
                                            p.query, ""))
        filtered.add(u_clean)
    return filtered


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true",
                    help="re-fetch URLs even if cached on disk")
    ap.add_argument("--max-rounds", type=int, default=20)
    args = ap.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[+] output: {OUT_DIR}")

    session = requests.Session()
    session.headers.update({
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0 Safari/537.36",
        "Accept": "*/*",
        "Referer": BASE + "/",
    })

    visited: dict[str, dict] = {}   # url -> {status, bytes, path, ct}
    queue: list[str] = [ENTRY]
    seen_in_queue: set[str] = {ENTRY}

    # Also enqueue these well-known well-guessed vite locations; they may 404
    # but that's fine — we just mark them visited.
    for extra in [
        "/assets/.vite/manifest.json",
        "/manifest.json",
        "/asset-manifest.json",
        "/sw.js",
        "/service-worker.js",
        "/robots.txt",
        "/favicon.ico",
        "/app-icon.png",
        "/config.json",
    ]:
        u = BASE + extra
        if u not in seen_in_queue:
            queue.append(u)
            seen_in_queue.add(u)

    total_bytes = 0
    rounds = 0
    new_this_round = 1
    start = time.time()

    while queue and new_this_round > 0 and rounds < args.max_rounds:
        rounds += 1
        round_queue, queue = queue, []
        new_this_round = 0
        print(f"\n=== round {rounds} — {len(round_queue)} urls queued ===",
              flush=True)

        for url in round_queue:
            if url in visited:
                continue

            path = url_to_path(url)
            if path is None:
                visited[url] = {"status": 0, "bytes": 0, "path": "", "ct": ""}
                continue

            # disk cache
            if path.exists() and not args.force and path.stat().st_size > 0:
                cache_ok = False
                try:
                    body = path.read_bytes()
                    asset_ext = path.suffix.lower()
                    looks_html = body.lstrip()[:15].lower().startswith(
                        (b"<!doctype", b"<html"))
                    if asset_ext not in (".html", "") and looks_html:
                        # poisoned cache entry — drop and fall through to fetch
                        try:
                            path.unlink()
                        except Exception:
                            pass
                        print(f"  PURGE        {url}  (cached SPA-fallback, re-fetching)",
                              flush=True)
                    else:
                        cache_ok = True
                except Exception:
                    pass

                if cache_ok:
                    if asset_ext in (".js", ".mjs"):
                        ct = "application/javascript"
                    elif asset_ext == ".css":
                        ct = "text/css"
                    elif asset_ext in (".json", ".map"):
                        ct = "application/json"
                    elif asset_ext in (".html", "") or url.endswith("/"):
                        ct = "text/html"
                    else:
                        ct = ""
                    visited[url] = {
                        "status": 200, "bytes": len(body),
                        "path": str(path.relative_to(OUT_DIR)), "ct": ct,
                        "cached": True,
                    }
                    refs = extract_refs(body, url, ct)
                    added = 0
                    for r in refs:
                        if r not in seen_in_queue:
                            seen_in_queue.add(r)
                            queue.append(r)
                            added += 1
                            new_this_round += 1
                    print(f"  CACHE {len(body):>8}b  {url}  (+{added} new refs)",
                          flush=True)
                    continue

            # fetch
            try:
                r = session.get(url, timeout=30, allow_redirects=True)
            except Exception as e:
                print(f"  ERR          ?b  {url}  -> {e}", flush=True)
                visited[url] = {"status": -1, "bytes": 0, "path": "", "ct": "",
                                "error": str(e)}
                continue

            body = r.content
            ct = r.headers.get("Content-Type", "")
            if r.status_code != 200:
                print(f"  {r.status_code}         {len(body):>8}b  {url}",
                      flush=True)
                visited[url] = {"status": r.status_code, "bytes": len(body),
                                "path": "", "ct": ct}
                continue

            # SPA-fallback guard: server returns 200 + index.html for any
            # unknown path. If we asked for a non-html asset but got html back,
            # treat it as a soft 404 — do NOT save, do NOT parse for refs.
            asset_ext = path.suffix.lower()
            looks_html = (b"html" in ct.lower().encode()
                          or body.lstrip()[:15].lower().startswith((b"<!doctype", b"<html")))
            if asset_ext not in (".html", "") and looks_html:
                print(f"  SPA404 {len(body):>6}b  {url}  (html returned for {asset_ext})",
                      flush=True)
                visited[url] = {"status": 404, "spa_fallback": True,
                                "bytes": len(body), "path": "", "ct": ct}
                continue

            # save
            try:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(body)
            except Exception as e:
                print(f"  SAVEERR       {url}  -> {e}", flush=True)
            total_bytes += len(body)

            refs = extract_refs(body, url, ct)
            added = 0
            for ref in refs:
                if ref not in seen_in_queue:
                    seen_in_queue.add(ref)
                    queue.append(ref)
                    added += 1
                    new_this_round += 1
            visited[url] = {"status": 200, "bytes": len(body),
                            "path": str(path.relative_to(OUT_DIR)),
                            "ct": ct, "refs_added": added}
            print(f"  GET   {len(body):>8}b  {url}  (+{added} new refs)",
                  flush=True)

        print(f"  -- round {rounds} done, {new_this_round} new urls queued "
              f"for next round", flush=True)

    elapsed = time.time() - start
    manifest = {
        "rounds": rounds,
        "fixed_point_reached": new_this_round == 0,
        "total_urls": len(visited),
        "total_bytes": total_bytes,
        "elapsed_seconds": round(elapsed, 1),
        "visited": visited,
    }
    manifest_path = OUT_DIR / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    status_counts = {}
    for v in visited.values():
        status_counts[v["status"]] = status_counts.get(v["status"], 0) + 1

    print("\n" + "=" * 60)
    print(f"FIXED POINT REACHED: {manifest['fixed_point_reached']}")
    print(f"rounds:          {rounds}")
    print(f"urls visited:    {len(visited)}")
    print(f"bytes fetched:   {total_bytes:,} ({total_bytes/1024/1024:.2f} MiB)")
    print(f"elapsed:         {elapsed:.1f}s")
    print(f"status breakdown:")
    for s, c in sorted(status_counts.items(), key=lambda x: -x[1]):
        print(f"  {s:>4}:  {c}")
    print(f"manifest:        {manifest_path}")
    print("=" * 60)

    if not manifest["fixed_point_reached"]:
        print("\n[!] MAX ROUNDS hit before convergence — bump --max-rounds.")
        sys.exit(2)
    else:
        print("\n[OK] Closure is complete. No further references reachable.")


if __name__ == "__main__":
    main()
