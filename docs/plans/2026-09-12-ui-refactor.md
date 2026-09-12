# Piano di lavoro — refactor app web ocr-pi (UI)

Data: 2026-09-12. Obiettivo: grafica moderna + tutte le funzionalità esposte + verifica Playwright in locale.
Linee guida grafiche: `web-design-guidelines` (Vercel, fetch 2026-09-12). Dominio: `CONTEXT.md` (placeholder/mapping/mask/restore/doubtful span).

## 1. Audit funzionalità (CLI → API → UI)

| CLI | API | UI prima | Azione |
|---|---|---|---|
| `create` | `POST /api/wiki` | menu ⋯ → prompt | dialog dedicato + validazione |
| `list` | `GET /api/wikis` | sidebar | card con conteggi, stati |
| `search [--stato] [--wiki]` | `GET /api/wiki/:slug/search` (solo per-wiki) | solo filtro locale | NUOVO `GET /api/search` globale + pannello risultati con filtri stato/wiki |
| `show` | `GET /api/wiki/:slug` + `/file?path=` | select voce | + metadati voce (pagine, engine, secondi), link raw, SKILL/index |
| `add` | `POST /api/wiki/:slug/add` | solo da conversione | + “Nuova voce” (editor markdown) + upload md |
| `review {draft,reviewed,versioned}` | `POST …/review` | solo Approva/Rimanda | segmented a 3 stati |
| `remove [voce]` / `--confirm` | `POST …/remove` | assente | “Sposta nel cestino” + conferma `<dialog>`; “Elimina wiki…” con digitazione conferma |
| `trash` | (via dettaglio, lista nomi) | solo conteggio | NUOVO `GET /api/wiki/:slug/trash` + vista Cestino con anteprima |
| `export [--senza-raw]` | `GET …/export.zip` | menu | mantieni + descrizione chiara slim/completo |
| `import [--merge]` | `POST /api/wiki/import` | senza merge | dialog con checkbox merge + report importate/saltate |
| `rename` | `POST …/rename` | prompt | dialog con slug preview |
| sources `GET/POST/DELETE /api/sources` | ok | add via prompt, delete assente | lista con rimuovi + conversione da file server |
| convert `POST /api/convert` + `/convert-upload` (engine/pages/deskew) | ok | engine+deskew, senza pages | + campo pagine, engine coerente ovunque |
| dock `POST /api/chat` + `/api/chat/new` (ocr/sensitive/engine) | ok | ocr+sensibili, 1 immagine, senza new/engine | + Nuova conversazione, engine+deskew, multi-immagine, badge modello (`GET /api/config`) |
| mask preview | — (regex locale) | “Mostra Mask” | mantieni ma etichetta “Anteprima mask locale” + tooltip |

Backend da aggiungere: `GET /api/search`, `GET /api/wiki/:slug/trash`, `GET /api/config`, MIME `.css`.

## 2. Design (web-design-guidelines)

- Design tokens light/dark (`data-theme`, `color-scheme`, `theme-color`), font system, `tabular-nums`, `text-wrap: balance`.
- Layout: topbar (brand, ricerca globale, tema, Converti, Nuova wiki) + sidebar 300px + main split + dock bottom-sheet (desktop) / collapsible (mobile). Breakpoint 960px/640px.
- Componenti: button primary/ghost/danger, input/select, badge/pill, card, tabs, segmented, dialog, toast `aria-live`, skeleton, empty-state, table responsive.
- A11y: skip-link, h1–h3 gerarchici, `aria-label` su icon-only, `<label>` ovunque, `aria-pressed/expanded`, `focus-visible` ring, `prefers-reduced-motion`, `touch-action: manipulation`, `overscroll-behavior: contain`, `safe-area`.
- Copy IT, seconda persona, Title Case, `…` per loading, errori con fix (“Scegli… poi riprova”), `translate="no"` su placeholder/mapping/mask/restore e codici tipo `[CF_1]`.

## 3. Implementazione

1. `ui/server.mjs`: MIME css/md, `/api/search`, `/api/wiki/:slug/trash`, `/api/config`.
2. `ui/static/styles.css`: NUOVO (estrai da inline, tokens + dark + responsive).
3. `ui/static/index.html`: rewrite semantico, conserva id test (`dockform` etc.), aggiungi dialog/toast/search/trash/config.
4. `ui/static/app.js`: rewrite: router hash (`#/w/slug/v/file`, `?q=`), search globale, CRUD completo, convert 3 vie, dock multi-img + new, tema, toasts, modali.
5. `ui/server.test.mjs` + `dock.test.mjs`: estendi (search globale, trash, config, css).
6. `scripts/verify-ui.mjs` (Playwright, chromium locale): avvio server effimero, seed wiki, click-through di ogni feature, screenshot `…/shots/`.

## 4. Ciclo di verifica

- `cd ui && npm test` (node --test) → zero fail.
- `node scripts/verify-ui.mjs` → tutti i passi PASS + screenshot.
- `npx tsc --noEmit` in extension (regressione), `python3 -m unittest` ocr-pi (se veloce).
- Review guidelines: ogni file UI contro regole (a11y/focus/form/motion/type/content/img/nav/touch/safe/dark/hover/copy/anti-pattern).

## 5. Criteri di done

- Tutte le righe tabella esposte in UI e cliccabili da Playwright.
- Nessun `prompt()` nativo rimasto; distruttive con conferma.
- Light/dark, mobile 390px, tastiera sola: navigabile.
- Test verdi + report Playwright allegato.

## 6. Follow-up 2026-09-12 — anteprima originali da sorgente

Segnalazione: convertendo un file dalla sidebar, il riquadro “Originale”
mostrava solo il percorso, senza immagine (lo screenshot utente lo conferma).
Causa: `convertServerFile` non aveva i byte del file (percorso solo lato
server) e `/api/convert` non restituiva gli asset inline.
Fix: nuovo `GET /api/file?path=` confinato a wikiRoot + sorgenti registrate
(403 fuori, 404 se assente), `/api/convert` con asset inline come
`/api/convert-upload`, anteprima `<img>` per immagini e `<object>` per PDF
in entrambi i flussi. Test: `api/file` in `server.test.mjs` (19 test),
passo Playwright “anteprima originale da sorgente (img + pdf)” (13 passi).

## 7. Follow-up 2026-09-12 — raw cliccabili + dock muto

1. Click su un originale (`raw/`) non faceva nulla (voci non interattive) e
   il click da sorgente sembrava morto (conversione lenta senza feedback).
   Fix: raw cliccabili → immagine a sinistra e voce collegata a destra
   (match per slug, altrimenti card “Converti ora” via nuovo
   `POST /api/wiki/:slug/convert-raw`); anteprima immediata + skeleton +
   card d'errore con Riprova per le conversioni da sorgente; guardia
   anti-doppio-`select` su `hashchange` (`nav()` + `lastHash`).
2. Il dock restava muto: di default j-pii usa l'analyzer reale ma
   `JPII_PYTHON=python3` (relativo) non risolve mai → sidecar KO → hook
   fail-closed → run vuoto → solo `done`, zero feedback. Fix: `JPII_PYTHON`
   di default a `.venv/bin/python` se esiste; se la run non emette nulla,
   il backend spiega in chat come sbloccarla (`JPII_ANALYZER=fake`);
   fallback anche nel frontend. Test: `convert-raw` in `server.test.mjs`
   (20 test), passi Playwright raw collegato/orfano + dock con risposta
   vera (15 passi, `JPII_ANALYZER=fake` nel seed).

## 8. Follow-up 2026-09-12 — dock che si incastra

Segnalazione: dopo un messaggio rimasto appeso, ogni invio rispondeva
`errore: Agent is already processing a prompt`. Causa: `sessionPromise`
singleton in `dock.mjs` — un prompt mai risolto blocca tutti i successivi.
Fix: timeout `UI_CHAT_TIMEOUT_MS` (default 3 min) con azzeramento, retry
automatico una volta su “already processing” (log `[dock]` nel terminale),
cache sessione mai avvelenata (si azzera da sola in caso d'errore), errori
sempre nel log del server. Verificato qui: due chat sovrapposte via curl —
la seconda ha loggato `sessione incastrata, riprovo da zero` e risposto
completa (tool + testo + done). Test: chat con modello inesistente
(21 test backend), suite Playwright 15/15.

## 10. Follow-up 2026-09-12 — blocco j-pii opaco nel dock

Segnalazione: `crea un md ... Screenshot 2026-09-12 214936 ...` → chat
muta col vecchio messaggio generico sul sidecar. Causa vera (dal log):
review doubtful senza UI nel dock (`DATE`, `ZIPCODE` nel nome file) →
“review dismissed”, fail-closed. Fix: il server intercetta le righe
`[j-pii]` durante il prompt e la chat riporta il motivo esatto + via
d'uscita (`JPII_EXCLUDE_TAGS=...` o riformulazione); verificato con
analyzer reale sul messaggio dell'utente (28 s, sidecar incluso) e passo
Playwright dedicato (25/25 totali).

## 9. Follow-up 2026-09-12 — revisione operativa completa

Richiesta: zero giri a vuoto per l'utente, tutto rivisto via
Playwright. Audit riga per riga di `app.js` + suite estesa a 24 passi:
rinomina, validazione voce vuota, sorgente invalida, export + import merge,
OCR da allegato nel dock, guard sensibili via UI, rimozione sorgente via
dialog, rimozione wiki (conferma errata + giusta), persistenza tema,
`Ctrl+K`, radice vuota (prima wiki + voce), deep-link raw al reload,
controllo stretto rete (zero API fallite oltre il 400 atteso) e JS.
Fix: ultimo `confirm()` nativo → dialog; testo cestina-voce riscritto;
`importDialog` gestisce annullo file-picker; anteprima immediata anche da
upload con Riprova; `bsave2` con try/catch; guard asset senza `dataBase64`;
menu wiki consapevole della scheda vista (`state.card`); skeleton/errori
mai appesi in `select`/`selectRaw`; hint opzioni corretto + sync motore
dock; guardia anti-doppio-`select`; fumetti dock accorpati per risposta e
ripuliti dai `**`; guardia server su messaggi vuoti. Verdetto: backend
21/21, extension 43/43, Playwright 24/24, zero errori.
