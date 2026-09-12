#!/usr/bin/env python3
"""Genera tabelle italiane sintetiche CC0 con ground-truth noto. Solo stdlib.

Crea in synthetic_it/:
  fattura_001.csv / .md / .pdf   fattura semplice, PII fittizie
  orario_001.csv / .md / .pdf    orario settimanale con cella unita (nota nel md)
Il PDF e' minimale (Helvetica, testo + righe) quel tanto che basta per l'OCR;
il ground-truth per TEDS/exact-match e' il CSV.

Uso: python3 bench/corpus/make_synthetic.py [--out DIR]
"""
import argparse
import csv
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_OUT = HERE / "synthetic_it"

FATTURA_ROWS = [
    ["Riga", "Descrizione", "Qta", "Prezzo EUR"],
    ["1", "Consulenza privacy GDPR", "2", "180.00"],
    ["2", "Redazione informativa", "1", "120.00"],
    ["3", "Rimborso spese", "1", "25.50"],
]

ORARIO_ROWS = [
    ["Giorno", "08-10", "10-12", "14-16"],
    ["Lun", "Sportello", "Sportello", "Archivio"],
    ["Mar", "Udienze", "Udienze", "Udienze"],
    ["Mer", "Studio", "Studio", "Ricevimento"],
]

FAKE_HEADER = "Fattura dimostrativa 001 - Dati fittizi, nessun dato reale"


def write_csv(path: Path, rows: list) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows(rows)


def write_md(path: Path, title: str, rows: list, note: str = "") -> None:
    lines = [f"# {title}", ""]
    lines.append("| " + " | ".join(rows[0]) + " |")
    lines.append("| " + " | ".join("---" for _ in rows[0]) + " |")
    for r in rows[1:]:
        lines.append("| " + " | ".join(r) + " |")
    if note:
        lines += ["", note]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _pdf_escape(s: str) -> str:
    return s.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def write_simple_pdf(path: Path, title: str, header: str, rows: list) -> None:
    """PDF 1 pagina, Helvetica 10pt, tabella a righe. Coordinate in punti."""
    content = ["BT /F1 13 Tf 50 800 Td (%s) Tj ET" % _pdf_escape(title)]
    content.append("BT /F1 9 Tf 50 782 Td (%s) Tj ET" % _pdf_escape(header))
    x0, y0, col_w, row_h = 50, 750, 120, 18
    ncols = len(rows[0])
    # righe orizzontali + verticali
    lines = []
    for i in range(len(rows) + 1):
        y = y0 - i * row_h
        lines.append(f"{x0} {y} m {x0 + ncols * col_w} {y} l S")
    for j in range(ncols + 1):
        x = x0 + j * col_w
        lines.append(f"{x} {y0} m {x} {y0 - len(rows) * row_h} l S")
    texts = []
    for i, row in enumerate(rows):
        for j, cell in enumerate(row):
            x = x0 + j * col_w + 4
            y = y0 - i * row_h - 13
            texts.append(
                "BT /F1 10 Tf %d %d Td (%s) Tj ET" % (x, y, _pdf_escape(cell))
            )
    stream = "\n".join(content + lines + texts)
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Length %d >>\nstream\n%s\nendstream" % (len(stream.encode("latin-1", "replace")), stream),
    ]
    out = ["%PDF-1.4"]
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(sum(len(l.encode("latin-1", "replace")) + 1 for l in out))
        out += [f"{i} 0 obj", body, "endobj"]
    xref_at = sum(len(l.encode("latin-1", "replace")) + 1 for l in out)
    out += [f"xref", f"0 {len(objs) + 1}", "0000000000 65535 f "]
    out += [f"{o:010d} 00000 n " for o in offsets]
    out += [
        f"trailer << /Size {len(objs) + 1} /Root 1 0 R >>",
        "startxref",
        str(xref_at),
        "%%EOF",
    ]
    # latin-1 con replace: gli accenti diventano ? nel PDF ma restano giusti in CSV/MD
    path.write_bytes("\n".join(out).encode("latin-1", "replace"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    write_csv(out / "fattura_001.csv", FATTURA_ROWS)
    write_md(
        out / "fattura_001.md",
        "Fattura 001 (sintetica)",
        FATTURA_ROWS,
        "Cliente fittizio: Mario Rossi — CF RSSMRA00A01H501U — "
        "mario.rossi@example.invalid. Nessun dato reale.",
    )
    write_simple_pdf(out / "fattura_001.pdf", "Fattura 001 (sintetica)", FAKE_HEADER, FATTURA_ROWS)
    write_csv(out / "orario_001.csv", ORARIO_ROWS)
    write_md(
        out / "orario_001.md",
        "Orario settimanale 001 (sintetico)",
        ORARIO_ROWS,
        "Nota: il Mar 10-16 e' un blocco unico nel layout reale "
        "(cella unita); il CSV lo espande in 2 celle uguali.",
    )
    write_simple_pdf(
        out / "orario_001.pdf", "Orario 001 (sintetico)", "Settimana dimostrativa", ORARIO_ROWS
    )
    print(f"sintetici scritti in {out}: fattura_001.*, orario_001.*")


if __name__ == "__main__":
    main()
