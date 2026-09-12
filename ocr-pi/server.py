"""MCP server stdio ocr-pi: 9 tool (spec #20). Solo stdlib + `mcp` package.

Avvio: ocr-pi/.venv/bin/python ocr-pi/server.py [--root DIR]
Le funzioni tool_* sono testabili senza SDK; il trasporto stdio usa FastMCP.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import manager  # noqa: E402
from converter import convert  # noqa: E402
from wiki import ConvertedDoc  # noqa: E402

FIRST_CALL_NOTE = ("Nota: la prima conversione carica i modelli in locale "
                   "(~10-60 s una tantum su CPU), poi riuso in memoria.")


def _root(root) -> Path:
    return Path(root or ".").resolve()


def _clean_id(value, kind):
    if not value or '..' in value or '/' in value or chr(92) in value:
        raise ValueError('identificatore non valido')
    return value


def _inside(root: Path, p) -> Path:
    """Rifiuta path fuori dalla wiki-root (niente ../ fuori)."""
    cand = (root / p).resolve() if not Path(p).is_absolute() else Path(p).resolve()
    try:
        cand.relative_to(root)
    except ValueError:
        raise ValueError(f"path fuori dalla wiki-root: {p}") from None
    return cand


def tool_ocr_convert(path: str, pages: str = "", engine: str = "docling", root: str = ".") -> dict:
    src = Path(path)
    if not src.exists():
        raise ValueError(f"sorgente assente: {path}")
    wanted = [int(x) for x in pages.split(",") if x.strip()] or None
    r = convert(src, pages=wanted, engine=engine, workdir=_root(root))
    return {"markdown": r.markdown, "assets": [str(a) for a in r.assets],
            "pages": r.pages, "engine": r.engine, "seconds": round(r.seconds, 2),
            "review_state": "draft", "note": FIRST_CALL_NOTE}


def tool_wiki_list(root: str = ".") -> dict:
    return {"wikis": manager.list_wikis(_root(root))}


def tool_wiki_search(query: str, stato: str = "", wiki: str = "", root: str = ".") -> dict:
    return {"hits": manager.search(_root(root), query, stato=stato or None, wiki=wiki or None)}


def tool_wiki_get(wiki: str, voce: str, root: str = ".") -> dict:
    r = _root(root)
    _clean_id(voce, 'voce')
    p = manager.show(r, wiki, voce)
    _inside(r, p.relative_to(r) if p.is_absolute() else p)
    return {"file": str(p), "markdown": p.read_text(encoding="utf-8")}


def tool_wiki_add(wiki: str, markdown: str = "", file: str = "", title: str = "", root: str = ".") -> dict:
    r = _root(root)
    if file:
        src = Path(file)
        if not src.exists():
            raise ValueError('sorgente assente')
        return manager.add(r, wiki, src, title=title or None)
    if not markdown:
        raise ValueError("servono markdown inline oppure file")
    tmp = r / "wiki" / ".mcp-add.md"
    tmp.parent.mkdir(parents=True, exist_ok=True)
    tmp.write_text(markdown, encoding="utf-8")
    try:
        return manager.add(r, wiki, tmp, title=title or "voce-mcp")
    finally:
        tmp.unlink(missing_ok=True)


def tool_wiki_review(wiki: str, voce: str, stato: str, root: str = ".") -> dict:
    return manager.review(_root(root), wiki, voce, stato)


def tool_wiki_remove(wiki: str, voce: str = "", confirm: bool = False, root: str = ".") -> dict:
    return manager.remove(_root(root), wiki, voce or None, confirm=confirm)


def tool_wiki_export(wiki: str, senza_raw: bool = False, root: str = ".") -> dict:
    return {"zip": str(manager.export(_root(root), wiki, senza_raw=senza_raw))}


def tool_wiki_import(zip_path: str, merge: bool = False, root: str = ".") -> dict:
    # Lo zip in ingresso puo' stare ovunque (input read-only scelto dall'utente);
    # tutti gli output restano sotto root per costruzione di import_wiki.
    r = _root(root)
    zp = Path(zip_path)
    if not zp.exists():
        raise ValueError('zip assente')
    return manager.import_wiki(r, zp, merge=merge)


def build_server(root: str = "."):
    """Crea il FastMCP con root fissata. Import SDK solo qui (test senza SDK)."""
    try:  # SDK v2: FastMCP -> MCPServer (fallback v1)
        from mcp.server.mcpserver import MCPServer as _Server
    except ImportError:
        from mcp.server.fastmcp import FastMCP as _Server

    mcp = _Server("ocr-pi")
    R = _root(root)

    @mcp.tool(description="Converti PDF/immagine in Markdown con tabelle (Docling locale). " + FIRST_CALL_NOTE)
    def ocr_convert(path: str, pages: str = "", engine: str = "docling") -> dict:
        return tool_ocr_convert(path, pages, engine, str(R))

    @mcp.tool(description="Elenca i dizionari wiki.")
    def wiki_list() -> dict:
        return tool_wiki_list(str(R))

    @mcp.tool(description="Cerca full-text nelle voci (filtro stato opzionale: draft/reviewed/versioned).")
    def wiki_search(query: str, stato: str = "", wiki: str = "") -> dict:
        return tool_wiki_search(query, stato, wiki, str(R))

    @mcp.tool(description="Leggi una voce (sempre dalla wiki-root).")
    def wiki_get(wiki: str, voce: str) -> dict:
        return tool_wiki_get(wiki, voce, str(R))

    @mcp.tool(description="Aggiungi voce draft da markdown inline o file. Crea sempre draft.")
    def wiki_add(wiki: str, markdown: str = "", file: str = "", title: str = "") -> dict:
        return tool_wiki_add(wiki, markdown, file, title, str(R))

    @mcp.tool(description="Cambia stato voce: draft/reviewed/versioned.")
    def wiki_review(wiki: str, voce: str, stato: str) -> dict:
        return tool_wiki_review(wiki, voce, stato, str(R))

    @mcp.tool(description="Rimuovi voce (va in trash) o wiki intera (richiede confirm=true).")
    def wiki_remove(wiki: str, voce: str = "", confirm: bool = False) -> dict:
        return tool_wiki_remove(wiki, voce, confirm, str(R))

    @mcp.tool(description="Esporta wiki in zip (md + assets). senza_raw esclude gli originali.")
    def wiki_export(wiki: str, senza_raw: bool = False) -> dict:
        return tool_wiki_export(wiki, senza_raw, str(R))

    @mcp.tool(description="Importa zip wiki (path locale). Merge: skip conflitti + report.")
    def wiki_import(zip_path: str, merge: bool = False) -> dict:
        return tool_wiki_import(zip_path, merge, str(R))

    return mcp


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--selftest", action="store_true",
                    help="stampa i tool senza servire (smoke senza client)")
    args = ap.parse_args(argv)
    mcp = build_server(args.root)
    if args.selftest:
        import asyncio

        async def names():
            return sorted([t.name for t in await mcp.list_tools()])
        print("\n".join(asyncio.run(names())))
        return 0
    mcp.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
