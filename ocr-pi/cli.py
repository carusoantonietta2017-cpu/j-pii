#!/usr/bin/env python3
"""Wiki-manager CLI. Solo stdlib.

Uso: python3 ocr-pi/cli.py [--root DIR] <comando> ...
  list | search Q [--stato S] [--wiki W] | show W VOCE | add W FILE.md [--titolo T]
  review W VOCE {draft,reviewed,versioned} | remove W [VOCE] [--confirm]
  export W [--senza-raw] | import FILE.zip [--merge]
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import manager  # noqa: E402


def cmd_list(a):
    for w in manager.list_wikis(a.root):
        print(f"{w['slug']} ({w['voci']} voci)")


def cmd_search(a):
    for h in manager.search(a.root, a.query, stato=a.stato, wiki=a.wiki):
        print(f"{h['wiki']}:{h['file']}:{h['linea']}: {h['testo'][:120]}")


def cmd_show(a):
    print(manager.show(a.root, a.wiki, a.voce))


def cmd_add(a):
    print(json.dumps(manager.add(a.root, a.wiki, a.file, title=a.titolo), ensure_ascii=False))


def cmd_review(a):
    print(json.dumps(manager.review(a.root, a.wiki, a.voce, a.stato), ensure_ascii=False))


def cmd_remove(a):
    print(json.dumps(manager.remove(a.root, a.wiki, a.voce, confirm=a.confirm), ensure_ascii=False))


def cmd_export(a):
    print(manager.export(a.root, a.wiki, senza_raw=a.senza_raw))


def cmd_import(a):
    print(json.dumps(manager.import_wiki(a.root, a.file, merge=a.merge), ensure_ascii=False))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="wiki")
    ap.add_argument("--root", default=".")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list").set_defaults(f=cmd_list)
    p = sub.add_parser("search"); p.add_argument("query")
    p.add_argument("--stato", default=None); p.add_argument("--wiki", default=None)
    p.set_defaults(f=cmd_search)
    p = sub.add_parser("show"); p.add_argument("wiki"); p.add_argument("voce"); p.set_defaults(f=cmd_show)
    p = sub.add_parser("add"); p.add_argument("wiki"); p.add_argument("file")
    p.add_argument("--titolo", default=None); p.set_defaults(f=cmd_add)
    p = sub.add_parser("review"); p.add_argument("wiki"); p.add_argument("voce"); p.add_argument("stato")
    p.set_defaults(f=cmd_review)
    p = sub.add_parser("remove"); p.add_argument("wiki"); p.add_argument("voce", nargs="?")
    p.add_argument("--confirm", action="store_true"); p.set_defaults(f=cmd_remove)
    p = sub.add_parser("export"); p.add_argument("wiki")
    p.add_argument("--senza-raw", action="store_true"); p.set_defaults(f=cmd_export)
    p = sub.add_parser("import"); p.add_argument("file"); p.add_argument("--merge", action="store_true")
    p.set_defaults(f=cmd_import)
    a = ap.parse_args(argv)
    try:
        a.f(a)
    except (LookupError, ValueError, PermissionError, FileNotFoundError) as e:
        print(f"errore: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
