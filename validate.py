"""
Sanity-check completeness of the reconstructed tree.

For every reconstructed .ts/.tsx/.js/.mjs/.css file, parse out all
static/dynamic imports, re-exports, require() calls, and
new URL("...", import.meta.url) references. Resolve them the way
Vite resolves:

  @/foo              ->  src/foo
  ~/foo              ->  src/foo                 (sometimes used)
  ./foo or ../foo    ->  relative
  foo                ->  node_modules (skip, external)

Then for every project-internal target, try to find it on disk with
extension fallback (.ts, .tsx, .js, .mjs, /index.*). Anything that
resolves to nothing is reported — grouped by category so we can see
*classes* of missing things rather than a flat list.

The idea: if the validator reports N unresolved references, those are
either (a) genuinely missing from our crawl, (b) part of a path alias
we don't know about, or (c) generated code we can regenerate.
"""

from __future__ import annotations

import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).parent / "reconstructed"

# file extensions to scan for imports
SCAN_EXT = {".ts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".css"}

# extensions to try when resolving a bare path
RESOLVE_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json",
               ".css", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif",
               ".mp4", ".webm", ".mp3", ".wav"]

IMPORT_PATTERNS = [
    # import x from "..."; import "..."; import type {..} from "..."
    re.compile(r"""\bimport\s+(?:[^'"`;]+?\s+from\s+)?['"`]([^'"`]+)['"`]"""),
    # export {..} from "..."; export * from "..."
    re.compile(r"""\bexport\s+(?:\*|\{[^}]*\}|[^'"`;]+?)\s+from\s+['"`]([^'"`]+)['"`]"""),
    # dynamic import("...")
    re.compile(r"""\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)"""),
    # require("...")
    re.compile(r"""\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)"""),
    # new URL("./x", import.meta.url)
    re.compile(r"""\bnew\s+URL\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*import\.meta\.url"""),
    # CSS @import "..."
    re.compile(r"""@import\s+(?:url\()?['"`]([^'"`)]+)['"`]"""),
    # vite ?url / ?raw / ?worker suffix imports
]

# stdlib / framework modules we should NOT try to resolve locally
EXTERNAL_PREFIXES = (
    # scoped packages are always external
    # relative/alias paths are local — everything else is external
)


def is_external(spec: str) -> bool:
    # relative
    if spec.startswith((".", "/")):
        return False
    # alias
    if spec.startswith(("@/", "~/", "~")):
        return False
    # everything else: bare package name -> external
    return True


def strip_query(spec: str) -> tuple[str, str]:
    if "?" in spec:
        p, q = spec.split("?", 1)
        return p, q
    return spec, ""


def resolve(spec: str, from_file: Path) -> Path | None:
    """Return the resolved Path inside ROOT, or None if not found."""
    spec, _q = strip_query(spec)
    if is_external(spec):
        return None  # caller treats as ok

    # normalize alias
    if spec.startswith("@/"):
        target = ROOT / "src" / spec[2:]
    elif spec.startswith("~/"):
        target = ROOT / "src" / spec[2:]
    elif spec.startswith("~"):
        # vite allows ~foo for src/foo — rare
        target = ROOT / "src" / spec[1:]
    else:
        target = (from_file.parent / spec).resolve()

    # Try as-is, then with appended extensions (a spec like "foo.$id" has
    # Path.suffix == ".$id" but that's not a real file extension — always
    # try appending real extensions too).
    candidates = [target]
    real_suffix = target.suffix.lower() in RESOLVE_EXT
    if not real_suffix:
        # treat whole name as base; append ext
        for ext in RESOLVE_EXT:
            candidates.append(target.parent / (target.name + ext))
        # /index.ext
        for ext in RESOLVE_EXT:
            candidates.append(target / f"index{ext}")
    # TypeScript allows `import "./foo.js"` to resolve to ./foo.ts
    if target.suffix.lower() in (".js", ".mjs", ".cjs"):
        for ext in (".ts", ".tsx", ".mts", ".cts"):
            candidates.append(target.with_suffix(ext))
    # type-only .d.ts
    candidates.append(target.parent / (target.name + ".d.ts"))

    for c in candidates:
        try:
            c = c.resolve()
        except Exception:
            continue
        if c.exists() and c.is_file():
            return c
    # Also: spec might already have extension, check raw
    if target.exists() and target.is_file():
        return target
    return None


def extract_refs(text: str) -> set[str]:
    out: set[str] = set()
    for pat in IMPORT_PATTERNS:
        for m in pat.findall(text):
            out.add(m)
    return out


def categorize(spec: str) -> str:
    spec_no_q, _ = strip_query(spec)
    if spec_no_q.startswith("@/"):
        return "alias @/"
    if spec_no_q.startswith("~/") or spec_no_q.startswith("~"):
        return "alias ~/"
    if spec_no_q.startswith("./") or spec_no_q.startswith("../"):
        return "relative"
    if spec_no_q.startswith("/"):
        return "absolute-root"
    return "external(unexpected)"


def main():
    files = [p for p in ROOT.rglob("*") if p.is_file() and p.suffix in SCAN_EXT]
    print(f"[+] scanning {len(files)} source files under {ROOT}")

    all_refs = 0
    external_refs = 0
    resolved_refs = 0
    missing: dict[str, list[tuple[Path, str]]] = defaultdict(list)
    ext_counter: Counter = Counter()

    for f in files:
        try:
            txt = f.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        refs = extract_refs(txt)
        for r in refs:
            all_refs += 1
            if is_external(r):
                external_refs += 1
                # top-level package name
                pkg = r.split("/")[0] if not r.startswith("@") else "/".join(r.split("/")[:2])
                ext_counter[pkg] += 1
                continue
            resolved = resolve(r, f)
            if resolved is not None:
                resolved_refs += 1
            else:
                cat = categorize(r)
                missing[cat].append((f.relative_to(ROOT), r))

    print(f"[+] total refs:       {all_refs}")
    print(f"    external (npm):   {external_refs}")
    print(f"    resolved local:   {resolved_refs}")
    missing_count = sum(len(v) for v in missing.values())
    print(f"    UNRESOLVED local: {missing_count}")

    print("\n=== unresolved by category ===")
    for cat, items in sorted(missing.items(), key=lambda x: -len(x[1])):
        # dedupe by (resolved abs target) per category
        uniq = Counter()
        for src_file, spec in items:
            uniq[spec] += 1
        print(f"\n  [{cat}] — {len(items)} refs, {len(uniq)} unique targets")
        for spec, count in uniq.most_common(30):
            # show first referer
            example_referer = next(src.as_posix() for src, s in items if s == spec)
            print(f"    x{count:<3} {spec}")
            print(f"         e.g. from {example_referer}")
        if len(uniq) > 30:
            print(f"    ... +{len(uniq)-30} more unique")

    # top external packages for reference
    print("\n=== top 20 external packages (just for reference) ===")
    for pkg, c in ext_counter.most_common(20):
        print(f"  {c:>4}  {pkg}")


if __name__ == "__main__":
    main()
