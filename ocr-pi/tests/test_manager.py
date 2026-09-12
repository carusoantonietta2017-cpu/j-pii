"""Test wiki-manager (fixture temporanee). Solo stdlib."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import manager  # noqa: E402
from wiki import ConvertedDoc, write_wiki, export_wiki  # noqa: E402


def seed(root: Path, slug="s") -> Path:
    png = root / "x.png"
    png.write_bytes(b"PNG")
    doc = ConvertedDoc(name="Fattura", markdown="# F\n\nriga iva 22%\n![f](assets/x.png)",
                       assets=[png], engine="fake", pages=1)
    return write_wiki([doc], slug, root=root)


class ManagerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        seed(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_list(self):
        self.assertEqual(manager.list_wikis(self.root), [{"slug": "s", "voci": 1}])

    def test_search_e_filtro_stato(self):
        self.assertEqual(len(manager.search(self.root, "iva")), 1)
        self.assertEqual(manager.search(self.root, "iva", stato="reviewed"), [])
        manager.review(self.root, "s", "Fattura", "reviewed")
        self.assertEqual(len(manager.search(self.root, "iva", stato="reviewed")), 1)

    def test_review_stato_invalido(self):
        with self.assertRaises(ValueError):
            manager.review(self.root, "s", "Fattura", "bozza")

    def test_add_crea_wiki_se_assente(self):
        md = self.root / "n.md"
        md.write_text("# N\n")
        e = manager.add(self.root, "nuova", md, title="Nota")
        self.assertEqual(e["review"], "draft")
        self.assertIn({"slug": "nuova", "voci": 1}, manager.list_wikis(self.root))

    def test_create_wiki_vuota(self):
        manager.create_wiki(self.root, "vuota")
        self.assertIn({"slug": "vuota", "voci": 0}, manager.list_wikis(self.root))

    def test_add_draft_e_duplicato(self):
        md = self.root / "n.md"
        md.write_text("# N\ntesto nuovo\n")
        e = manager.add(self.root, "s", md, title="Nota")
        self.assertEqual(e["review"], "draft")
        with self.assertRaises(ValueError):
            manager.add(self.root, "s", md, title="Nota")

    def test_rename_e_trash_list(self):
        manager.rename(self.root, 's', 'Nuova Wiki')
        self.assertEqual(manager.list_wikis(self.root), [{'slug': 'nuova-wiki', 'voci': 1}])
        with self.assertRaises(ValueError):
            manager.rename(self.root, 'nuova-wiki', 'nuova-wiki')
        manager.remove(self.root, 'nuova-wiki', 'Fattura')
        self.assertEqual(manager.trash_list(self.root, 'nuova-wiki'), ['fattura.md'])

    def test_remove_voce_in_trash(self):
        r = manager.remove(self.root, "s", "Fattura")
        self.assertTrue(r["trash"])
        self.assertTrue((self.root / "wiki" / "s" / "trash" / "fattura.md").exists())
        self.assertEqual(manager.list_wikis(self.root), [{"slug": "s", "voci": 0}])

    def test_remove_wiki_richiede_confirm(self):
        with self.assertRaises(PermissionError):
            manager.remove(self.root, "s")
        r = manager.remove(self.root, "s", confirm=True)
        self.assertIn("wiki:s", r["removed"])
        self.assertEqual(manager.list_wikis(self.root), [])

    def test_export_import_merge(self):
        z = manager.export(self.root, "s")
        import shutil
        r2 = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, r2, True)
        first = manager.import_wiki(r2, z)
        self.assertEqual(first["imported"], 1)
        with self.assertRaises(ValueError):
            manager.import_wiki(r2, z)
        again = manager.import_wiki(r2, z, merge=True)
        self.assertEqual(again["imported"], 0)
        self.assertEqual(again["skipped"], ["doc/fattura.md"])
        # nuova voce nel merge viene aggiunta
        md = r2 / "extra.md"
        md.write_text("# E\n")
        manager.add(r2, "s", md, title="Extra")
        z2 = manager.export(r2, "s")
        with tempfile.TemporaryDirectory() as d3:
            r3 = Path(d3)
            manager.import_wiki(r3, z)  # base: 1 voce
            m = manager.import_wiki(r3, z2, merge=True)  # +1 nuova, 1 skip
            self.assertEqual(m["imported"], 1)
            self.assertEqual(m["skipped"], ["doc/fattura.md"])


if __name__ == "__main__":
    unittest.main()
