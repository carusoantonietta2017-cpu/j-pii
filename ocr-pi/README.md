# ocr-pi core

Converter locale immagine/PDF → Markdown (ticket [b1], spec #22).
Engine default **Docling**; `FakeConverter` deterministico per test/CI.

```bash
ocr-pi/.venv/bin/pip install docling pillow opencv-python-headless  # una tantum (~GB)
ocr-pi/.venv/bin/python -m unittest discover -s ocr-pi/tests -t .  # test (solo stdlib)
ocr-pi/.venv/bin/python bench/run.py --engine fake                 # benchmark senza modelli
ocr-pi/.venv/bin/python bench/run.py --engine docling              # benchmark reale (CPU)
```

I pesi/modelli si scaricano a runtime (mai nel repo).
