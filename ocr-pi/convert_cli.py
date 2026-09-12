#!/usr/bin/env python3
"""CLI conversione singola per l'hook pi (JSON su stdout). Solo stdlib + converter.

Uso: python ocr-pi/convert_cli.py --source scan.png [--engine docling] [--pages 1,2] [--workdir DIR] [--deskew]
Esce 0 con {"markdown","assets","pages","engine","seconds","deskew_applied"} o 2 con {"error"}.
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from converter import convert  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True)
    ap.add_argument("--engine", default="docling")
    ap.add_argument("--pages", default="")
    ap.add_argument("--workdir", default=".")
    ap.add_argument("--deskew", action="store_true")
    args = ap.parse_args(argv)
    try:
        pages = [int(x) for x in args.pages.split(",") if x.strip()] or None
        r = convert(args.source, pages=pages, engine=args.engine,
                    workdir=args.workdir, deskew=args.deskew)
        print(json.dumps({"markdown": r.markdown, "assets": [str(a) for a in r.assets],
                          "pages": r.pages, "engine": r.engine,
                          "seconds": round(r.seconds, 2),
                          "deskew_applied": r.deskew_applied}, ensure_ascii=False))
        return 0
    except Exception as e:  # noqa: BLE001 - l'hook legge error da JSON
        print(json.dumps({"error": f"{type(e).__name__}: {e}"}, ensure_ascii=False))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
