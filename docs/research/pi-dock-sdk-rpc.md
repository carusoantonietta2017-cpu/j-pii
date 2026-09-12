# Research: SDK/RPC pi per il dock agente

Ticket: [research] SDK/RPC pi per il dock agente
(https://github.com/carusoantonietta2017-cpu/j-pii/issues/32).
Fonti primarie: `sdk.md` + `rpc.md` + `usage.md` + `extensions.md` di pi
0.85.1 installato, esempi `examples/sdk/` (13 file). Letto il 2026-09-12.

## Verdetto

**Dock = sessione SDK embedded nel backend Node (non sottoprocesso RPC,
non MCP diretto dal browser).** Il server MCP nostro resta per agenti
esterni; il dock usa custom tools SDK sopra le stesse funzioni Python.

## Fatti (con fonte)

- SDK fatto apposta per questo: "Build a custom UI (web, desktop, mobile)"
  (`sdk.md`, Quick Start). `npm install @earendil-works/pi-coding-agent`,
  niente pacchetto separato.
- `createAgentSession({ sessionManager, modelRuntime })` + `session.prompt()`
  + `session.subscribe(event => ...)` per lo streaming (`sdk.md` §§ Quick
  Start, Prompting, Events). Eventi: `message_update/text_delta`,
  `tool_execution_*`, `turn_*`, `agent_*`, coda steer/followUp.
- `prompt()` accetta **immagini base64** (`images: [{type:"image", source:
  {type:"base64", mediaType, data}}]`, `sdk.md` § Prompting): il browser
  manda FileReader→base64, niente file temporanei, niente path.
- **Le nostre extension si caricano così come sono**: `DefaultResourceLoader
  ({additionalExtensionPaths: [".../extension/ocr-pi.ts", ".../j-pii.ts"]})`
  + `extensionFactories` inline + `eventBus` condiviso (`sdk.md` § Extensions,
  esempio `06-extensions.ts`). Hook doppia-domanda e Mask/Restore riusati.
- **Niente MCP built-in in pi** ("It intentionally does not include built-in
  MCP...", `usage.md`): i tool del dock si registrano come **custom tools
  SDK** (`sdk.md` § Custom Tools, esempio `05-tools.ts`) che chiamano
  demone/manager Python. Il nostro server MCP resta per agenti esterni
  (Claude Code ecc.).
- Sessioni persistibili (`SessionManager`, `sdk.md` §§ Session/Session
  Management, esempio `11-sessions.ts`): il dock ritrova la conversazione.
- Alternativa RPC (`rpc.md`): `pi --mode rpc`, JSONL su stdin/stdout,
  comandi `prompt/steer/follow_up/abort/new_session`, eventi in streaming,
  `id` per correlazione. Tenere come fallback per host non-Node; più
  fragile (processo esterno, framing LF-only, niente tipi).

## Disegno dock (per lo spike)

Browser → backend Node (REST/SSE) → sessione SDK (extension nostre +
custom tools wiki/ocr) → demone Python / `cli.py`. Chiavi e modelli restano
backend-side; il browser manda solo testo + base64.

## Punto aperto (per prototype #34)

L'hook doppia-domanda in sessione SDK headless: `ctx.hasUI` falso → oggi
fail-closed. Il dock deve fare le due domande **nella web UI** e passare le
risposte (opzioni al tool / pre-risposte iniettate), non lasciare il blocco.
Decidere nello spike, non qui.
