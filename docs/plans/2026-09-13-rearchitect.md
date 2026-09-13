# Piano — Rearchitect v2 (VS-Code split + pairing + dock popup + trasparenza LLM)

Data: 2026-09-13. Stato: approvato WP0+WP1. Origine: `prompt/rearchitect.prompt.md`.
Vocabolario dominio: `CONTEXT.md` (placeholder/mapping/mask/restore/doubtful span).

## WP0 fondamenta [IN CORSO]
- pairing `raw` in `meta.json` + frontmatter `doc/*.md` + `scripts/migrate-raw-link.py`
- `manager.add(..., raw_source)` + `cli add --raw` + `POST add {rawName,rawDataBase64,rawPath}`
- `PUT /api/wiki/:slug/file` save editor (preserva frontmatter, rimette draft)
- `GET /api/status` + `GET /api/config` esteso (workdir, daemon, sidecar)
- `data-testid` stabili in `index.html` + `ui/tests/helpers.ts` riusabile
- Test: `ocr-pi/tests/test_manager.py` pairing, `ui/server.test.mjs` nuovi endpoint, `verify-ui.py` invariato

## WP1 viewer compare
- split Originale|Convertito sempre accoppiati via `Pair{raw,md}`
- viewer img + pdf `<object>` + skeleton + Riprova, sync-scroll opzionale
- deep-link `#/w/slug/v/file` + `#/w/slug/raw/file` stabili
- screenshot compare in `docs/shots/`

## WP2 editor + PII reale
- tabs Anteprima|Modifica|Split, save via PUT
- `POST /api/mask/preview` via sidecar rizzo-pii, `<mark data-label>` colori per-tag
- click mark -> Mask/Send-clear/Exclude

## WP3 dock popup + contesto
- popup draggable + detached window, stesso SSE, `context:{wiki,voce}`
- sessione per-wiki, system prompt con index+SKILL.md, guard no-raw strutturale, abort

## WP4 trasparenza LLM
- `/api/llm-log` + pannello, mai valori veri, banner leak + CTA j-pii

## WP5 menu/settings/wizard
- menubar, settings dialog, wizard workdir bloccante se `!exists||vuota`

## WP6 hardening
- PWA, export, docs, tag release con `verify-ui.py TUTTO OK`

Regola: niente merge web senza `node --test` + playwright verdi.
