"""Test core converter (fake: veloci, deterministici). Solo stdlib."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from converter import (  # noqa: E402
    ConvertResult,
    DoclingConverter,
    FakeConverter,
    convert,
)


class FakeConvertTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.pdf = self.root / "fattura_001.pdf"
        self.pdf.write_bytes(b"%PDF-1.4 fake")

    def tearDown(self):
        self.tmp.cleanup()

    def test_md_con_tabella_e_image_ref(self):
        r = convert(self.pdf, engine="fake", workdir=self.root)
        self.assertIsInstance(r, ConvertResult)
        self.assertIn("| Riga |", r.markdown)
        self.assertIn("![fig", r.markdown)
        self.assertIn("assets/", r.markdown)
        self.assertEqual(r.pages, 1)
        self.assertEqual(r.engine, "fake")
        self.assertGreaterEqual(r.seconds, 0.0)

    def test_assets_scritti_su_disco(self):
        r = convert(self.pdf, engine="fake", workdir=self.root)
        self.assertEqual(len(r.assets), 1)
        self.assertTrue(r.assets[0].exists())

    def test_file_mancante(self):
        with self.assertRaises(FileNotFoundError):
            convert(self.root / "assente.pdf", engine="fake", workdir=self.root)

    def test_formato_non_supportato(self):
        txt = self.root / "nota.txt"
        txt.write_text("ciao")
        with self.assertRaises(ValueError):
            convert(txt, engine="fake", workdir=self.root)

    def test_engine_sconosciuto(self):
        with self.assertRaises(ValueError):
            convert(self.pdf, engine="mistral", workdir=self.root)

    def test_pagine_1_based(self):
        with self.assertRaises(ValueError):
            convert(self.pdf, pages=[0], engine="fake", workdir=self.root)


class ContractTest(unittest.TestCase):
    """Pinna la forma output: (markdown: str, assets: list[Path], n_pages: int)."""

    def test_fake_rispetta_contratto(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            pdf = root / "x.pdf"
            pdf.write_bytes(b"%PDF")
            md, assets, n = FakeConverter().convert_pdf(pdf, [1, 2], root)
            self.assertIsInstance(md, str)
            self.assertTrue(all(isinstance(a, Path) for a in assets))
            self.assertEqual(n, 2)

    def test_docling_senza_dipendenza_spiega(self):
        try:
            import docling  # noqa: F401
        except ImportError:
            with self.assertRaises(RuntimeError):
                DoclingConverter()


if __name__ == "__main__":
    unittest.main()
