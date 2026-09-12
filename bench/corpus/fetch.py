#!/usr/bin/env python3
"""Scarica i PDF del corpus e verifica sha256. Solo stdlib.

Uso:
  python3 bench/corpus/fetch.py                 # scarica + verifica
  python3 bench/corpus/fetch.py --check         # solo verifica
  python3 bench/corpus/fetch.py --out DIR       # altra cartella native/
I PDF non si committano: il repo tiene URL + hash in manifest.json.
"""
import argparse
import hashlib
import json
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "manifest.json"
DEFAULT_OUT = HERE / "native"
CHUNK = 1024 * 256


def load_manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(CHUNK), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch_one(entry: dict, out: Path) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    dest = out / entry["filename"]
    print(f"GET {entry['url']} -> {dest} ({entry['bytes']} B attesi)")
    req = urllib.request.Request(entry["url"], headers={"User-Agent": "j-pii-bench/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r, dest.open("wb") as f:
        total = 0
        while True:
            chunk = r.read(CHUNK)
            if not chunk:
                break
            f.write(chunk)
            total += len(chunk)
    print(f"  scaricati {total} B")
    return dest


def verify(dest: Path, entry: dict) -> bool:
    if not dest.exists():
        print(f"  MANCA {dest}")
        return False
    got = sha256_of(dest)
    ok = got == entry["sha256"]
    size = dest.stat().st_size
    size_ok = size == entry["bytes"]
    print(f"  sha256 {'OK' if ok else 'MISMATCH'} ({got[:16]}...)")
    print(f"  bytes  {'OK' if size_ok else 'DIFF'} ({size} vs {entry['bytes']})")
    if not ok:
        print("  !! pinna la versione vN su arXiv o aggiorna manifest.json", file=sys.stderr)
    return ok and size_ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    ap.add_argument("--check", action="store_true", help="solo verifica, non scaricare")
    ap.add_argument("--manifest", default=str(MANIFEST))
    args = ap.parse_args()
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    out = Path(args.out)
    all_ok = True
    for entry in manifest["files"]:
        dest = out / entry["filename"]
        if not args.check or not dest.exists():
            if args.check:
                print(f"{entry['filename']}: assente, salto (--check)")
                all_ok = False
                continue
            try:
                dest = fetch_one(entry, out)
            except Exception as e:  # noqa: BLE001 - script operativo, messaggio e via
                print(f"  ERRORE download {entry['filename']}: {e}", file=sys.stderr)
                all_ok = False
                continue
        if not verify(dest, entry):
            all_ok = False
    print("CORPUS OK" if all_ok else "CORPUS KO")
    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
