"""
Reconstruct original source tree from .map files' `sourcesContent`.

For every *.map in crmchat_dump_full/, walk `sources[]` + `sourcesContent[]`,
normalize the path (strip leading ../, drop node_modules), and write the
content to reconstructed/<normalized path>.

If the same source appears in multiple maps:
  - identical content: write once
  - differing content: keep the longest; log conflicts

TanStack Router split variants (`foo.tsx?tsr-split=component`) are saved as
`foo.split-component.tsx` so they coexist with the canonical file.
"""

from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path

DUMP = Path(__file__).parent / "crmchat_dump_full"
OUT = Path(__file__).parent / "reconstructed"


def normalize(src: str) -> str | None:
    if not src:
        return None
    s = src.replace("\\", "/")
    # strip scheme-ish prefixes
    s = re.sub(r"^(webpack://|vite://|rollup:///?|file:///)", "", s)
    if s.startswith(("virtual:", "\u0000", "rolldown:")):
        return None
    # drop node_modules — third-party
    if "node_modules/" in s:
        return None
    # strip leading ./ or ../
    while s.startswith("./"):
        s = s[2:]
    while s.startswith("../"):
        s = s[3:]
    s = s.lstrip("/")
    # collapse doubles
    s = re.sub(r"/+", "/", s)
    if not s:
        return None
    # handle TSR split variant
    m = re.match(r"^(?P<p>[^?]+)\?tsr-split=(?P<v>[\w\-]+)$", s)
    if m:
        p = m.group("p")
        v = m.group("v")
        # foo.tsx -> foo.split-<variant>.tsx
        if "." in Path(p).name:
            stem, dot, ext = p.rpartition(".")
            s = f"{stem}.split-{v}.{ext}"
        else:
            s = f"{p}.split-{v}"
    # only keep "project-ish" roots — src/, packages/, apps/, app/
    if not re.match(r"^(src|packages|apps|app|public)/", s):
        # also allow plain root files like package.json, tsconfig.json, etc.
        if "/" in s:
            return None
    # safety: strip anything weird from the path segments
    parts = []
    for part in s.split("/"):
        part = re.sub(r"[^A-Za-z0-9._+\-=$]", "_", part)
        if part in ("", ".", ".."):
            return None
        parts.append(part)
    return "/".join(parts)


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    maps = list(DUMP.rglob("*.map"))
    print(f"[+] scanning {len(maps)} .map files")

    # path -> {content -> [map_files]}
    bucket: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    total_refs = 0
    skipped = 0

    for mp in maps:
        try:
            data = json.loads(mp.read_text(encoding="utf-8", errors="replace"))
        except Exception as e:
            print(f"  [!] failed to parse {mp.name}: {e}")
            continue
        sources = data.get("sources") or []
        contents = data.get("sourcesContent") or []
        for i, src in enumerate(sources):
            total_refs += 1
            norm = normalize(src)
            if not norm:
                skipped += 1
                continue
            if i >= len(contents):
                continue
            c = contents[i]
            if c is None or not isinstance(c, str):
                continue
            bucket[norm][c].append(mp.name)

    print(f"[+] {total_refs} source refs total, {skipped} skipped (node_modules/virtual)")
    print(f"[+] {len(bucket)} unique reconstructed paths")

    conflicts: list[tuple[str, list[int]]] = []
    written = 0
    bytes_written = 0
    for norm, variants in bucket.items():
        if len(variants) > 1:
            # keep the longest; note conflict
            sizes = sorted(((len(c), c) for c in variants), reverse=True)
            chosen = sizes[0][1]
            conflicts.append((norm, [s for s, _ in sizes]))
        else:
            chosen = next(iter(variants))
        target = OUT / norm
        target.parent.mkdir(parents=True, exist_ok=True)
        data_bytes = chosen.encode("utf-8", errors="replace")
        target.write_bytes(data_bytes)
        written += 1
        bytes_written += len(data_bytes)

    manifest = {
        "total_map_files": len(maps),
        "total_source_refs": total_refs,
        "skipped_refs": skipped,
        "unique_paths": len(bucket),
        "files_written": written,
        "bytes_written": bytes_written,
        "conflicts": [
            {"path": p, "variant_sizes": sizes} for p, sizes in conflicts[:200]
        ],
        "conflict_count": len(conflicts),
    }
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8"
    )

    print(f"\n[OK] wrote {written} files, {bytes_written:,} bytes "
          f"({bytes_written/1024/1024:.2f} MiB)")
    print(f"[+] conflicts (same path, different content): {len(conflicts)}")
    if conflicts:
        print("    top 10:")
        for p, sizes in conflicts[:10]:
            print(f"      {p}  variants: {sizes}")
    print(f"[+] out: {OUT}")


if __name__ == "__main__":
    main()
