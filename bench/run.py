#!/usr/bin/env python3
"""Benchmark converter sul corpus. Solo stdlib (+ converter.py).

Uso:
  python3 bench/run.py --engine fake            # deterministico, CI
  python3 bench/run.py --engine docling         # reale (richiede ocr-pi/.venv)
  python3 bench/run.py --engine fake --out DIR  # report JSON in DIR

Metriche v1: exact-match su valori attesi dei sintetici (ground-truth CSV
noto) + s/pagina. TEDS/CER completi al ticket [b2] con derivate warped.
"""
import argparse
import csv
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / "ocr-pi"))

from converter import convert  # noqa: E402

SYNTHETIC = ROOT / "bench" / "corpus" / "synthetic_it"
MANIFEST = ROOT / "bench" / "corpus" / "manifest.json"
NATIVE = ROOT / "bench" / "corpus" / "native"


def expected_cells(csv_path: Path) -> list:
    with csv_path.open(encoding="utf-8") as f:
        return [c for row in csv.reader(f) for c in row if c.strip()]


def exact_match(markdown: str, cells: list) -> dict:
    found = [c for c in cells if c in markdown]
    return {"expected": len(cells), "found": len(found), "missing": [c for c in cells if c not in markdown]}


def run_one(pdf: Path, engine: str, workdir: Path, cells: list | None) -> dict:
    t0 = time.monotonic()
    try:
        r = convert(pdf, engine=engine, workdir=workdir)
        row = {
            "file": pdf.name,
            "ok": True,
            "pages": r.pages,
            "engine": r.engine,
            "seconds": round(r.seconds, 2),
            "sec_per_page": round(r.seconds / max(r.pages, 1), 2),
            "assets": len(r.assets),
        }
        if cells is not None:
            row["exact_match"] = exact_match(r.markdown, cells)
    except Exception as e:  # noqa: BLE001 - il report deve contenere l'errore
        row = {"file": pdf.name, "ok": False, "error": f"{type(e).__name__}: {e}"}
    row["wall"] = round(time.monotonic() - t0, 2)
    return row


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--engine", default="fake")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()

    workdir = Path(args.out or (ROOT / "bench" / "report")).resolve()
    (workdir / "md").mkdir(parents=True, exist_ok=True)
    rows = []

    for pdf in sorted(SYNTHETIC.glob("*.pdf")):
        csv_path = pdf.with_suffix(".csv")
        cells = expected_cells(csv_path) if csv_path.exists() else None
        rows.append(run_one(pdf, args.engine, workdir / "md", cells))

    if MANIFEST.exists():
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        for entry in manifest["files"]:
            pdf = NATIVE / entry["filename"]
            if not pdf.exists():
                rows.append({"file": entry["filename"], "ok": True, "skipped": True,
                             "reason": "non scaricato (fetch.py)"})
                continue
            rows.append(run_one(pdf, args.engine, workdir / "md", None))

    ok = [r for r in rows if r.get("ok") and not r.get("skipped")]
    skipped = [r for r in rows if r.get("skipped")]
    print(f"engine={args.engine} ok={len(ok)}/{len(rows) - len(skipped)} skipped={len(skipped)}")
    for r in rows:
        if r.get("skipped"):
            print(f"  {r['file']}: SKIP {r['reason']}")
            continue
        extra = ""
        if r.get("ok") and "exact_match" in r:
            m = r["exact_match"]
            extra = f" em={m['found']}/{m['expected']}"
            if m["missing"]:
                extra += f" missing={m['missing'][:3]}"
        status = "OK" if r.get("ok") else "KO " + r.get("error", "")
        perf = f" {r['sec_per_page']}s/pag" if r.get("ok") else ""
        print(f"  {r['file']}: {status}{perf}{extra}")
    (workdir / "report.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"report: {workdir / 'report.json'}")
    failed = [r for r in rows if not r.get("ok")]
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
