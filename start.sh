#!/usr/bin/env bash
# Avvio semplice di j-pii + ocr-pi. Tutto reale, niente mock.
# Default = modello rizzo-pii vero (JPII_ANALYZER=real).
#
# Uso:
#   ./start.sh          avvia pi (come ./start.sh pi)
#   ./start.sh pi       avvia pi con j-pii + ocr-pi reali
#   ./start.sh web      avvia l'app web locale
#   ./start.sh log      guarda il payload reale verso il modello (serve debug attivo)
#   ./start.sh help     mostra questo aiuto

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

PI_MODEL="muse-spark-1.3-contributor-free"
PI_PROVIDER="opencode"
JPII_PYTHON="$ROOT/.venv/bin/python"
OCR_PYTHON="$ROOT/ocr-pi/.venv/bin/python"
WEB_PORT="8001"
# Wiki fuori dal progetto (default ~/wiki, come README 6.1).
# Override puntuale: UI_WIKI_ROOT=/altro/percorso ./start.sh web
WEB_ROOT="${UI_WIKI_ROOT:-$HOME/wiki}"

help() {
  cat <<HELP
Uso: ./start.sh [comando]

Comandi:
  pi      Avvia pi con j-pii + ocr-pi reali (default).
          Usa il modello rizzo-pii vero, nessun fake.
  web     Avvia l'app web su http://localhost:$WEB_PORT
          Wiki in ~/wiki, OCR vero (docling), mask reale.
  log     Guarda il payload reale verso il modello (tail del log).
  help    Mostra questo aiuto.

Esempi:
  ./start.sh
  ./start.sh pi
  ./start.sh web
  JPII_DEBUG_PAYLOAD=1 ./start.sh web   # + ./start.sh log in un altro terminale

Tutto reale, niente mock:
  pi  = JPII_ANALYZER=real + modello rizzo-pii locale
  web = motore docling + sidecar reale sulla porta 5005
Debug (spento di default, scrive solo payload mascherati in /tmp):
  JPII_DEBUG_PAYLOAD=1 = logga ogni payload LLM-bound in /tmp/jpii-payload.log
HELP
}

check_file() {
  if [ ! -e "$1" ]; then
    echo "Manca: $1" >&2
    echo "Esegui prima l'installazione (vedi README capitolo 2)." >&2
    exit 1
  fi
}

cmd_pi() {
  check_file "$JPII_PYTHON"
  check_file "$OCR_PYTHON"
  check_file "$ROOT/rizzo-pii/models/rizzo-pii-0.3B-v1.5.0/model.safetensors"
  check_file "$ROOT/extension/j-pii.ts"
  check_file "$ROOT/extension/ocr-pi.ts"
  JPII_ANALYZER=real \
  JPII_PYTHON="$JPII_PYTHON" \
  exec pi \
    --provider "$PI_PROVIDER" \
    --model "$PI_MODEL" \
    -e ./extension/j-pii.ts \
    -e ./extension/ocr-pi.ts
}

SIDECAR_PID=""
cleanup_sidecar() {
  if [ -n "$SIDECAR_PID" ]; then
    kill "$SIDECAR_PID" 2>/dev/null || true
  fi
}

# Sidecar rizzo-pii reale: riusa quello già su, altrimenti lo avvia e aspetta /health.
# Senza sidecar la web ripiega su fake (solo CF/email) e non evidenzia nomi/telefoni.
ensure_sidecar() {
  if curl -sf -m 2 http://127.0.0.1:5005/health >/dev/null 2>&1; then
    return 0
  fi
  echo "Avvio modello rizzo-pii (la prima volta ~1 min)..."
  "$JPII_PYTHON" "$ROOT/rizzo-pii/src/app/app.py" --port 5005 > /tmp/rizzo-sidecar.log 2>&1 &
  SIDECAR_PID="$!"
  trap cleanup_sidecar EXIT INT TERM
  for _ in $(seq 1 120); do
    if curl -sf -m 2 http://127.0.0.1:5005/health >/dev/null 2>&1; then
      echo "Modello rizzo-pii pronto."
      return 0
    fi
    sleep 1
  done
  echo "Sidecar non pronto: vedi /tmp/rizzo-sidecar.log" >&2
  return 1
}

cmd_web() {
  check_file "$JPII_PYTHON"
  check_file "$OCR_PYTHON"
  check_file "$ROOT/ui/server.mjs"
  check_file "$ROOT/rizzo-pii/models/rizzo-pii-0.3B-v1.5.0/model.safetensors"
  ensure_sidecar
  echo "Web su http://localhost:$WEB_PORT (wiki: $WEB_ROOT)"
  if [ -n "$SIDECAR_PID" ]; then
    PORT="$WEB_PORT" \
    UI_WIKI_ROOT="$WEB_ROOT" \
    UI_PYTHON="$OCR_PYTHON" \
    JPII_ANALYZER=real \
    JPII_PYTHON="$JPII_PYTHON" \
    node ui/server.mjs
  else
    PORT="$WEB_PORT" \
    UI_WIKI_ROOT="$WEB_ROOT" \
    UI_PYTHON="$OCR_PYTHON" \
    JPII_ANALYZER=real \
    JPII_PYTHON="$JPII_PYTHON" \
    exec node ui/server.mjs
  fi
}

cmd_log() {
  if [ ! -f /tmp/jpii-payload.log ]; then
    echo "Log assente. Riavvia con: JPII_DEBUG_PAYLOAD=1 ./start.sh web" >&2
    echo "poi fai una domanda nel dock e rilancia ./start.sh log" >&2
    exit 1
  fi
  exec tail -f /tmp/jpii-payload.log
}

case "${1:-pi}" in
  pi|"") cmd_pi ;;
  web) cmd_web ;;
  log) cmd_log ;;
  help|-h|--help) help ;;
  *) echo "Comando sconosciuto: $1" >&2; echo "" >&2; help >&2; exit 1 ;;
esac
