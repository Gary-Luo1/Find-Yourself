#!/usr/bin/env python3
"""同步/校验 static/ 与 public/ 资源一致性。

用法：
- 同步：python scripts/sync_public.py
- 仅校验：python scripts/sync_public.py --check
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATIC = ROOT / "static"
PUBLIC = ROOT / "public"
FILES = (
    ("index.html", "index.html"),
    ("app.js", "static/app.js"),
    ("styles.css", "static/styles.css"),
)


def _bytes(path: Path) -> bytes:
    return path.read_bytes()


def _check() -> list[str]:
    diffs: list[str] = []
    for src_name, dst_rel in FILES:
        src = STATIC / src_name
        dst = PUBLIC / dst_rel
        if not src.is_file():
            diffs.append(f"missing source: {src}")
            continue
        if not dst.is_file():
            diffs.append(f"missing target: {dst}")
            continue
        if _bytes(src) != _bytes(dst):
            diffs.append(f"content differs: {src} -> {dst}")
    return diffs


def _sync() -> None:
    idx = STATIC / "index.html"
    if not idx.is_file():
        raise SystemExit(f"Missing {idx}")
    PUBLIC.mkdir(parents=True, exist_ok=True)
    (PUBLIC / "static").mkdir(parents=True, exist_ok=True)
    shutil.copy2(idx, PUBLIC / "index.html")
    for name in ("app.js", "styles.css"):
        src = STATIC / name
        if not src.is_file():
            raise SystemExit(f"Missing {src}")
        shutil.copy2(src, PUBLIC / "static" / name)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true", help="Only verify static/ and public/ are in sync.")
    args = parser.parse_args()
    if args.check:
        diffs = _check()
        if diffs:
            print("OUT-OF-SYNC:")
            for line in diffs:
                print(f"- {line}")
            print("Run: python scripts/sync_public.py")
            raise SystemExit(1)
        print("OK: static/ and public/ are in sync.")
        return
    _sync()
    print("OK: public/ synced from static/")


if __name__ == "__main__":
    main()
