#!/usr/bin/env python3
"""Rende straight/ + warped/ dai PDF native. Richiede pymupdf + Pillow.

  pip install pymupdf pillow
  python3 bench/corpus/make_derived.py

- straight: pagina intera a 200 DPI (simula scansione dritta).
- warped: stessa PNG + prospettiva deterministica (seed 7, magnitudo 0.08)
  + blur raggio 0.6 (simula foto storta). Coppia paired con la straight.

Pagine da manifest.json (default prime 3 per PDF). Se mancano le dipendenze,
esce con messaggio chiaro: il corpus resta usabile sui soli PDF native.
"""
import json
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MANIFEST = HERE / "manifest.json"
NATIVE = HERE / "native"
DERIVED = HERE / "derived"
DPI = 200
SEED = 7
MAGNITUDE = 0.08
BLUR_RADIUS = 0.6

try:
    import fitz  # pymupdf
except ImportError:
    print("manca pymupdf: pip install pymupdf pillow", file=sys.stderr)
    raise SystemExit(2)
try:
    from PIL import Image, ImageFilter
except ImportError:
    print("manca pillow: pip install pymupdf pillow", file=sys.stderr)
    raise SystemExit(2)


def warp(img: Image.Image, rng: random.Random, magnitude: float) -> Image.Image:
    w, h = img.size
    dx = magnitude * w
    dy = magnitude * h
    # sposta i 4 angoli di un delta casuale limitato, deterministico via seed
    corners = [(0, 0), (w, 0), (w, h), (0, h)]
    moved = [
        (x + rng.uniform(-dx, dx), y + rng.uniform(-dy, dy)) for x, y in corners
    ]
    coeffs = Image.PERSPECTIVE if hasattr(Image, "PERSPECTIVE") else None
    # Pillow: transform(size, PERSPECTIVE, coeffs-inversi); usiamo find_coeffs
    return img.transform((w, h), Image.PERSPECTIVE, _find_coeffs(moved, corners))


def _find_coeffs(dst, src):
    # Adattato da esempio pubblico Pillow (domain pubblico): risolve i
    # coefficienti di prospettiva dst->src con eliminazione gaussiana.
    m = []
    for (x1, y1), (x2, y2) in zip(dst, src):
        m.append([x1, y1, 1, 0, 0, 0, -x2 * x1, -x2 * y1])
        m.append([0, 0, 0, x1, y1, 1, -y2 * x1, -y2 * y1])
    b = []
    for x2, y2 in src:
        b += [x2, y2]
    # risoluzione 8x8
    n = 8
    a = [row[:] + [b[i]] for i, row in enumerate(m)]
    for i in range(n):
        piv = a[i][i] or 1e-12
        a[i] = [v / piv for v in a[i]]
        for j in range(n):
            if j != i:
                f = a[j][i]
                a[j] = [x - f * y for x, y in zip(a[j], a[i])]
    return [a[i][n] for i in range(n)]


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    straight = DERIVED / "straight"
    warped = DERIVED / "warped"
    straight.mkdir(parents=True, exist_ok=True)
    warped.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)
    count = 0
    for entry in manifest["files"]:
        pdf = NATIVE / entry["filename"]
        if not pdf.exists():
            print(f"salto {pdf.name}: scaricalo con fetch.py")
            continue
        doc = fitz.open(pdf)
        for pno in entry.get("pages", [1, 2, 3]):
            page = doc[pno - 1]
            pix = page.get_pixmap(dpi=DPI)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            s_path = straight / f"{pdf.stem}_p{pno}.png"
            img.save(s_path)
            w = warp(img, rng, MAGNITUDE).filter(ImageFilter.GaussianBlur(BLUR_RADIUS))
            w_path = warped / f"{pdf.stem}_p{pno}.png"
            w.save(w_path)
            count += 1
            print(f"{pdf.name} p{pno}: {s_path.name} + {w_path.name}")
    print(f"derivate {count} coppie (seed={SEED}, mag={MAGNITUDE}, dpi={DPI})")


if __name__ == "__main__":
    main()
