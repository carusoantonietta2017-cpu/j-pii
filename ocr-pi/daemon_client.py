"""Client del demone converter (condiviso da hook/MCP/preview). Solo stdlib.

ensure_daemon(): avvia `daemon.py` se non vivo (una volta per processo).
request(...): una conversione via protocollo JSON-lines.
stop(): chiude stdin e attende l'uscita (usato a fine sessione).
Se il demone non parte, il chiamante ricade sullo spawn singolo (fail-safe).
"""
import json
import subprocess
import sys
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent

_proc = None
_lock = threading.Lock()
_next_id = 0
_pending: dict = {}
_reader_started = False


def _python() -> str:
    venv = HERE / ".venv" / "bin" / "python"
    return str(venv) if venv.exists() else sys.executable


def _start() -> None:
    global _proc, _reader_started
    _proc = subprocess.Popen(
        [_python(), str(HERE / "daemon.py")],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=None,
        text=True, bufsize=1)
    _reader_started = True
    threading.Thread(target=_drain, daemon=True).start()


def _drain() -> None:
    for line in _proc.stdout:
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        fut = _pending.pop(msg.get("id"), None)
        if fut is not None:
            fut["msg"] = msg
            fut["done"].set()


def ensure_daemon() -> None:
    """Avvia il demone se assente o morto. Solleva RuntimeError se non parte."""
    global _proc
    with _lock:
        if _proc is not None and _proc.poll() is None:
            return
        _start()
        if _proc.poll() is not None:
            raise RuntimeError("demone converter non partito")


def request(source, engine="docling", pages=None, workdir=".", deskew=False,
            timeout=900) -> dict:
    """Conversione via demone. Ritorna il result (o solleva RuntimeError)."""
    import threading as _t
    global _next_id
    ensure_daemon()
    with _lock:
        _next_id += 1
        rid = _next_id
    fut = {"done": _t.Event(), "msg": None}
    _pending[rid] = fut
    payload = {"id": rid, "op": "convert", "source": str(source), "engine": engine,
               "pages": pages, "workdir": str(workdir), "deskew": deskew}
    try:
        _proc.stdin.write(json.dumps(payload) + "\n")
        _proc.stdin.flush()
    except (BrokenPipeError, OSError) as e:
        _pending.pop(rid, None)
        raise RuntimeError(f"demone non raggiungibile: {e}") from e
    if not fut["done"].wait(timeout):
        _pending.pop(rid, None)
        raise RuntimeError("demone: timeout risposta")
    msg = fut["msg"]
    if not msg.get("ok"):
        raise RuntimeError(msg.get("error", "errore demone"))
    return msg["result"]


def ping(timeout=30) -> dict:
    ensure_daemon()
    import threading as _t
    global _next_id
    with _lock:
        _next_id += 1
        rid = _next_id
    fut = {"done": _t.Event(), "msg": None}
    _pending[rid] = fut
    _proc.stdin.write(json.dumps({"id": rid, "op": "ping"}) + "\n")
    _proc.stdin.flush()
    if not fut["done"].wait(timeout):
        raise RuntimeError("demone: ping senza risposta")
    return fut["msg"]["result"]


def stop() -> None:
    """Chiude il demone (fine sessione). Mai solleva."""
    global _proc
    with _lock:
        proc, _proc = _proc, None
    if proc is None:
        return
    try:
        proc.stdin.close()
        proc.wait(timeout=30)
    except Exception:  # noqa: BLE001 - shutdown best-effort
        try:
            proc.kill()
        except Exception:  # noqa: BLE001
            pass
