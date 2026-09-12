# ocr-pi core

Converter locale immagine/PDF → Markdown + Wiki LLM + MCP (spec #22, build b1–b7).
Engine default **Docling**; `FakeConverter` deterministico per test/CI.

## Install (una tantum)

```bash
python3 -m venv ocr-pi/.venv
ocr-pi/.venv/bin/pip install docling pillow opencv-python-headless mcp
```

Pesi/modelli (~GB) si scaricano al primo uso (mai nel repo).
Test senza modelli: `python3` di sistema basta (solo stdlib).

## Uso

```bash
# test (36, solo stdlib)
python3 -m unittest discover -s ocr-pi/tests -t .

# benchmark corpus (fake deterministico / docling reale)
python3 bench/run.py --engine fake
ocr-pi/.venv/bin/python bench/run.py --engine docling

# wiki-manager CLI
python3 ocr-pi/cli.py --root . list
python3 ocr-pi/cli.py --root . create fatture
python3 ocr-pi/cli.py --root . add fatture doc.md --titolo Voce
python3 ocr-pi/cli.py --root . search iva --stato draft
python3 ocr-pi/cli.py --root . review fatture Voce reviewed
python3 ocr-pi/cli.py --root . export fatture [--senza-raw]
python3 ocr-pi/cli.py --root . import fatture.zip [--merge]
python3 ocr-pi/cli.py --root . remove fatture Voce        # -> trash/
python3 ocr-pi/cli.py --root . remove fatture --confirm   # wiki intera

# anteprima reale (conversione vera + review collegata)
python3 ocr-pi/preview.py --pdf scan.pdf --engine docling --wiki-root . --slug demo --out prev-out
python3 ocr-pi/preview.py --pdf scan.pdf --engine docling --serve 8000  # + POST /api/review

# MCP server stdio (9 tool)
ocr-pi/.venv/bin/python ocr-pi/server.py --root .
ocr-pi/.venv/bin/python ocr-pi/server.py --root . --selftest  # lista tool
```

## MCP in pi

```json
{ "mcpServers": { "ocr-pi": {
  "command": "<repo>/ocr-pi/.venv/bin/python",
  "args": ["<repo>/ocr-pi/server.py", "--root", "<wiki-root>"] } } }
```

## Moduli

`converter.py` (b1) · `wiki.py` (b3: layout + SKILL + zip) · `manager.py` + `cli.py` (b4)
· `server.py` (b5: 9 tool) · `preview.py` (b7) · deskew e hook pi: ticket [b2]/[b6] aperti.
