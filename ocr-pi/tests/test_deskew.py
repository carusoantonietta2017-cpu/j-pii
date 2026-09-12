"""Test deskew (richiedono cv2+numpy: skip su python base). Deterministici."""
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import cv2  # noqa: F401
    import numpy  # noqa: F401
    from deskew import (  # noqa: E402
        angle_diff,
        deskew_file,
        deskew_image,
        estimate_skew_angle,
        rotate_for_test,
        warp_perspective,
    )
    HAVE_CV2 = True
except ImportError:
    HAVE_CV2 = False


def text_page():
    import numpy as np
    import cv2
    img = np.full((300, 500, 3), 255, np.uint8)
    for i, line in enumerate(["Fattura dimostrativa 001", "Riga | Qta | Prezzo",
                              "1 | 2 | 180.00", "2 | 1 | 120.00"]):
        cv2.putText(img, line, (30, 60 + i * 50), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
    return img


@unittest.skipUnless(HAVE_CV2, "serve opencv (ocr-pi/.venv)")
class DeskewTest(unittest.TestCase):
    def test_stima_angolo_noto(self):
        tilted = rotate_for_test(text_page(), 15.0)
        est = estimate_skew_angle(tilted)
        self.assertLess(angle_diff(est, 15.0), 2.0)

    def test_deskew_riporta_a_zero(self):
        tilted = rotate_for_test(text_page(), -12.0)
        fixed, applied = deskew_image(tilted)
        self.assertLess(angle_diff(applied, -12.0), 2.0)
        self.assertLess(abs(estimate_skew_angle(fixed)), 2.0)

    def test_pagina_dritta_quasi_zero(self):
        self.assertLess(abs(estimate_skew_angle(text_page())), 2.0)

    def test_warp_deterministico(self):
        import numpy as np
        img = text_page()
        a = warp_perspective(img)
        b = warp_perspective(img)
        self.assertTrue(np.array_equal(a, b))
        self.assertFalse(np.array_equal(a, img))

    def test_deskew_file(self):
        import cv2
        with tempfile.TemporaryDirectory() as d:
            src = Path(d) / "storta.png"
            cv2.imwrite(str(src), rotate_for_test(text_page(), 10.0))
            tilt = deskew_file(src, Path(d) / "dritta.png")
            self.assertLess(angle_diff(tilt, 10.0), 2.0)
            self.assertTrue((Path(d) / "dritta.png").exists())

    def test_convert_con_deskew_su_immagine(self):
        import cv2
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from converter import convert
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            src = root / "storta.png"
            cv2.imwrite(str(src), rotate_for_test(text_page(), 10.0))
            r = convert(src, engine="fake", workdir=root, deskew=True)
            self.assertTrue(r.deskew_applied)
            self.assertIn("|", r.markdown)

    def test_convert_senza_deskew_su_pdf(self):
        import sys
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from converter import convert
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            pdf = root / "x.pdf"
            pdf.write_bytes(b"%PDF")
            r = convert(pdf, engine="fake", workdir=root, deskew=True)
            self.assertFalse(r.deskew_applied)  # pdf: motori gestiscono il layout


@unittest.skipIf(HAVE_CV2, "solo senza opencv")
class NoCv2Test(unittest.TestCase):
    def test_messaggio_installazione(self):
        from deskew import estimate_skew_angle as est
        with self.assertRaises(RuntimeError):
            est(object())


if __name__ == "__main__":
    unittest.main()
