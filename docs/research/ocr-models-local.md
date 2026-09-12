# Research: modelli OCR 100% locali per tabelle anche storte

Ticket: [research] Confronto modelli OCR locali per tabelle anche storte
(https://github.com/carusoantonietta2017-cpu/j-pii/issues/16).
Vincoli: Q1 solo locale (no cloud), Q2 corpus pubblico in `bench/corpus/`.
Fonti primarie sotto: repo/docs/paper ufficiali, non write-up secondari.
Verificato il 2026-09-12; versioni alla data (pin nel ticket di benchmark).

## Verdetto

**Default: Docling. Sfidanti: PaddleOCR (PP-StructureV3) per foto storte/CPU,
MinerU per accuratezza tabelle complesse, Marker come challenger da bench.
olmOCR escluso dal default per Q1 (richiede GPU).**
La scelta finale va confermata con benchmark sul corpus
(`bench/corpus/`: 12 pagine native EN + 2 sintetiche IT + coppie
straight/warped); sotto il protocollo. Nessun timing locale misurato qui
(servirebbero installazioni pesanti): i numeri sotto sono dichiarati
dalle fonti, da riusare come ipotesi da verificare.

## Candidati (fonti primarie)

### Docling — default proposto
- Repo: https://github.com/docling-project/docling — `pip install docling`;
  descrizione "Get your documents ready for gen AI"; stelle ~66k.
- Licenza codice MIT (badge + sezione License del README); modelli con
  licenze dei pacchetti originali (stessa pagina).
- Architettura dichiarata: layout DocLayNet + tabelle TableFormer, gira
  "efficiently on commodity hardware in a small resource budget";
  "Advanced PDF understanding incl. page layout, reading order, table
  structure"; "Extensive OCR support for scanned PDFs and images";
  formati PDF/DOCX/PPTX/XLSX/HTML/immagini; export Markdown/HTML/JSON/DocTags;
  esempio `export_to_markdown()`.
- Perché default: MIT, installazione leggera, embedding Python diretto,
  pipeline modulare (coerente con visione OS a pezzi), HW modesto.
  Limite: README non dichiara deskew esplicito né merge tabelle
  cross-pagina — da misurare su warped/.

### PaddleOCR — sfidante foto-storte / CPU
- Repo: https://github.com/PaddlePaddle/PaddleOCR — Apache-2.0, ~89k stelle;
  badge hardware cpu/gpu/xpu/npu.
- Dichiara: PP-OCRv6 50 lingue in un solo modello (CJK + 46 latin-script,
  copre italiano senza switch); speedup CPU 5.2x end-to-end (OpenVINO),
  0.13s su A100 (tiny); PP-StructureV3 converte PDF/immagini in
  Markdown/JSON con coordinate celle/testo; PaddleOCR-VL-0.9B con 96.3%
  su OmniDocBench (self-reported); output Markdown + JSON.
- Punto chiave per noi: PP-DocLayoutV3 "mastering 5 tough scenarios:
  Skew, Warping, Scanning, Illumination, and Screen Photography" —
  unico a dichiarare skew/warp esplicito. Ideale come stadio
  deskew/OCR o alternativa quando Docling degrada su warped/.
- Costo: dipendenza PaddlePaddle pesante ma CPU-ok; da valutare
  freddezza install vs Docling.

### MinerU — sfidante accuratezza tabelle
- Repo: https://github.com/opendatalab/MinerU — ~80k stelle;
  "Transforms complex documents like PDFs and Office docs into
  LLM-ready markdown/JSON".
- Dichiara: formule→LaTeX, tabelle→HTML, layout reconstruction;
  scansioni, handwriting, multi-colonna, **merge tabelle cross-pagina**,
  immagini/formule dentro tabelle, testo verticale; backend `pipeline`
  "Fast & stable, no hallucination, runs on CPU or GPU"; livelli
  medium/high; supporto CPU puro mantenuto.
- Licenza: non più AGPLv3 — ora "MinerU Open Source License"
  (LICENSE.md nel repo), Apache-2.0 + termini aggiuntivi: soglia
  commerciale (100M MAU o $20M/mese → licenza commerciale) + attribution
  per servizi online. Per uso interno studio ok, ma leggere LICENSE.md
  prima di riuso commerciale/online.
- Costo: installazione più pesante (magic-pdf, modelli, cache); da usare
  dove Docling fallisce tabelle complesse.

### Marker (+Surya) — challenger da bench
- Repo: https://github.com/Datalab-to/marker — Apache-2.0, ~40k stelle;
  "Convert PDF to markdown + JSON quickly with high accuracy";
  tabelle/form/equazioni/code; GPU/CPU/MPS; output md+JSON+chunks+HTML;
  esempi md/JSON nel repo.
- Self-reported su olmOCR-Bench (1.403 PDF, terza parte):
  balanced 76.0% overall, 83.5% su born-digital, "ahead of MinerU and
  docling"; fast mode economico, no-OCR mode velocissimo; flag
  `--use_llm` opzionale (con Ollama resta locale, con API cloud
  violerebbe Q1 — vietato nel default).
- OCR via Surya VLM multilingua (vedi README Surya per lingue).
  Da includere nel benchmark come riferimento accuratezza.

### olmOCR / olmOCR 2 — esclusi dal default (GPU)
- Repo: https://github.com/allenai/olmocr — Apache-2.0, ~19k stelle;
  "Toolkit for linearizing PDFs"; paper 2502.18443 (+ 2510.19817 per v2,
  RL con unit-test, focus table parsing / multi-colonna).
- README: "Based on a 7B parameter VLM, so it requires a GPU";
  inference via vLLM (ex-SGLang), docker CUDA; costo dichiarato
  ~$176/M pagine vs $6.240/M di GPT-4o; fix auto-rotation in v0.3.0.
- Migliore qualità tabellare sulla carta, ma viola Q1 senza GPU:
  tenerlo come opzione futura documentata, non default.

## Foto storte: cosa dicono le fonti
- Solo PaddleOCR dichiara skew/warp; olmOCR dichiara auto-rotation fix.
  Docling/MinerU/Marker non dichiarano deskew nei README letti.
- Decisione: stadio pre-deskew esplicito comunque (es. OpenCV) prima
  dell'OCR, e misura degrado paired straight-vs-warped sul corpus.
  Il corpus fornisce già le coppie (`make_derived.py`, seed 7).

## Protocollo benchmark (per ticket 18 / build)
1. Dati: `bench/corpus/` — dichiarare pagine usate (default prime 3/PDF;
   restringere a tabellari dopo ispezione).
2. Metriche: TEDS o exact-match CSV su `synthetic_it/` (ground-truth);
   CER/WER straight vs warped; s/pagina su CPU con HW dichiarato.
3. Matrice: Docling (default) vs PaddleOCR vs MinerU vs Marker, stessi
   input, stessi seed; olmOCR solo se GPU disponibile (fuori default).
4. Criterio scelta: miglior trade-off tabelle-warped a budget CPU;
   in caso di parità vince modularità/licenza (Docling).

## Rischi / note
- Numeri di accuratezza sopra sono self-reported o di bench terze parti
  citate dai vendor: riusarli come ipotesi, non come verità.
- Licenze modelli (non solo codice) da ricontrollare a tempo di
  packaging per ogni backend scelto.
- Pesi/artefatti ML non si committano (già in `.gitignore`).
