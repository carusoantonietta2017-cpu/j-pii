# j-pii

j-pii è un **filtro privacy per l'agente pi**: ogni testo diretto all'LLM (i tuoi prompt, i file che l'agente legge) viaggia con **segnaposto** tipo `[CF_1]` al posto dei dati veri. I valori reali restano solo sul tuo computer, in una mappa di sessione che non viene mai salvata né inviata, e vengono **ripristinati** nelle risposte e nei file che l'agente scrive.

Il riconoscimento dei dati sensibili è di [rizzo-pii](https://github.com/Rizzo-AI-Academy/rizzo-pii) (italiano, 22 categorie: codice fiscale, P.IVA, IBAN, nomi, email...), eseguito **in locale** sulla tua CPU.

## Installazione (una volta sola)

Requisiti: Node 22+, Python 3.11+.

```bash
# 1. Dipendenze dell'extension
cd extension && npm install && cd ..

# 2. Ambiente Python del sidecar (solo CPU, niente GPU)
python3 -m venv .venv
.venv/bin/pip install torch --index-url https://download.pytorch.org/whl/cpu
.venv/bin/pip install transformers flask pymupdf huggingface_hub

# 3. Pesi del modello (~1.2 GB, scaricati una volta)
.venv/bin/hf download rizzoaiacademy/rizzo-pii-0.3B --revision v1.5.0 \
  --local-dir rizzo-pii/models/rizzo-pii-0.3B-v1.5.0
```

Verifica così:

```bash
ls rizzo-pii/models/rizzo-pii-0.3B-v1.5.0/ && .venv/bin/python -c "import torch, transformers, flask; print('deps ok')"
```

## Avvio

```bash
JPII_PYTHON=.venv/bin/python pi --provider opencode --model muse-spark-1.3-contributor-free -e ./extension/j-pii.ts
```

Il modello si carica da solo alla prima chiamata che lo richiede (**~10-15 secondi una volta sola**, poi ~1 secondo a lettura). Se serve solo una prova senza modello:

```bash
JPII_ANALYZER=fake pi ... -e ./extension/j-pii.ts
```

(con `fake` riconosce solo codice fiscale ed email, ma il giro completo funziona).

## Le tre prove

### Prova A — mascheramento silenzioso

> `Codice fiscale RSSMRA80A01H501U: elenca il segnaposto che vedi.`

Il codice fiscale è un rilevamento sicuro: parte senza chiedere niente. Nella risposta vedi il valore vero — sull'wire c'era solo `[CF_1]`.

> Consiglio: frasi secche tipo *"elenca i segnaposto, uno per riga, senza commenti"*. Se chiedi cose vaghe, l'agente parte a cercare nel repo e sembra tutto lento (è lui che esplora, non j-pii).

### Prova B — revisione umana (il cuore)

> `Riepiloga questo: Mario Rossi, codice fiscale RSSMRA80A01H501U`

Il codice fiscale va via liscio, ma per `Mario Rossi` (rilevamento non verificato) compare:

> `j-pii doubtful FULLNAME: "Mario Rossi" — mask it?` → `[Mask it] / [Send in clear]`

Scegli tu: **Mask it** lo maschera e ricorda la scelta per la sessione; **Send in clear** lo manda in chiaro con avviso esplicito; se ignori il prompt, la richiesta viene **bloccata** invece di far passare dati.

### Prova C — file scritti

> `Scrivi con lo strumento write nel file /tmp/demo-letter.txt la riga: codice fiscale RSSMRA80A01H501U. Non aggiungere altro testo.`

L'agente risponde `Fatto` e su disco trovi il valore vero:

```bash
cat /tmp/demo-letter.txt
# codice fiscale RSSMRA80A01H501U.
```

L'LLM ha maneggiato solo `[CF_1]`: i valori veri non escono mai.

## Vedere con i tuoi occhi cosa riceve l'LLM

Aggiungi l'extension di debug (solo sviluppo, mai spedita):

```bash
pi -e ./extension/j-pii.ts -e ./extension/debug-payload.ts ... (resto uguale)
```

poi apri `/tmp/jpii-payload.log`: una riga per messaggio, già mascherato. Esempio reale:

```
[user] Dato [CF_1], dimmi ok.
```

Cerca i tuoi dati con `grep`: se trovi solo `[XXX_N]`, è tutto a posto. La dashboard del provider (es. OpenRouter → activity) mostra gli stessi testi: è la controprova indipendente.

## Configurazione (variabili d'ambiente)

| Variabile | Default | Cosa fa |
|---|---|---|
| `JPII_ANALYZER` | `real` | `fake` = prova senza modello (solo CF + email) |
| `JPII_PYTHON` | `python3` | Interprete per il sidecar (es. `.venv/bin/python`) |
| `JPII_SIDECAR_PORT` | `5005` | Porta del sidecar (`JPII_SIDECAR_URL` la sostituisce) |
| `JPII_MODEL_DIR` | auto (`rizzo-pii/models/...`) | Cartella del modello per il sidecar |
| `JPII_EXCLUDE_TAGS` | _(nessuna)_ | Allowlist, es. `DATE,TIME,BUILDINGNUM,AGE` |

Parti consigliati: `JPII_EXCLUDE_TAGS=DATE,TIME,BUILDINGNUM,AGE` — il modello segnala aggressivamente orari, PID e frammenti numerici; con l'allowlist restano fuori e i casi veri passano lisci.

## Garanzie privacy

- La mappa segnaposto→valore **non lascia mai la macchina**: nessun valore vero in rete (test automatico permanente), niente su disco, isolata per sessione e cancellata all'uscita.
- I casi dubbi **fermano la richiesta** e chiedono a te; mai passaggio silenzioso.
- Qualsiasi errore di mascheramento **blocca** (al provider arriva un payload vuoto, rifiutato) — mai il testo originale.
- Vengono mascherati solo i tuoi prompt e i risultati dei tool; prompt di sistema, nomi dei tool e cronologia assistente restano intatti.

## Se qualcosa non va

- **Prima risposta lentissima**: normale, carica il modello (~10-15 s una volta sola).
- **`j-pii blocked ... review dismissed`**: c'era uno span dubbio e il prompt di scelta non è stato confermato (in modalità non interattiva non si può scegliere: blocca sempre).
- **`Model is not supported` dal provider**: quasi sempre è il blocco qui sopra (payload svuotato e rifiutato). Leggi la riga `j-pii blocked` subito sopra: dice il perché e quali span l'hanno fermata.
- **Troppe richieste di revisione**: allarga `JPII_EXCLUDE_TAGS`; le scelte restano comunque memorizzate per la sessione.

## Sviluppo

```bash
cd extension && node --test && npx tsc --noEmit
```

TDD sul nucleo `mask()`/`restore()` con analyzer iniettati; wiring degli hook verificato live. Vocabolario in `CONTEXT.md`, config agenti in `AGENTS.md`.
