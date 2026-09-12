#!/usr/bin/env python3
"""Demone converter persistente: modelli caricati una volta, riuso per sessione.

Protocollo JSON-lines su stdin/stdout (una richiesta per riga):
  {"id": 1, "op": "convert", "source": "scan.png", "engine": "docling",
   "pages": [1], "workdir": "/tmp/x", "deskew": false}
  {"id": 2, "op": "ping"}
Risposte:
  {"id": 1, "ok": true, "result": {"markdown": ..., "assets": [...],
   "pages": 1, "engine": "docling", "seconds": 4.2, "deskew_applied": false}}
  {"id": 2, "ok": true, "result": {"engines": ["docling"]}}
  {"id": 3, "ok": false, "error": "FileNotFoundError: ..."}
Uso: python ocr-pi/daemon.py  (log su stderr, mai stdout: lì parla il protocollo)
"""
import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from converter import ENGINES, convert  # noqa: E402

_converters: dict = {}


def get_engine(name: str):
    if name not in _converters:
        try:
            factory = ENGINES[name]
        except KeyError:
            raise ValueError(f"engine sconosciuto: {name} (noti: {sorted(ENGINES)})") from None
        _converters[name] = factory()  # caricamento pesante: una volta sola
    return _converters[name]


def handle(req: dict):
    op = req.get("op", "convert")
    if op == "ping":
        return {"engines": sorted(_converters)}
    if op != "convert":
        raise ValueError(f"op sconosciuta: {op}")
    r = convert(req["source"], pages=req.get("pages"), engine=req.get("engine", "docling"),
                workdir=req.get("workdir", "."), engine_obj=get_engine(req.get("engine", "docling")),
                deskew=bool(req.get("deskew", False)))
    return {"markdown": r.markdown, "assets": [str(a) for a in r.assets], "pages": r.pages,
            "engine": r.engine, "seconds": round(r.seconds, 2), "deskew_applied": r.deskew_applied}


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def main() -> int:
    log("ocr-pi daemon pronto (JSON-lines su stdin/stdout)")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            rid = req.get("id")
        except json.JSONDecodeError as e:
            sys.stdout.write(json.dumps({"id": None, "ok": False, "error": f"JSON invalido: {e}"}) + "\n")
            sys.stdout.flush()
            continue
        try:
            result = handle(req)
            sys.stdout.write(json.dumps({"id": rid, "ok": True, "result": result}, ensure_ascii=False) + "\n")
        except Exception as e:  # noqa: BLE001 - l'errore viaggia nel protocollo
            log(f"richiesta {rid} fallita: {e!r}")
            sys.stdout.write(json.dumps({"id": rid, "ok": False,
                                         "error": f"{type(e).__name__}: {e}"}) + "\n")
        sys.stdout.flush()
    log("ocr-pi daemon: stdin chiuso, esco")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
