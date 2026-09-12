# Prototipo anteprima (throwaway, branch `spike/18-preview`, mai merge)

Risponde a: [prototype] Anteprima conversione md + tabelle + immagini
(https://github.com/carusoantonietta2017-cpu/j-pii/issues/18).
Niente OCR vero: simula l'output di Docling su
`bench/corpus/synthetic_it/fattura_001.pdf` per fissare look & behavior.

## Vedere

```bash
git checkout spike/18-preview
python3 -m http.server -d prototype/preview 8000
# apri http://localhost:8000/preview.html
```

oppure apri `preview.html` direttamente nel browser.

## Cosa mostra

- Split-view: sinistra originale (SVG simulato con toggle Dritta/Storta
  via prospettiva CSS), destra Markdown con tabella + `![fig](assets/…)`.
- Badge: file, pagina, modello (Docling default), s/pagina (placeholder
  da benchmark reale), classe.
- Toggle Mask j-pii: `RSSMRA00A01H501U` ↔ `[CF_1]` su entrambi i pannelli
  (vocabolario CONTEXT.md: Mask/Restore, placeholder; dati fittizi).
- Barra review: checklist tabelle/figure/testo + Approva / Correggi
  tabella / Segnala PII (demo, solo toast).

## Cosa reagire (per chi guarda)

1. Layout split-view ok o serve terza colonna (md sorgente)?
2. Quali info mancano nei badge (confidenza celle? bbox? pagine)?
3. Toggle Mask in anteprima utile o confonde (il mask vero vale per il
   canale LLM, il disco resta in chiaro)?
4. Flusso review minimo sufficiente (approva/correggi/segnala)?

Verdetto atteso nel ticket: GO con modifiche elencate, oppure GO così.
File veri di conversione e benchmark restano fuori da qui (ticket 16/20).
