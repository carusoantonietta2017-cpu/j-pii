# Fonti corpus

Niente dati cliente. I PDF arXiv si scaricano a tempo di eval
(`fetch.py`), non si ridistribuiscono: controllare la licenza
sulla rispettiva pagina `abs/` prima dell'uso.

| # | file | fonte URL (pinnata vN) | licenza | classe | pagine | tabelle? |
|---|------|------------------------|---------|--------|--------|----------|
| 1 | `docling.pdf` | https://arxiv.org/pdf/2408.09869v5 — [abs](https://arxiv.org/abs/2408.09869v5) Docling Technical Report | arXiv open access (verificare su abs; codice Docling MIT) | pdf-nativo | prime 3 | sì, layout+tabelle |
| 2 | `mineru.pdf` | https://arxiv.org/pdf/2409.18839v1 — [abs](https://arxiv.org/abs/2409.18839v1) MinerU Technical Report | arXiv open access (verificare su abs) | pdf-nativo | prime 3 | sì, estrazione contenuti |
| 3 | `olmocr.pdf` | https://arxiv.org/pdf/2502.18443v3 — [abs](https://arxiv.org/abs/2502.18443v3) olmOCR | arXiv open access (verificare su abs; codice Apache-2.0) | pdf-nativo | prime 3 | sì, tabelle+formule |
| 4 | `olmocr2.pdf` | https://arxiv.org/pdf/2510.19817v1 — [abs](https://arxiv.org/abs/2510.19817v1) olmOCR 2 | arXiv open access (verificare su abs; rilasci permissivi dichiarati) | pdf-nativo | prime 3 | sì, focus table parsing |
| 5 | `synthetic_it/fattura_001.*` | generato da `make_synthetic.py` | CC0, PII fittizie | pdf-nativo IT | 1 | sì, fattura semplice |
| 6 | `synthetic_it/orario_001.*` | generato da `make_synthetic.py` | CC0, nomi fittizi | pdf-nativo IT | 1 | sì, orario con merge |

Derivati (generati, non committati): `derived/straight/<pdf>_p<N>.png`
a 200 DPI + `derived/warped/<pdf>_p<N>.png` (prospettiva seed 7,
magnitudo 0.08, blur raggio 0.6). Coppie paired per misura degrado.

Totale: 12 pagine native EN + 2 sintetiche IT + 12 coppie straight/warped
= copertura Q2 `pdf-nativo / scansione-dritta / foto-storta-tabella`.
Il research modelli può restringere alle sole pagine tabellari e deve
dichiarare quali ha usato.
