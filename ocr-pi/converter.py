"""Core converter: PDF/immagine -> Markdown + assets. Solo stdlib qui.

L'engine Docling e' importato lazy in DoclingConverter così test e fake
girano senza dipendenze. Forma output pinnata dal contract test.
"""
import csv
import time
from dataclasses import dataclass, field
from pathlib import Path

SUPPORTED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp"}


@dataclass
class ConvertResult:
    markdown: str
    assets: list = field(default_factory=list)  # Path alle immagini estratte
    pages: int = 0
    engine: str = ""
    seconds: float = 0.0
    deskew_applied: bool = False


class Engine:
    name = "base"

    def convert_pdf(self, pdf: Path, pages: list, workdir: Path) -> tuple:
        """Ritorna (markdown, assets: list[Path], n_pages)."""
        raise NotImplementedError


class FakeConverter(Engine):
    """Deterministico, per test/CI: se esiste un CSV omonimo lo rende
    come tabella md (ground-truth noto), altrimenti tabella fissa."""

    name = "fake"

    def convert_pdf(self, pdf: Path, pages: list, workdir: Path) -> tuple:
        asset = workdir / "assets" / f"{pdf.stem}_p{pages[0]}.png"
        asset.parent.mkdir(parents=True, exist_ok=True)
        asset.write_bytes(b"\x89PNG\r\n\x1a\nFAKE")
        csv_path = pdf.with_suffix(".csv")
        if csv_path.exists():
            with csv_path.open(encoding="utf-8") as f:
                rows = [r for r in csv.reader(f) if r]
        else:
            rows = [
                ["Riga", "Descrizione", "Qta", "Prezzo EUR"],
                ["1", "Consulenza privacy GDPR", "2", "180.00"],
            ]
        table = ["| " + " | ".join(rows[0]) + " |",
                 "| " + " | ".join("---" for _ in rows[0]) + " |"]
        table += ["| " + " | ".join(r) + " |" for r in rows[1:]]
        md = f"# {pdf.stem}\n\n![fig {pages[0]}](assets/{asset.name})\n\n" + "\n".join(table) + "\n"
        return md, [asset], len(pages)


class DoclingConverter(Engine):
    """Engine reale (Docling). Richiede `pip install docling`."""

    name = "docling"

    def __init__(self) -> None:
        try:
            from docling.document_converter import DocumentConverter
        except ImportError as e:
            raise RuntimeError(
                "Docling non installato: ocr-pi/.venv/bin/pip install docling"
            ) from e
        self._converter = DocumentConverter()

    def convert_pdf(self, pdf: Path, pages: list, workdir: Path) -> tuple:
        from docling_core.types.doc import ImageRefMode

        result = self._converter.convert(str(pdf))
        doc = result.document
        out_md = workdir / f"{pdf.stem}.md"
        try:
            doc.save_as_markdown(str(out_md), image_mode=ImageRefMode.REFERENCED)
            markdown = out_md.read_text(encoding="utf-8")
        except TypeError:
            # API senza image_mode: export semplice, niente assets
            markdown = doc.export_to_markdown()
            out_md.write_text(markdown, encoding="utf-8")
        assets_dir = out_md.parent / f"{pdf.stem}_artifacts"
        assets = sorted(p for p in assets_dir.rglob("*") if p.is_file()) if assets_dir.exists() else []
        return markdown, assets, len(pages)


ENGINES = {"fake": FakeConverter, "docling": DoclingConverter}


def convert(
    source,
    pages=None,
    engine="docling",
    workdir=".",
    engine_obj=None,
    deskew=False,
) -> ConvertResult:
    """Converte un PDF/immagine. `engine_obj` inietta un engine (test).
    deskew=True raddrizza le immagini prima dell'OCR (sui PDF non applicato:
    i motori gestiscono il layout, vedi ticket [b2])."""
    src = Path(source)
    if not src.exists():
        raise FileNotFoundError(f"sorgente assente: {src}")
    if src.suffix.lower() not in SUPPORTED_SUFFIXES:
        raise ValueError(f"formato non supportato: {src.suffix}")
    if engine_obj is None:
        try:
            factory = ENGINES[engine]
        except KeyError:
            raise ValueError(f"engine sconosciuto: {engine} (noti: {sorted(ENGINES)})") from None
        engine_obj = factory()
    wanted = list(pages) if pages else [1]
    if any(p < 1 for p in wanted):
        raise ValueError(f"pagine 1-based: {wanted}")
    workdir = Path(workdir)
    t0 = time.monotonic()
    deskew_applied = False
    if deskew and src.suffix.lower() != ".pdf":
        from deskew import deskew_file
        fixed = workdir / f"{src.stem}-deskewed{src.suffix}"
        workdir.mkdir(parents=True, exist_ok=True)
        deskew_file(src, fixed)
        src = fixed
        deskew_applied = True
    markdown, assets, n_pages = engine_obj.convert_pdf(src, wanted, workdir)
    return ConvertResult(
        markdown=markdown,
        assets=list(assets),
        pages=n_pages,
        engine=engine_obj.name,
        seconds=time.monotonic() - t0,
        deskew_applied=deskew_applied,
    )
