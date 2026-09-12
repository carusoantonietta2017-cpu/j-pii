# Research: PWA locale sopra backend esistente

Ticket: [research] PWA locale sopra backend esistente
(https://github.com/carusoantonietta2017-cpu/j-pii/issues/33).
Base: demone converter JSON-lines, `manager.py`/`cli.py`, MCP stdio,
`preview.py`, dossier dock SDK (#32). Vincolo: niente rewrite backend.

## Verdetto

**Backend Node (ospita SDK + REST/SSE + statici PWA) + demone Python
persistente (converter) + manager via spawn `cli.py` una tantum (niente
modelli). Zero nuovi framework: `node:http` stdlib + SSE per la chat.**

## Architettura

```text
browser PWA ──HTTPS?/HTTP LAN── Node backend
                                 ├─ static/ (app: sidebar, split, dock)
                                 ├─ REST  POST /api/convert  -> daemon_client (demone vivo)
                                 │        GET/POST /api/wiki/* -> spawn cli.py (economico)
                                 │        GET /api/preview/*   -> riuso preview.py
                                 └─ SSE   POST /api/chat      -> sessione SDK pi
                                                              (extension + custom tools)
python demone (converter, modelli in memoria) — già esiste (b8)
```

- Demone già parla JSON-lines: il backend Node gli parla via stdio come
  `daemon_client.py` (stesso protocollo, client TS già in `ocr-pi.ts`).
- Manager senza modelli: spawn `cli.py` per operazione (~50 ms, già misurato
  nei test) — niente demone secondo, niente FastAPI.
- Chat dock in streaming: eventi SDK → SSE; immagini dal browser come
  base64 (dossier #32); risposte Mask/Restore via hook riusato.
- Statici PWA: `manifest.json` + icone + layout da prototype #35; niente
  build-step v1 (HTML/CSS/JS diretti, come `preview.html`).

## Mobile (onesto)

- File-picker e layout responsive funzionano su HTTP LAN senza problemi.
- Installazione PWA/service-worker vuole HTTPS (o localhost): v1 = uso da
  browser senza installazione; HTTPS via mkcert/Tailscale dopo (non in v1).
- Dock come bottom-sheet (Q4): già deciso, codice nel prototype #35.

## Packaging v1

`npm install @earendil-works/pi-coding-agent` + `npm start` (backend);
venv + modelli come da README root (già documentato); log demone su file
(già così). Niente store, niente cloud, tutto localhost.

## Da aggiungere (stima per la build)

Backend Node ~300 righe (static+SSe+REST+spawn), PWA statica dal mock #35,
wiring SDK da dossier #32. Prima il mock (#35) e lo spike dock (#34): solo
dopo, il backend vero.
