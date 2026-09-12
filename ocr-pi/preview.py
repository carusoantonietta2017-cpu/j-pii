"""Anteprima reale: convert -> preview.html statica + mini-server review. Solo stdlib.

Uso:
  python3 ocr-pi/preview.py --pdf bench/corpus/synthetic_it/fattura_001.pdf --engine fake --out /tmp/prev
  python3 ocr-pi/preview.py --pdf ... --engine docling --serve 8000
Lo statico mostra conversione vera; --serve aggiunge POST /api/review
che chiama manager.review (stessa root della wiki creata).
"""
import argparse
import html
import json
import re
import shutil
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

import manager  # noqa: E402
from converter import convert  # noqa: E402

CF_RE = re.compile(r"\b[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]\b")
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")


def md_table_to_html(markdown: str) -> str:
    rows = [l.strip() for l in markdown.splitlines() if l.strip().startswith("|")]
    if len(rows) < 2:
        return ""
    body = [c.strip() for c in rows[0].strip("|").split("|")]
    out = ["<table><tr>" + "".join(f"<th>{html.escape(c)}</th>" for c in body) + "</tr>"]
    for r in rows[2:]:
        cells = [c.strip() for c in r.strip("|").split("|")]
        out.append("<tr>" + "".join(f"<td>{html.escape(c)}</td>" for c in cells) + "</tr>")
    return "\n".join(out) + "</table>"


def build_preview(result, source: Path, out_dir: Path, wiki_root: str, slug: str, voce: str) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    assets = []
    for a in result.assets:
        a = Path(a)
        if a.exists():
            shutil.copy2(a, out_dir / a.name)
            assets.append(a.name)
    md = result.markdown
    for name in assets:
        md = md.replace(f"assets/{name}", name)
    orig = out_dir / ("original" + source.suffix)
    shutil.copy2(source, orig)
    table = md_table_to_html(md) or "<p>(nessuna tabella rilevata)</p>"
    safe_md = html.escape(md)
    page = f"""<!DOCTYPE html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Anteprima — {html.escape(source.name)}</title>
<style>body{{font-family:system-ui,sans-serif;margin:0}}header{{padding:12px 16px;border-bottom:1px solid #dadce0;display:flex;gap:8px;flex-wrap:wrap}}.badge{{border:1px solid #dadce0;border-radius:12px;padding:2px 10px;font-size:12px;background:#f8f9fa}}main{{display:grid;grid-template-columns:1fr 1fr}}section{{padding:12px 16px}}.left{{border-right:1px solid #dadce0;background:#fafafa}}table{{border-collapse:collapse;width:100%;font-size:14px}}td,th{{border:1px solid #80868b;padding:4px 8px}}pre{{background:#f1f3f4;padding:8px;white-space:pre-wrap;font-size:12px}}footer{{border-top:1px solid #dadce0;padding:12px 16px;display:flex;gap:8px}}button{{border:1px solid #dadce0;background:#fff;border-radius:8px;padding:6px 12px;cursor:pointer}}button.primary{{background:#137333;color:#fff;border-color:#137333}}#toast{{margin-left:auto;color:#137333}}img{{max-width:100%}}</style>
</head><body>
<header><strong>{html.escape(source.name)}</strong><span class="badge">p. {result.pages}</span>
<span class="badge">modello: {html.escape(result.engine)}</span>
<span class="badge">{result.seconds:.1f} s/pagina (reali)</span></header>
<main><section class="left"><h2>Originale</h2>
<p><a href="{orig.name}">apri originale ({source.suffix})</a></p>
{"".join(f'<p><img src="{a}" alt="asset"></p>' for a in assets) or "<p>(nessun asset immagine)</p>"}
</section><section><h2>Markdown estratto</h2>
<div><button id="bMask">Mostra Mask</button></div>
<div id="tabled">{table}</div>
<pre id="mdtext">{safe_md}</pre>
</section></main>
<footer><button class="primary" data-s="reviewed">Approva</button>
<button data-s="draft">Rimanda a draft</button><span id="toast"></span></footer>
<script>
const REAL = document.getElementById('mdtext').textContent;
let masked = false;
const CF = /\\b[A-Z]{{6}}[0-9]{{2}}[A-Z][0-9]{2}[A-Z][0-9]{{3}}[A-Z]\\b/g;
const EM = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{{2,}}/g;
document.getElementById('bMask').onclick = e => {{
  masked = !masked;
  e.target.textContent = masked ? 'Mostra valori' : 'Mostra Mask';
  let t = REAL.replace(CF, '[CF_1]').replace(EM, '[EMAIL_1]');
  document.getElementById('mdtext').textContent = masked ? t : REAL;
}};
document.querySelectorAll('footer button').forEach(b => b.onclick = async () => {{
  const r = await fetch('/api/review', {{method:'POST', headers:{{'Content-Type':'application/json'}},
    body: JSON.stringify({{wiki:{json.dumps(slug)}, voce:{json.dumps(voce)}, stato:b.dataset.s}})}}));
  document.getElementById('toast').textContent = r.ok ? 'stato: ' + b.dataset.s : 'errore ' + r.status;
}});
</script></body></html>"""
    out = out_dir / "preview.html"
    out.write_text(page, encoding="utf-8")
    return out


def make_handler(wiki_root: str, out_dir: Path):
    root = Path(wiki_root).resolve()

    class H(SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=str(out_dir), **kw)

        def do_POST(self):
            if urlparse(self.path).path != "/api/review":
                return self.send_error(404)
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
                res = manager.review(str(root), body["wiki"], body["voce"], body["stato"])
            except (KeyError, ValueError, LookupError) as e:
                self.send_response(400)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                return self.wfile.write(json.dumps({"error": str(e)}).encode())
            payload = json.dumps(res, ensure_ascii=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *a):
            pass

    return H


def serve(out_dir: Path, wiki_root: str, port: int) -> None:
    root = Path(wiki_root).resolve()
    print(f"preview su http://localhost:{port}/preview.html (root wiki: {root})")
    ThreadingHTTPServer(("127.0.0.1", port), make_handler(wiki_root, out_dir)).serve_forever()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf", required=True)
    ap.add_argument("--engine", default="docling")
    ap.add_argument("--pages", default="")
    ap.add_argument("--wiki-root", default=".")
    ap.add_argument("--slug", default="preview")
    ap.add_argument("--out", default="preview-out")
    ap.add_argument("--serve", type=int, default=0)
    args = ap.parse_args(argv)
    pages = [int(x) for x in args.pages.split(",") if x.strip()] or None
    result = convert(args.pdf, pages=pages, engine=args.engine, workdir=args.out)
    from wiki import ConvertedDoc, write_wiki
    src = Path(args.pdf)
    doc = ConvertedDoc(name=src.stem, markdown=result.markdown, assets=result.assets,
                       engine=result.engine, seconds=result.seconds, pages=result.pages, source=src)
    wiki = write_wiki([doc], args.slug, root=args.wiki_root)
    out = build_preview(result, src, Path(args.out), args.wiki_root, wiki.name, src.stem)
    print(f"preview: {out}\nwiki: {wiki}")
    if args.serve:
        serve(Path(args.out), args.wiki_root, args.serve)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
