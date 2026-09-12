# Research: formato LLM wiki + SKILL.md (pattern annota.ai)

Ticket: [research] Pattern annota.ai + formato LLM wiki con SKILL.md
(https://github.com/carusoantonietta2017-cpu/j-pii/issues/17).
Fonti primarie: pagina https://annota.ai/documents/ (letta il 2026-09-12),
spec Agent Skills https://agentskills.io/specification (via docs pi),
`docs/skills.md` di pi (installato). Video YouTube non visionabile da qui:
i fatti sotto vengono dalla pagina, non dal video.

## Verdetto

**Formato wiki proposto sotto (cartella per wiki, md + assets/ + raw/ +
meta.json + index.md + SKILL.md). Replica il pattern Annota (ZIP md +
LLM Wiki Obsidian-compatibile) con la delta richiesta: SKILL.md
pi-discoverable alla radice della wiki.**

## Cosa fa Annota (dalla loro pagina)

- Workflow in 3 passi: 01 import PDF/PNG/JPEG con OCR pagina per pagina;
  02 review originale-vs-estratto (correggi Markdown, controlla figure e
  tabelle, approva); 03 preserva una dataset version come riferimento
  stabile, poi esporta quella versione o continua a lavorare. Entrambi
  gli export includono correzioni OCR + figure estratte.
- Export Markdown ZIP: un file Markdown per documento + figure in cartella
  images. Struttura d'esempio mostrata: `document.md`, `images/`,
  `document/figure.png`. "Best for reusing extracted content".
- Export LLM Wiki: "Obsidian-compatible workspace with original documents,
  corrected transcriptions, an index, and instructions for an AI agent.
  Your agent builds and explores knowledge from the exported sources."
  Struttura d'esempio: `README.md`, `AGENTS.md`, `raw/sources/`, `wiki/`,
  `index.md`, `sources/`.
- MCP: "Keep your agent connected to the source. Through MCP, your agent
  can read document pages, edit OCR text, update review status, and
  retrieve exports." Esempi mostrati: `list_assets`, `list_document_pages`
  (read), `update_document_page` (write), dialoghi tipo "which documents
  still need review?", "show me the first page of the invoice",
  "correct the invoice number…", "mark this invoice…".
- Meta description pagina: "Turn PDFs and scans into reviewed Markdown.
  Extract text, tables, and figures, preserve dataset versions, and
  export documents for your AI tools."

## Formato proposto (nostro)

```text
wiki/<slug>/
  SKILL.md            frontmatter name/description + istruzioni agente
  README.md           cosa contiene, versione dataset, modello OCR usato
  AGENTS.md           note operative per agenti (compat Annota)
  index.md            tabella voci: titolo | path md | stato review | pagine
  doc/<nome>.md       trascrizione corretta, con ![fig](assets/...) + rif pagina
  doc/assets/         figure estratte (nomi stabili, es. p03-fig01.png)
  raw/                originali (PDF/PNG) o pointer se troppo pesanti
  meta.json           {source, ocr_engine, ocr_version, pages, created, version}
  wiki-export.zip     artefatto (md + images/, stile Annota ZIP)
```

Regole:
- Obsidian-compatibile: solo Markdown + link relativi, niente DB.
- Ogni immagine ha sia riferimento nel md (`![didascalia](assets/…)`)
  sia file in `assets/` sia originale in `raw/`: l'agente che legge
  l'export può analizzare testo + immagine (requisito utente).
- Stati review per voce: `draft → reviewed → versioned`; si esporta
  solo `reviewed+` (come Annota: export dalla versione stabile).
- Wiki (knowledge esportabile) ≠ Mapping j-pii (placeholder→valore,
  mai su disco/rete): non mescolare i termini (CONTEXT.md).
- Una wiki = una cartella versionabile in git; import/export = zip
  di quella cartella (dettagli merge nel ticket Wiki-manager).

## SKILL.md (compat pi, Agent Skills)

Da `docs/skills.md` di pi (standard agentskills.io, tollerante):
- Skill = directory con `SKILL.md`; pi la scopre ricorsivamente;
  diagnosis: descrizioni sempre in contesto, istruzioni on-demand.
- Frontmatter obbligatorio: `name` (1-64 char, solo `a-z0-9-`, no
  doppi/esterni trattini) + `description` (max 1024, specifica: cosa fa
  e quando usarla). Senza description non carica (warning).
- Il `name` NON deve coincidere con la directory (pi deroga allo
  standard). Path relativi dalla directory skill per script/reference.
- Scheletro consigliato per le nostre wiki (generato all'export):

```markdown
---
name: wiki-fatture-2026
description: Fatture 2026 trascritte da scansioni con tabelle verificate. Usala quando servono importi, date o riferimenti alle fatture 2026.
---

# Wiki fatture 2026

Leggi prima `index.md`, poi i `doc/*.md` indicati. Le immagini stanno in
`doc/assets/`, gli originali in `raw/`. Cita sempre pagina e file.
Stati: draft (bozza), reviewed (verificato), versioned (stabile).
```

- Tenere anche `AGENTS.md` (compat Annota) per agenti non-pi; la
  SKILL.md è quella che pi indicizza.

## MCP (anteprima per ticket dedicato)

Rispecchia il pattern Annota con tool nostri (dettagli negli schemi
del ticket MCP): `wiki.search/list/get` (read), `ocr.convert`
(convert), `wiki.add` (write), `wiki.export` (zip), più update stato
review. Stdio on-demand (Q3). Niente cloud.

## Aperto per i ticket a valle
- Frontmatter `index.md`/`meta.json` exact e naming asset stabili
  (li fissa il prototipo anteprima con esempi reali).
- Merge/conflitti import-export (li fissa la spec Wiki-manager).
- Quando scatta Mask/Restore j-pii sul testo OCR prima dell'invio LLM
  (li fissa la spec hook; il testo wiki su disco resta in chiaro,
  il mask vale per il canale LLM).
