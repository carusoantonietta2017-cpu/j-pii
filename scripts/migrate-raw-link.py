#!/usr/bin/env python3
"""Migrazione pairing raw<->md per wiki esistenti. Solo stdlib.
Uso: python3 scripts/migrate-raw-link.py --root ~/wiki [--wiki slug]
Ricollega raw orfani via stem match, aggiunge frontmatter minimo.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "ocr-pi"))
import manager


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--wiki", default=None)
    a = ap.parse_args()
    targets = [a.wiki] if a.wiki else [w["slug"] for w in manager.list_wikis(a.root)]
    total_linked = 0
    for slug in targets:
        try:
            r = manager.link_raws(a.root, slug)
            print(f"{slug}: linked={r['linked']} skipped={r['skipped']}")
            total_linked += r["linked"]
        except Exception as e:
            print(f"{slug}: errore {e}", file=sys.stderr)
            return 1
    print(f"totale linked={total_linked}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
