"""Test funzioni tool MCP (senza SDK/trasporto). Solo stdlib."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import (  # noqa: E402
    tool_ocr_convert,
    tool_wiki_add,
    tool_wiki_export,
    tool_wiki_get,
    tool_wiki_import,
    tool_wiki_list,
    tool_wiki_remove,
    tool_wiki_review,
    tool_wiki_search,
)
from wiki import ConvertedDoc, write_wiki  # noqa: E402


def seed(root: Path, slug="s") -> None:
    write_wiki([ConvertedDoc(name="Fattura", markdown="# F\n\niva 22%\n",
                             engine="fake", pages=1)], slug, root=root)


class ToolsTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = str(Path(self.tmp.name))
        seed(Path(self.root))

    def tearDown(self):
        self.tmp.cleanup()

    def test_list_search_get(self):
        self.assertEqual(tool_wiki_list(self.root)["wikis"], [{"slug": "s", "voci": 1}])
        hits = tool_wiki_search("iva", root=self.root)["hits"]
        self.assertEqual(len(hits), 1)
        got = tool_wiki_get("s", "Fattura", self.root)
        self.assertIn("iva", got["markdown"])

    def test_add_review_chain(self):
        e = tool_wiki_add("s", markdown="# N\nnuova\n", title="Nota", root=self.root)
        self.assertEqual(e["review"], "draft")
        r = tool_wiki_review("s", "Nota", "reviewed", self.root)
        self.assertEqual(r["review"], "reviewed")

    def test_add_richiede_contenuto(self):
        with self.assertRaises(ValueError):
            tool_wiki_add("s", root=self.root)

    def test_confinement_fuori_root(self):
        with self.assertRaises(ValueError):
            tool_wiki_get("s", "../../etc", self.root)
        with self.assertRaises(ValueError):
            tool_wiki_import("/tmp/assente-xyz.zip", root=self.root)

    def test_remove_voce_e_wiki_confirm(self):
        self.assertTrue(tool_wiki_remove("s", "Fattura", root=self.root)["trash"])
        with self.assertRaises(PermissionError):
            tool_wiki_remove("s", root=self.root)
        self.assertIn("wiki:s", tool_wiki_remove("s", confirm=True, root=self.root)["removed"])

    def test_export_import_roundtrip(self):
        z = tool_wiki_export("s", root=self.root)["zip"]
        self.assertTrue(Path(z).exists())
        with tempfile.TemporaryDirectory() as d2:
            r = tool_wiki_import(z, root=d2)
            self.assertEqual(r["imported"], 1)

    def test_ocr_convert_fake(self):
        pdf = Path(self.tmp.name) / "a.pdf"
        pdf.write_bytes(b"%PDF")
        r = tool_ocr_convert(str(pdf), engine="fake", root=self.root)
        self.assertEqual(r["review_state"], "draft")
        self.assertIn("prima", r["note"])
        self.assertIn("|", r["markdown"])

    def test_ocr_convert_file_mancante(self):
        with self.assertRaises(ValueError):
            tool_ocr_convert(str(Path(self.tmp.name) / "no.pdf"), engine="fake", root=self.root)


if __name__ == "__main__":
    unittest.main()
