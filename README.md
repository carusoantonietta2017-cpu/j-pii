# j-pii

Local PII-masking hook for the [pi coding agent](https://github.com/badlogic/pi-mono), powered by vendored [rizzo-pii](https://github.com/Rizzo-AI-Academy/rizzo-pii) (Italian-first, reversible anonymization, 22 PII categories).

Every text sent to the LLM (your prompts, files the agent reads) travels with placeholders like `[CF_1]`; the real values live only in a per-session, in-memory mapping on your machine and are restored in answers and in files the agent writes. Nothing sensitive ever reaches the provider.

## Install

Prerequisites: Node 22+, Python 3.11+.

```bash
# 1. Extension dependencies
cd extension && npm install && cd ..

# 2. Sidecar environment (CPU is fine)
python3 -m venv .venv && .venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install transformers flask pymupdf huggingface_hub

# 3. Model weights (~1.2 GB, downloaded once)
.venv/bin/hf download rizzoaiacademy/rizzo-pii-0.3B --revision v1.5.0 \
  --local-dir rizzo-pii/models/rizzo-pii-0.3B-v1.5.0
```

## Run

```bash
pi -e ./extension/j-pii.ts
```

The sidecar starts lazily on the first masked call (~7 s model load, then <1 s per page on CPU), is reused while healthy, and stops with the session. Point at your venv:

```bash
JPII_PYTHON=.venv/bin/python pi -e ./extension/j-pii.ts
```

## Config (env vars)

| Var | Default | Meaning |
|---|---|---|
| `JPII_ANALYZER` | `real` | `fake` selects the offline regex analyzer (no model; CF + email shapes only) |
| `JPII_PYTHON` | `python3` | Interpreter running the sidecar |
| `JPII_SIDECAR_PORT` | `5005` | Sidecar port (`JPII_SIDECAR_URL` overrides the whole endpoint) |
| `JPII_MODEL_DIR` | auto (`rizzo-pii/models/...`) | Model directory for the sidecar |
| `JPII_EXCLUDE_TAGS` | _(none)_ | Comma-separated allowlist, e.g. `DATE,TIME,BUILDINGNUM,AGE` |

Starting recommendation: exclude timestamp/number noise (`DATE,TIME,BUILDINGNUM,AGE`) — the model flags PIDs, clock times and fragments aggressively. Tune per project; the extension remembers each doubtful decision for the session.

## Privacy guarantee

- The mapping never leaves the machine: no network call ever carries a real value (permanent leak-check test).
- Doubtful (unvalidated) detections halt the request and ask: mask it or explicitly send it in clear. Dismissal blocks instead of leaking.
- Any masking failure fails closed: the provider gets an empty payload (rejected), never the original text.
- Session isolation: the mapping is per-session, in memory, wiped on session start and shutdown. Nothing is persisted.

## Develop

```bash
cd extension && node --test && npx tsc --noEmit
```

TDD at the `mask()`/`restore()` seam with injected analyzers; hook wiring verified live. Vocabulary in `CONTEXT.md`; agent config in `AGENTS.md`.
