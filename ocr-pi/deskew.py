"""Pre-deskew esplicito (OpenCV) + warp deterministico per il bench. cv2 lazy."""

WARP_SEED = 7
WARP_MAGNITUDE = 0.08


def _cv2():
    try:
        import cv2
        return cv2
    except ImportError as e:
        raise RuntimeError("serve opencv: ocr-pi/.venv/bin/pip install opencv-python-headless") from e


def _np():
    try:
        import numpy
        return numpy
    except ImportError as e:
        raise RuntimeError("serve numpy (con opencv)") from e


def estimate_skew_angle(img) -> float:
    """Tilt rilevato in gradi, positivo = orario. img: ndarray BGR."""
    cv2 = _cv2()
    np = _np()
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    coords = np.column_stack(np.where(bw > 0))
    if len(coords) < 10:
        return 0.0
    angle = cv2.minAreaRect(coords)[-1]
    tilt = -(90 + angle) if angle < -45 else -angle
    return float(tilt)


def deskew_image(img, angle=None):
    """Ritorna (raddrizzata, angolo_applicato). Deterministica."""
    cv2 = _cv2()
    tilt = angle if angle is not None else estimate_skew_angle(img)
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), tilt, 1.0)
    # bounding box intera (niente ritagli)
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    m[0, 2] += nw / 2 - w / 2
    m[1, 2] += nh / 2 - h / 2
    return cv2.warpAffine(img, m, (nw, nh), borderValue=(255, 255, 255)), float(tilt)


def warp_perspective(img, magnitude=WARP_MAGNITUDE, seed=WARP_SEED):
    """Foto storta sintetica, deterministica (stesso seed = stesso warp)."""
    cv2 = _cv2()
    np = _np()
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    dx, dy = magnitude * w, magnitude * h
    src = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    dst = (src + rng.uniform(-1, 1, (4, 2)) * np.float32([dx, dy])).astype(np.float32)
    m = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, m, (w, h), borderValue=(255, 255, 255))


def deskew_file(src, dest) -> float:
    """Raddrizza file immagine su disco. Ritorna il tilt corretto."""
    cv2 = _cv2()
    img = cv2.imread(str(src))
    if img is None:
        raise ValueError(f"immagine illeggibile: {src}")
    fixed, tilt = deskew_image(img)
    cv2.imwrite(str(dest), fixed)
    return tilt


def rotate_for_test(img, degrees: float):
    """Solo test: ruota di angolo noto (stessa convenzione di deskew)."""
    cv2 = _cv2()
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), -degrees, 1.0)
    cos, sin = abs(m[0, 0]), abs(m[0, 1])
    nw, nh = int(h * sin + w * cos), int(h * cos + w * sin)
    m[0, 2] += nw / 2 - w / 2
    m[1, 2] += nh / 2 - h / 2
    return cv2.warpAffine(img, m, (nw, nh), borderValue=(255, 255, 255))


def angle_diff(a: float, b: float) -> float:
    d = abs(a - b) % 180
    return min(d, 180 - d)
