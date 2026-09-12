# Mock layout app (throwaway, branch `spike/35-layout`, mai merge)

Risponde a: [prototype] Layout responsive cliccabile
(https://github.com/carusoantonietta2017-cpu/j-pii/issues/35).
Replica il diagramma `prompt/.excalidraw` con dati finti.

## Vedere (anche da mobile in LAN)

```bash
git checkout spike/35-layout
python3 -m http.server -d prototype/ui-layout 8000
# desktop: http://localhost:8000/ — restringi sotto 800px per il mobile
```

## Cosa mostra

- Sidebar doppia Folder (pdf) / Wiki (md + ✓ verificati), voce selezionabile.
- Split originale (SVG) / convertito (tabella + `![fig](assets/…)` + Approva/Rimanda + evidenzia tabelle).
- Dock agente sotto con prompt d'esempio `crea una wiki con il file @aaa00.pdf` e risposta finta.
- Mobile <800px: hamburger→drawer, tab Originale/Convertito, dock a foglio bottom.

## Reagire

1. Tre pannelli desktop ok o troppo densi?
2. Tab mobile invece dello split: accettabile per confrontare?
3. Review approva/rimanda sufficiente o serve "correggi" inline?
4. Dock sempre visibile o collassato di default anche su desktop?
5. Badge voci sensibili: dove lo metteresti (sidebar? tabella? entrambi)?

Verdetto nel ticket; fix di stile all'audit Vercel dedicato (non qui).
