#!/usr/bin/env python3
"""Wiki-manager CLI. Solo stdlib.

Uso: python3 ocr-pi/cli.py [--root DIR] <comando> ...
  list | create WIKI | search Q [--stato S] [--wiki W] | show W VOCE | add W FILE.md [--titolo T]
  review W VOCE {draft,reviewed,versioned} | remove W [VOCE] [--confirm]
  export W [--senza-raw] | import FILE.zip [--merge]
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import manager  # noqa: E402


def cmd_create(a):
    p = manager.create_wiki(a.root, a.wiki)
    out({"wiki": str(p)} if a.json else str(p), a.json)


def out(data, as_json: bool) -> None:
    if as_json:
        print(json.dumps(data, ensure_ascii=False, default=str))
    elif isinstance(data, list):
        for row in data:
            print(row)
    else:
        print(data)


def cmd_list(a):
    rows = manager.list_wikis(a.root)
    out(rows if a.json else [f"{w['slug']} ({w['voci']} voci)" for w in rows], a.json)


def cmd_search(a):
    hits = manager.search(a.root, a.query, stato=a.stato, wiki=a.wiki)
    out(hits if a.json else
        [f"{h['wiki']}:{h['file']}:{h['linea']}: {h['testo'][:120]}" for h in hits], a.json)


def cmd_show(a):
    p = manager.show(a.root, a.wiki, a.voce)
    out({"file": str(p)} if a.json else str(p), a.json)


def cmd_add(a):
    out(manager.add(a.root, a.wiki, a.file, title=a.titolo), a.json)


def cmd_review(a):
    out(manager.review(a.root, a.wiki, a.voce, a.stato), a.json)


def cmd_remove(a):
    out(manager.remove(a.root, a.wiki, a.voce, confirm=a.confirm), a.json)


def cmd_export(a):
    p = manager.export(a.root, a.wiki, senza_raw=a.senza_raw)
    out({"zip": str(p)} if a.json else str(p), a.json)


def cmd_import(a):
    out(manager.import_wiki(a.root, a.file, merge=a.merge), a.json)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="wiki")
    ap.add_argument("--root", default=".")
    ap.add_argument("--json", action="store_true", help="output JSON (per backend/UI)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("create"); p.add_argument("wiki"); p.set_defaults(f=cmd_create)
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
        if a.json:
            print(json.dumps({"error": str(e)}, ensure_ascii=False))
        else:
            print(f"errore: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
