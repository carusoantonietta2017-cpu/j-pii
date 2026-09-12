"""Test anteprima reale (generazione html + API review). Solo stdlib."""
import http.client
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from converter import convert  # noqa: E402
from preview import build_preview, md_table_to_html  # noqa: E402
from wiki import ConvertedDoc, write_wiki  # noqa: E402


class TableHtmlTest(unittest.TestCase):
    def test_tabella_md_diventa_html(self):
        h = md_table_to_html("| A | B |\n|---|---|\n| 1 | 2 |\n")
        self.assertIn("<th>A</th>", h)
        self.assertIn("<td>2</td>", h)

    def test_senza_tabella_stringa_vuota(self):
        self.assertEqual(md_table_to_html("# solo testo\n"), "")


class BuildPreviewTest(unittest.TestCase):
    def test_html_con_dati_reali_e_badge(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            pdf = root / "in.pdf"
            pdf.write_bytes(b"%PDF")
            r = convert(pdf, engine="fake", workdir=root)
            out = build_preview(r, pdf, root / "prev", str(root), "s", "in")
            page = out.read_text(encoding="utf-8")
            self.assertIn("Consulenza privacy GDPR", page)  # cella vera
            self.assertIn("modello: fake", page)
            self.assertIn("s/pagina (reali)", page)
            self.assertIn("/api/review", page)

    def test_review_api_cambia_stato(self):
        import preview as pv
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            pdf = root / "in.pdf"
            pdf.write_bytes(b"%PDF")
            r = convert(pdf, engine="fake", workdir=root)
            doc = ConvertedDoc(name="in", markdown=r.markdown, assets=r.assets, engine=r.engine)
            wiki = write_wiki([doc], "s", root=root)
            out_dir = root / "prev"
            out_dir.mkdir()
            from http.server import ThreadingHTTPServer
            httpd = ThreadingHTTPServer(("127.0.0.1", 0), pv.make_handler(str(root), out_dir))
            port = httpd.server_address[1]
            t = threading.Thread(target=httpd.serve_forever, daemon=True)
            t.start()
            try:
                c = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
                body = json.dumps({"wiki": wiki.name, "voce": "in", "stato": "reviewed"})
                c.request("POST", "/api/review", body, {"Content-Type": "application/json"})
                resp = c.getresponse()
                self.assertEqual(resp.status, 200)
                self.assertEqual(json.loads(resp.read())["review"], "reviewed")
                c.request("POST", "/api/review", json.dumps({"wiki": "s", "voce": "in", "stato": "bozza"}),
                          {"Content-Type": "application/json"})
                self.assertEqual(c.getresponse().status, 400)
            finally:
                httpd.shutdown()


if __name__ == "__main__":
    unittest.main()
