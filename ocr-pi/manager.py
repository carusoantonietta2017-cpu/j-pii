"""Wiki-manager: CRUD su wiki/<slug>/ sopra il writer. Solo stdlib.

meta.json e' source of truth per gli stati; index.md e' rigenerato a ogni
mutazione. Mai cancellazioni/sovrascritture silenziose (spec #19).
"""
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

from wiki import slugify, write_wiki, export_wiki, ConvertedDoc, strip_frontmatter, parse_frontmatter, with_frontmatter, stem_of, resolve_pair

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
    """Grep sui doc/*.md (frontmatter escluso). Ritorna [{wiki, file, linea, testo}]."""
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
            body = strip_frontmatter(md.read_text(encoding="utf-8")).lstrip("\n")
            for i, line in enumerate(body.splitlines(), 1):
                if q in line.lower():
                    hits.append({"wiki": slug, "file": rel, "linea": i, "testo": line.strip()})
    return hits


def get_content(root, wiki: str, voce: str) -> dict:
    """Contenuto pieno di una voce (per wiki_get agente): 1 chiamata invece di N search."""
    d = _require_wiki(root, wiki)
    meta = _load_meta(d)
    for x in meta["docs"]:
        if x["name"] == voce or Path(x["file"]).stem == slugify(voce) or x["file"] == voce:
            p = d / x["file"]
            if not p.exists():
                raise LookupError(f"file voce mancante: {x['file']}")
            return {"name": x["name"], "file": x["file"], "review": x.get("review", ""), "raw": x.get("raw", ""), "content": p.read_text(encoding="utf-8")}
    raise LookupError(f"voce assente: {voce}")


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


def add(root, wiki: str, source_md, title=None, raw_source=None) -> dict:
    """Aggiunge un md come voce draft; crea la wiki se assente.
    raw_source: path originale da copiare in raw/ e linkare in meta+frontmatter."""
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
    assets_dir.mkdir(parents=True, exist_ok=True)
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
    raw_rel = ""
    if raw_source:
        rs = Path(raw_source)
        if not rs.exists() or not rs.is_file():
            raise FileNotFoundError(f"raw assente: {rs}")
        raw_dir = d / "raw"
        raw_dir.mkdir(parents=True, exist_ok=True)
        dest = raw_dir / rs.name
        # mai sovrascrivere un raw diverso: se esiste con stesso nome ma diverso contenuto, versiona
        if dest.exists():
            try:
                if dest.read_bytes() != rs.read_bytes():
                    stem, suf = rs.stem, rs.suffix
                    n = 1
                    while (raw_dir / f"{stem}-{n}{suf}").exists():
                        n += 1
                    dest = raw_dir / f"{stem}-{n}{suf}"
            except Exception:
                pass
        else:
            shutil.copy2(rs, dest)
            if not dest.exists():
                shutil.copy2(rs, dest)
        # assicura copia
        if not dest.exists():
            shutil.copy2(rs, dest)
        raw_rel = f"raw/{dest.name}"
        fm = parse_frontmatter(text)
        fm.setdefault("wiki", slugify(wiki))
        fm.setdefault("voce", name)
        fm["source"] = f"../{raw_rel}"
        text = with_frontmatter(text, fm)
    else:
        # garantisci almeno frontmatter minimo per il pairing futuro
        if not parse_frontmatter(text):
            text = with_frontmatter(text, {"wiki": slugify(wiki), "voce": name})
    (d / vfile).write_text(text, encoding="utf-8")
    entry = {"name": name, "file": vfile, "pages": 0, "engine": "", "seconds": 0.0, "review": "draft", "raw": raw_rel}
    meta["docs"].append(entry)
    _save_meta(d, meta)
    return entry


def update_file(root, wiki: str, rel_path: str, markdown: str) -> dict:
    """Aggiorna una voce esistente dall'editor (PUT). Preserva frontmatter source/raw.
    Rimette review=draft se era reviewed/versioned (mai promuovere in silenzio)."""
    d = _require_wiki(root, wiki)
    rel = str(rel_path).replace("\\", "/")
    if ".." in rel or rel.startswith("/"):
        raise ValueError("path non valido")
    meta = _load_meta(d)
    target = None
    for x in meta["docs"]:
        if x["file"] == rel:
            target = x
            break
    if target is None:
        # consenti SKILL.md/index.md? no: solo doc/*.md editabili
        if not (rel.startswith("doc/") and rel.endswith(".md")):
            raise ValueError("solo doc/*.md editabili")
        raise LookupError(f"voce assente: {rel}")
    dest = d / rel
    old = dest.read_text(encoding="utf-8") if dest.exists() else ""
    old_fm = parse_frontmatter(old)
    new_fm = parse_frontmatter(markdown)
    merged = {**new_fm, **{k: v for k, v in old_fm.items() if k in ("source", "wiki", "voce") and k not in new_fm}}
    if not merged.get("wiki"):
        merged["wiki"] = slugify(wiki)
    if not merged.get("voce"):
        merged["voce"] = target.get("name", "")
    # mantieni raw link anche se l'editor lo toglie
    if target.get("raw") and not merged.get("source"):
        merged["source"] = f"../{target['raw']}"
    final = with_frontmatter(markdown, merged)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(final, encoding="utf-8")
    if target.get("review") in ("reviewed", "versioned"):
        target["review"] = "draft"
    _save_meta(d, meta)
    return target


def link_raws(root, wiki: str) -> dict:
    """Migrazione: collega raw orfani a voci senza meta.raw via stem match.
    Aggiorna meta.json + frontmatter source. Ritorna {linked, skipped}."""
    d = _require_wiki(root, wiki)
    meta = _load_meta(d)
    try:
        raws = [p.name for p in (d / "raw").iterdir() if p.is_file()]
    except FileNotFoundError:
        return {"linked": 0, "skipped": len(meta.get("docs", []))}
    linked = 0
    for x in meta["docs"]:
        if x.get("raw"):
            continue
        pair = resolve_pair([x], raws, x.get("file", ""))
        cand = (pair.get("raw") or "").split("/")[-1]
        if cand and (d / "raw" / cand).exists():
            x["raw"] = f"raw/{cand}"
            # aggiorna frontmatter
            p = d / x["file"]
            if p.exists():
                txt = p.read_text(encoding="utf-8")
                fm = parse_frontmatter(txt)
                fm["source"] = f"../raw/{cand}"
                if not fm.get("wiki"):
                    fm["wiki"] = meta.get("slug", slugify(wiki))
                if not fm.get("voce"):
                    fm["voce"] = x.get("name", "")
                p.write_text(with_frontmatter(txt, fm), encoding="utf-8")
            linked += 1
    # voci senza frontmatter: aggiungilo comunque
    for x in meta["docs"]:
        p = d / x["file"]
        if p.exists() and not parse_frontmatter(p.read_text(encoding="utf-8")):
            txt = p.read_text(encoding="utf-8")
            fm = {"wiki": meta.get("slug", slugify(wiki)), "voce": x.get("name", "")}
            if x.get("raw"):
                fm["source"] = f"../{x['raw']}"
            p.write_text(with_frontmatter(txt, fm), encoding="utf-8")
    _save_meta(d, meta)
    return {"linked": linked, "skipped": len(meta["docs"]) - linked}


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
