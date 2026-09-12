# Spike dock agente (throwaway, branch `spike/34-dock`, mai merge)

Risponde a: [prototype] Spike dock agente
(https://github.com/carusoantonietta2017-cpu/j-pii/issues/34).

## Cosa prova

Un pannello-come-codice: sessione SDK pi + custom tool `wiki_search`
(su `fixture/`) + prompt reale via provider opencode. Nessun mock di risposta.

## Eseguire

```bash
node prototype/dock-spike/sdk-spike.mjs
```

Atteso: `tool chiamati: ["iva"]` + `risposta: "fattura.md\nscontrino.md"`.

## Verdetto: GO

Il dock è fattibile con SDK embedded + custom tools (niente MCP dal browser,
niente sottoprocesso RPC). Note per la build: modello esplicito opencode
(il default variava → 401); in sessione headless le domande UI degli hook
(double-domande ocr-pi, doubtful j-pii) vanno pre-risposte dalla web UI,
altrimenti fail-closed.
