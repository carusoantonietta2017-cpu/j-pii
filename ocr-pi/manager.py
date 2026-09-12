"""Wiki-manager: CRUD su wiki/<slug>/ sopra il writer. Solo stdlib.

meta.json e' source of truth per gli stati; index.md e' rigenerato a ogni
mutazione. Mai cancellazioni/sovrascritture silenziose (spec #19).
"""
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

from wiki import slugify, write_wiki, export_wiki, ConvertedDoc

VALID_STATES = ("draft", "reviewed", "versioned")


def _root(root) -> Path:
    return Path(root)


def _wiki_dir(root, wiki: str) -> Path:
    return _root(root) / "wiki" / slugify(wiki)


def _require_wiki(root, wiki: str) -> Path:
    d = _wiki_dir(root, wiki)
    if not (d / "meta.json").exists():
        raise LookupError(f"wiki assente: {wiki}")
    return d


def _load_meta(wiki_dir: Path) -> dict:
    import json
    return json.loads((wiki_dir / "meta.json").read_text(encoding="utf-8"))


def _save_meta(wiki_dir: Path, meta: dict) -> None:
    import json
    (wiki_dir / "meta.json").write_text(
        json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    rows = ["# Indice voci", "",
            "| Voce | File | Stato | Pagine |", "| --- | --- | --- | --- |"]
    for d in meta["docs"]:
        rows.append(f"| {d['name']} | {d['file']} | {d['review']} | {d.get('pages', 0)} |")
    (wiki_dir / "index.md").write_text("\n".join(rows) + "\n", encoding="utf-8")


def list_wikis(root=".") -> list:
    """[{slug, voci}] per ogni wiki valida."""
    base = _root(root) / "wiki"
    out = []
    if not base.exists():
        return out
    for d in sorted(base.iterdir()):
        if d.is_dir() and (d / "meta.json").exists():
            out.append({"slug": d.name, "voci": len(_load_meta(d)["docs"])})
    return out


def search(root, query: str, stato=None, wiki=None) -> list:
    """Grep sui doc/*.md. Ritorna [{wiki, file, linea, testo}]."""
    q = query.lower()
    targets = [slugify(wiki)] if wiki else [w["slug"] for w in list_wikis(root)]
    hits = []
    for slug in targets:
        d = _wiki_dir(root, slug)
        if not (d / "meta.json").exists():
            continue
        states = {x["file"]: x["review"] for x in _load_meta(d)["docs"]}
        for md in sorted((d / "doc").glob("*.md")):
            rel = f"doc/{md.name}"
            if stato and states.get(rel) != stato:
                continue
            for i, line in enumerate(md.read_text(encoding="utf-8").splitlines(), 1):
                if q in line.lower():
                    hits.append({"wiki": slug, "file": rel, "linea": i, "testo": line.strip()})
    return hits


def show(root, wiki: str, voce: str) -> Path:
    """Ritorna il path del md della voce (l'editing avviene nell'editor)."""
    d = _require_wiki(root, wiki)
    meta = _load_meta(d)
    for x in meta["docs"]:
        if x["name"] == voce or Path(x["file"]).stem == slugify(voce):
            p = d / x["file"]
            if not p.exists():
                raise LookupError(f"file voce mancante: {x['file']}")
            return p
    raise LookupError(f"voce assente: {voce}")


def create_wiki(root, slug: str):
    """Crea wiki vuota (da popolare con add)."""
    return write_wiki([], slug, root=root)


def add(root, wiki: str, source_md, title=None) -> dict:
    """Aggiunge un md come voce draft; crea la wiki se assente."""
    src = Path(source_md)
    if not src.exists():
        raise FileNotFoundError(f"sorgente assente: {src}")
    try:
        d = _require_wiki(root, wiki)
    except LookupError:
        d = create_wiki(root, wiki)
    meta = _load_meta(d)
    name = title or src.stem
    vfile = f"doc/{slugify(name)}.md"
    if any(x["file"] == vfile for x in meta["docs"]):
        raise ValueError(f"voce esistente: {vfile} (non sovrascrivo)")
    text = src.read_text(encoding="utf-8")
    # trascina gli asset referenziati se sono accanto al sorgente
    assets_dir = d / "doc" / "assets"
    def sub(m):
        base = Path(m.group(1)).name
        cand = src.parent / base
        alt = src.parent / "assets" / base
        found = cand if cand.exists() else (alt if alt.exists() else None)
        if found:
            shutil.copy2(found, assets_dir / base)
            return m.group(0).replace(m.group(1), f"assets/{base}", 1)
        return m.group(0)
    text = re.sub(r"!\[[^\]]*\]\(([^)]+)\)", sub, text)
    (d / vfile).write_text(text, encoding="utf-8")
    entry = {"name": name, "file": vfile, "pages": 0, "engine": "", "seconds": 0.0, "review": "draft"}
    meta["docs"].append(entry)
    _save_meta(d, meta)
    return entry


def review(root, wiki: str, voce: str, stato: str) -> dict:
    """Cambia stato voce. Ritorna la voce aggiornata."""
    if stato not in VALID_STATES:
        raise ValueError(f"stato non valido: {stato} (validi: {VALID_STATES})")
    d = _require_wiki(root, wiki)
    meta = _load_meta(d)
    for x in meta["docs"]:
        if x["name"] == voce or Path(x["file"]).stem == slugify(voce):
            x["review"] = stato
            _save_meta(d, meta)
            return x
    raise LookupError(f"voce assente: {voce}")


def remove(root, wiki: str, voce=None, confirm=False) -> dict:
    """Voce -> trash/ recuperabile. Wiki intera solo con confirm=True."""
    if voce is None:
        if not confirm:
            raise PermissionError("rimozione wiki intera: serve confirm=True")
        d = _require_wiki(root, wiki)
        shutil.rmtree(d)
        return {"removed": f"wiki:{slugify(wiki)}"}
    d = _require_wiki(root, wiki)
    meta = _load_meta(d)
    for i, x in enumerate(meta["docs"]):
        if x["name"] == voce or Path(x["file"]).stem == slugify(voce):
            trash = d / "trash"
            trash.mkdir(exist_ok=True)
            (trash / "assets").mkdir(exist_ok=True)
            src = d / x["file"]
            text = src.read_text(encoding="utf-8") if src.exists() else ""
            dest = None
            if src.exists():
                dest = trash / src.name
                n = 1
                while dest.exists():  # mai sovrascrivere il trash
                    dest = trash / f"{src.stem}-{n}{src.suffix}"
                    n += 1
                shutil.move(str(src), dest)
            for m in re.finditer(r"\(assets/([^)]+)\)", text):
                a = d / "doc" / "assets" / m.group(1)
                if a.exists():
                    shutil.move(str(a), trash / "assets" / a.name)
            del meta["docs"][i]
            _save_meta(d, meta)
            return {"removed": x["file"], "trash": True}
    raise LookupError(f"voce assente: {voce}")


def export(root, wiki: str, senza_raw=False) -> Path:
    return export_wiki(_require_wiki(root, wiki), senza_raw=senza_raw)


def rename(root, wiki: str, nuovo: str) -> dict:
    d = _require_wiki(root, wiki)
    slug = slugify(nuovo)
    if not slug:
        raise ValueError('nome vuoto')
    dest = _root(root) / 'wiki' / slug
    if dest.exists():
        raise ValueError(f'wiki esistente: {slug} (non sovrascrivo)')
    import json
    meta = json.loads((d / 'meta.json').read_text(encoding='utf-8'))
    meta['slug'] = slug
    (d / 'meta.json').write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding='utf-8')
    d.rename(dest)
    return {'slug': slug}


def trash_list(root, wiki: str) -> list:
    d = _require_wiki(root, wiki)
    tdir = d / 'trash'
    if not tdir.exists():
        return []
    return sorted(x.name for x in tdir.glob('*.md'))


def import_wiki(root, zip_path, merge=False) -> dict:
    """Importa zip wiki. Slug esistente -> errore senza merge; conflitti voce -> skip + report."""
    root = _root(root)
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(zip_path) as z:
            tops = {Path(n).parts[0] for n in z.namelist() if "/" in n}
            if len(tops) != 1:
                raise ValueError(f"zip ambiguo, attese 1 cartella radice: {sorted(tops)}")
            slug = slugify(next(iter(tops)))
            z.extractall(tmp)
            src = Path(tmp) / next(iter(tops))
            if not (src / "meta.json").exists() or not (src / "index.md").exists():
                raise ValueError("zip non una wiki valida (mancano meta.json/index.md)")
            dest = root / "wiki" / slug
            if dest.exists() and not merge:
                raise ValueError(f"wiki esistente: {slug} (usa merge=True)")
            import json
            if not dest.exists():
                shutil.copytree(src, dest)
                n = len(json.loads((dest / "meta.json").read_text(encoding="utf-8"))["docs"])
                return {"slug": slug, "imported": n, "skipped": []}
            meta = json.loads((dest / "meta.json").read_text(encoding="utf-8"))
            have = {x["file"] for x in meta["docs"]}
            skipped, added = [], 0
            incoming = json.loads((src / "meta.json").read_text(encoding="utf-8"))
            for x in incoming["docs"]:
                if x["file"] in have:
                    skipped.append(x["file"])
                    continue
                s, t = src / x["file"], dest / x["file"]
                t.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(s, t)
                meta["docs"].append(x)
                added += 1
            _save_meta(dest, meta)
            return {"slug": slug, "imported": added, "skipped": skipped}
