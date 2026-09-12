# j-pii + ocr-pi — guida utente

Due strumenti che lavorano insieme dentro l'agente **pi**:

- **j-pii** — il buttadifuori della privacy: maschera i dati sensibili prima che arrivino all'LLM e li ripristina nelle risposte. I valori veri non lasciano mai il tuo computer.
- **ocr-pi** — il convertitore di documenti: trasforma immagini e PDF in Markdown con tabelle (anche storte), li organizza in dizionari wiki consultabili e li rende usabili dall'agente.

Questa guida spiega tutto in parole semplici, passo passo.

---

## 1. Requisiti

- Node 22+
- Python 3.11+
- L'agente `pi` installato
- Spazio disco (~4 GB per i modelli, scaricati una volta sola)

## 2. Installazione (una volta sola)

```bash
# 1. Dipendenze dell'extension
cd extension && npm install && cd ..

# 2. Ambiente Python per OCR e privacy (solo CPU, niente GPU)
python3 -m venv ocr-pi/.venv
ocr-pi/.venv/bin/pip install docling pillow opencv-python-headless mcp pymupdf
python3 -m venv .venv
.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install transformers flask pymupdf huggingface_hub

# 3. Pesi del modello privacy (~1.2 GB, una volta sola)
.venv/bin/hf download rizzoaiacademy/rizzo-pii-0.3B --revision v1.5.0 \
  --local-dir rizzo-pii/models/rizzo-pii-0.3B-v1.5.0
```

I modelli OCR si scaricano da soli alla prima conversione. Pesi e file
scaricati non finiscono mai nel repo.

## 3. Avvio

```bash
JPII_ANALYZER=fake JPII_PYTHON=.venv/bin/python pi \
  --provider opencode --model muse-spark-1.3-contributor-free \
  -e ./extension/j-pii.ts -e ./extension/ocr-pi.ts
```

La prima conversione impiega qualche minuto (carica i modelli), poi è veloce.
Per una prova senza modello privacy: `JPII_ANALYZER=fake` riconosce solo
codice fiscale ed email, ma il giro completo funziona.

---

## 4. j-pii: la privacy automatica

Non devi fare niente: ogni testo diretto all'LLM (i tuoi prompt, i file che
l'agente legge) viaggia con segnaposto tipo `[CF_1]` al posto dei dati veri.
Nelle risposte e nei file scritti ritrovi i valori veri.

Tre prove:

- **A (silenzioso):** `Codice fiscale RSSMRA80A01H501U: elenca il segnaposto che vedi.`
- **B (revisione umana):** `Riepiloga questo: Mario Rossi, codice fiscale RSSMRA80A01H501U`
  → per i casi dubbi compare `Mask it / Send in clear`: scegli tu, se ignori
  la richiesta viene bloccata invece di far passare dati.
- **C (file scritti):** fai scrivere un file con un codice fiscale e verifica
  che su disco ci sia il valore vero (l'LLM ha maneggiato solo `[CF_1]`).

Garanzie: la mappa segnaposto→valore non lascia mai la macchina, niente su
disco, cancellata a fine sessione. Qualsiasi errore blocca invece di far passare dati.

---

## 5. ocr-pi: convertire immagini e PDF

### 5.1 Le due domande (hook)

Quando alleghi un'immagine (trascinala nel terminale, incollala, o citala con
`@/percorso/immagine.png`), prima che parta qualsiasi cosa ti vengono fatte
**due domande, una sola volta per sessione**:

1. **Usare l'OCR locale?** — Sì = converte in Markdown sul tuo computer.
   No = invia l'immagine originale al provider (con avviso).
2. **Contiene dati sensibili?** — Sì = il testo estratto passa per j-pii
   (mascherato verso l'LLM). No = testo in chiaro, ma solo per quel documento.

Se chiudi le domande senza rispondere, o non c'è interfaccia, la richiesta
viene **bloccata** (mai invii silenziosi). File non validi vengono saltati
con avviso chiaro.

### 5.2 Dizionari wiki: i tuoi archivi consultabili

Una wiki è una cartella con i documenti trascritti, un indice, le immagini e
una `SKILL.md` che spiega all'agente quando usarla. Comandi base:

```bash
python3 ocr-pi/cli.py --root ~/wiki create fatture
python3 ocr-pi/cli.py --root ~/wiki add fatture documento.md --titolo Voce
python3 ocr-pi/cli.py --root ~/wiki search iva --stato draft
python3 ocr-pi/cli.py --root ~/wiki review fatture Voce reviewed
python3 ocr-pi/cli.py --root ~/wiki export fatture [--senza-raw]
python3 ocr-pi/cli.py --root ~/wiki import fatture.zip [--merge]
python3 ocr-pi/cli.py --root ~/wiki remove fatture Voce   # va nel cestino
```

Regole d'oro: tutto nasce `draft` (bozza), si esporta solo ciò che è
`reviewed` (verificato); le eliminazioni vanno nel cestino; gli import non
sovrascrivono mai in silenzio (conflitti saltati + segnalati).

### 5.3 MCP: i comandi per l'agente

Lo stesso di sopra, ma per l'agente invece che per te: 9 comandi
(`ocr_convert`, `wiki_list/search/get/add/review/remove/export/import`).
L'agente converte e archivia da solo quando glielo chiedi.

### 5.4 Anteprima: vedi prima di fidarti

```bash
python3 ocr-pi/preview.py --pdf scan.pdf --engine docling --wiki-root ~/wiki --slug demo --out prev-out
```

Apre originale e Markdown fianco a fianco, con tabelle evidenziate,
interruttore Mask e pulsanti Approva/Rimanda collegati alla wiki.

---

## 6. App web (PWA locale)

```bash
cd ui && npm install          # solo per il dock (SDK pi)
PORT=8001 UI_WIKI_ROOT=~/wiki node ui/server.mjs
# apri http://localhost:8001 — anche dal telefono in rete locale
```

Sidebar Folder/Wiki, split originale/convertito, review approva/rimanda,
menu esporta/importa/rinomina, converti-da-file, dock agente con immagini.
Prima conversione lenta (~2 min), poi secondi (demone). `JPII_*` come sopra
per la mask nel dock; modello dock via `UI_MODEL` (default opencode gratis).

## 7. Se qualcosa non va

| Sintomo | Cosa fare |
|---|---|
| Prima conversione lentissima | Normale: carica i modelli una volta sola (~2 min), poi è veloce |
| `j-pii blocked ... review dismissed` | C'era un caso dubbio e non hai confermato: rispondi al prompt |
| `ocr-pi blocked ...` | Hai chiuso le domande senza rispondere: riprova e rispondi |
| `salto ... (non è un'immagine valida)` | Il file non è un'immagine leggibile: controlla il file |
| Troppe richieste di revisione | Allarga `JPII_EXCLUDE_TAGS=DATE,TIME,BUILDINGNUM,AGE` |
| `ModuleNotFoundError` | Usa il python del venv giusto (`ocr-pi/.venv/bin/python`) |

Log utili: `/tmp/ocr-pi-daemon.log` (demone converter),
`/tmp/jpii-payload.log` (cosa riceve davvero l'LLM, con extension debug).

## 8. Per sviluppatori

```bash
python3 -m unittest discover -s ocr-pi/tests -t .   # test rapidi (fake)
ocr-pi/.venv/bin/python -m unittest discover -s ocr-pi/tests -t .  # tutti
python3 bench/run.py --engine fake                   # benchmark senza modelli
cd extension && node --test && npx tsc --noEmit      # test + tipi
```

Dettagli tecnici (architettura, decisioni, benchmark): `docs/research/`,
`bench/corpus/`, issue tracker GitHub.
