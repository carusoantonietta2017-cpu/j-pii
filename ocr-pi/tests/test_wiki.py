"""Test wiki writer + export (snapshot struttura, niente binari). Solo stdlib."""
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from converter import convert  # noqa: E402
from wiki import (  # noqa: E402
    ConvertedDoc,
    check_skill_frontmatter,
    export_wiki,
    skill_name_for,
    slugify,
    write_wiki,
)


class SlugTest(unittest.TestCase):
    def test_slug_e_nome_skill_validi(self):
        self.assertEqual(slugify("Fatture 2026!"), "fatture-2026")
        self.assertRegex(skill_name_for("Fatture 2026!"), r"^wiki-fatture-2026$")

    def test_frontmatter_invalida_sollevata(self):
        with self.assertRaises(ValueError):
            check_skill_frontmatter("# senza frontmatter\n")
        with self.assertRaises(ValueError):
            check_skill_frontmatter("---\nname: x\n---\n")


class WriteWikiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        png = self.root / "x.png"
        png.write_bytes(b"\x89PNG\r\n\x1a\nFAKE")
        self.doc = ConvertedDoc(name="Fattura 001", markdown="# F\n\n![fig](old/x.png)\n| A |\n|---|",
                                assets=[png], engine="fake", seconds=0.2, pages=1,
                                source=self.root / "f.pdf")
        (self.root / "f.pdf").write_bytes(b"%PDF")

    def tearDown(self):
        self.tmp.cleanup()

    def test_struttura_e_stati(self):
        wiki = write_wiki([self.doc], "Demo 2026", root=self.root)
        for rel in ["SKILL.md", "README.md", "AGENTS.md", "index.md", "meta.json",
                    "doc/fattura-001.md", "doc/assets/x.png", "raw/f.pdf"]:
            self.assertTrue((wiki / rel).exists(), rel)
        index = (wiki / "index.md").read_text(encoding="utf-8")
        self.assertIn("draft", index)
        meta = json.loads((wiki / "meta.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["docs"][0]["review"], "draft")
        self.assertEqual(meta["slug"], "demo-2026")
        check_skill_frontmatter((wiki / "SKILL.md").read_text(encoding="utf-8"))

    def test_image_ref_riscritti_su_assets(self):
        wiki = write_wiki([self.doc], "demo", root=self.root)
        md = (wiki / "doc" / "fattura-001.md").read_text(encoding="utf-8")
        self.assertIn("](assets/x.png)", md)

    def test_vuota_crea_wiki_in_allestimento(self):
        wiki = write_wiki([], "demo", root=self.root)
        self.assertTrue((wiki / "SKILL.md").exists())
        check_skill_frontmatter((wiki / "SKILL.md").read_text(encoding="utf-8"))


class ExportTest(unittest.TestCase):
    def test_zip_con_e_senza_raw(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            png = root / "x.png"
            png.write_bytes(b"PNG")
            doc = ConvertedDoc(name="a", markdown="![f](assets/x.png)", assets=[png], engine="fake")
            wiki = write_wiki([doc], "s", root=root)
            (wiki / "raw" / "o.pdf").write_bytes(b"%PDF")
            full = export_wiki(wiki)
            names = zipfile.ZipFile(full).namelist()
            self.assertIn("s/doc/a.md", names)
            self.assertIn("s/doc/assets/x.png", names)
            self.assertIn("s/SKILL.md", names)
            self.assertIn("s/raw/o.pdf", names)
            self.assertFalse(str(full).startswith(str(wiki)))  # zip fuori dalla wiki
            slim = export_wiki(wiki, senza_raw=True)
            self.assertNotEqual(full, slim)  # mai sovrascrivere in silenzio
            names2 = zipfile.ZipFile(slim).namelist()
            self.assertNotIn("s/raw/o.pdf", names2)
            self.assertIn("s/doc/a.md", names2)


class EndToEndFakeTest(unittest.TestCase):
    def test_convert_write_export(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            pdf = root / "in.pdf"
            pdf.write_bytes(b"%PDF")
            r = convert(pdf, engine="fake", workdir=root)
            doc = ConvertedDoc(name="in", markdown=r.markdown, assets=r.assets,
                               engine=r.engine, seconds=r.seconds, pages=r.pages, source=pdf)
            wiki = write_wiki([doc], "e2e", root=root)
            z = export_wiki(wiki, senza_raw=True)
            self.assertTrue(z.exists())
            link = (wiki / "doc" / "in.md").read_text(encoding="utf-8")
            # ogni image ref deve risolvere a un file esistente
            import re
            for m in re.finditer(r"\((assets/[^)]+)\)", link):
                self.assertTrue((wiki / "doc" / m.group(1)).exists(), m.group(1))


if __name__ == "__main__":
    unittest.main()
