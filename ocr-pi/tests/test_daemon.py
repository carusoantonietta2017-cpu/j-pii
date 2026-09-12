"""Test demone + client (fake: niente modelli). Solo stdlib."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import daemon_client as dc  # noqa: E402


class DaemonTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.pdf = Path(cls.tmp.name) / "a.pdf"
        cls.pdf.write_bytes(b"%PDF")

    @classmethod
    def tearDownClass(cls):
        dc.stop()
        cls.tmp.cleanup()

    def test_01_ping_e_convert_fake(self):
        self.assertIn("engines", dc.ping())
        r = dc.request(self.pdf, engine="fake", workdir=self.tmp.name)
        self.assertIn("|", r["markdown"])
        self.assertEqual(r["engine"], "fake")

    def test_02_engine_riusato_seconda_veloce(self):
        r1 = dc.request(self.pdf, engine="fake", workdir=self.tmp.name)
        r2 = dc.request(self.pdf, engine="fake", workdir=self.tmp.name)
        self.assertEqual(r1["markdown"], r2["markdown"])

    def test_03_errori_viaggiano_nel_protocollo(self):
        with self.assertRaises(RuntimeError):
            dc.request(Path(self.tmp.name) / "assente.pdf", engine="fake",
                       workdir=self.tmp.name)
        with self.assertRaises(RuntimeError):
            dc.request(self.pdf, engine="inesistente", workdir=self.tmp.name)


if __name__ == "__main__":
    unittest.main()
