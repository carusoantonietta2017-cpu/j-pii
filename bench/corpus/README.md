# Corpus benchmark OCR (pubblico, riproducibile)

Benchmark per scegliere il modello OCR locale in
[research] Confronto modelli OCR locali per tabelle anche storte
(https://github.com/carusoantonietta2017-cpu/j-pii/issues/16).
Task di origine:
[task] Corpus benchmark pubblico per OCR tabelle
(https://github.com/carusoantonietta2017-cpu/j-pii/issues/15).
Mappa: `prompt/ocr-pi.prompt.md`, vincoli Q1-Q4 (solo locale, dati pubblici).

## Layout

```text
bench/corpus/
  README.md            questa guida
  SOURCES.md           tabella fonti, licenze, classi
  manifest.json        URL + sha256 + bytes attesi (i PDF non si committano)
  fetch.py             scarica i PDF in native/ e verifica sha256 (solo stdlib)
  make_synthetic.py    genera synthetic_it/ CC0: fattura + tabella oraria IT (solo stdlib)
  make_derived.py      rende straight/ + warped/ dai PDF (richiede pymupdf + Pillow)
  native/              PDF scaricati (gitignored)
  synthetic_it/        CSV + MD ground-truth + PDF minimale (generati, committati)
  derived/             PNG dritti/storti (gitignored, generati)
```

I binari (`native/*.pdf`, `derived/**/*.png`) non si committano:
il repo tiene solo URL + hash + script.

## Uso rapido

```bash
python3 bench/corpus/fetch.py                 # scarica 4 PDF in bench/corpus/native/
python3 bench/corpus/fetch.py --check         # verifica sha senza riscaricare
python3 bench/corpus/make_synthetic.py        # genera synthetic_it/
pip install pymupdf pillow                    # solo per i derivati
python3 bench/corpus/make_derived.py          # straight/ + warped/ a 200 DPI
```

## Classi (Q2)

- `pdf-nativo`: i 4 paper arXiv, testo + tabelle reali, mai scansioni.
- `scansione-dritta`: `derived/straight/*.png`, render 200 DPI pagina intera.
- `foto-storta-tabella`: `derived/warped/*.png`, stessa pagina + prospettiva
  deterministica (seed 7, magnitudo 0.08) + lieve blur. Simula foto storta;
  la coppia straight/warped dà misura paired per il research modelli.

Pagine di default: prime 3 di ogni PDF (12 pagine native + 12 coppie
straight/warped). L'evaluator del research modelli restringe alle pagine
con tabelle vere dopo ispezione visiva e annota la scelta nel ticket.

## Metriche suggerite (il research modelli decide)

- Tabelle: TEDS o exact-match CSV su synthetic_it (ground-truth noto).
- Testo: CER/WER su straight vs warped (degrado da prospettiva).
- Budget: s/pagina su CPU con HW dichiarato; soglia da fissare nel research.

## Privacy

Niente dati cliente: solo paper pubblici + sintetici CC0 con PII fittizie
(`RSSMRA00A01H501U`, `mario.rossi@example.invalid`). I PDF arXiv si
scaricano a tempo di eval, non si ridistribuiscono.
