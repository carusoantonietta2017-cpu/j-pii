"""Wiki writer: documenti convertiti -> wiki/<slug>/ + export zip. Solo stdlib.

Layout (da docs/research/wiki-format-skill.md):
  wiki/<slug>/
    SKILL.md README.md AGENTS.md index.md meta.json
    doc/<nome>.md  doc/assets/*  raw/*  (raw solo se include_raw)
Zip: <slug>.zip fratello della cartella (mai dentro: evita ricorsione),
contiene la dir <slug>/ con md + assets; --senza-raw esclude raw/.
"""
import json
import re
import shutil
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

IMG_RE = re.compile(r"!\[[^\]]*\]\(([^)]+)\)")
SKILL_NAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$")
FRONT_RE = re.compile(r"^---\n(.*?)\n---\n", re.S)


def strip_frontmatter(md: str) -> str:
    """Rimuove il frontmatter YAML iniziale, se presente."""
    return FRONT_RE.sub("", md, count=1) if md.startswith("---\n") else md


def parse_frontmatter(md: str) -> dict:
    """Parsa il frontmatter iniziale in dict semplice chiave: valore."""
    m = FRONT_RE.match(md)
    if not m:
        return {}
    out = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            out[k.strip()] = v.strip()
    return out


def with_frontmatter(body: str, fields: dict) -> str:
    """Prepende frontmatter YAML a body, rimuovendo eventuale frontmatter esistente."""
    body = strip_frontmatter(body).lstrip("\n")
    head = "---\n" + "\n".join(f"{k}: {v}" for k, v in fields.items()) + "\n---\n\n"
    return head + body


@dataclass
class ConvertedDoc:
    name: str                    # es. "fattura_001"
    markdown: str
    assets: list = field(default_factory=list)  # Path immagini
    engine: str = ""
    seconds: float = 0.0
    pages: int = 0
    source: Path | None = None   # originale (per raw/)


def slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug) or "wiki"
    return slug[:64].strip("-") or "wiki"


def skill_name_for(slug: str) -> str:
    name = f"wiki-{slugify(slug)}"[:64].rstrip("-")
    assert SKILL_NAME_RE.match(name), f"nome skill non valido: {name}"
    return name


def check_skill_frontmatter(skill_md: str) -> dict:
    """Valida frontmatter Agent Skills: name + description obbligatori."""
    m = re.match(r"^---\n(.*?)\n---\n", skill_md, re.S)
    if not m:
        raise ValueError("SKILL.md senza frontmatter ---...---")
    front = m.group(1)
    name = re.search(r"^name:\s*(.+)$", front, re.M)
    desc = re.search(r"^description:\s*(.+)$", front, re.M)
    if not name or not desc:
        raise ValueError("SKILL.md: name e description obbligatori")
    if not SKILL_NAME_RE.match(name.group(1).strip()):
        raise ValueError(f"SKILL.md name non valido: {name.group(1)}")
    if len(desc.group(1).strip()) > 1024:
        raise ValueError("SKILL.md description > 1024 char")
    return {"name": name.group(1).strip(), "description": desc.group(1).strip()}


def _rewrite_images(markdown: str, mapping: dict) -> str:
    """Rimappa i path immagine sui basename copiati in doc/assets/."""

    def sub(m):
        path = m.group(1)
        base = Path(path).name
        return m.group(0).replace(path, f"assets/{mapping.get(base, base)}", 1)

    return IMG_RE.sub(sub, markdown)


def write_wiki(docs, slug, root=".", include_raw=True) -> Path:
    """Scrive wiki/<slug>/, ritorna il path. Voci sempre draft iniziale."""
    slug = slugify(slug)
    if not docs:
        docs = []
    wiki = Path(root) / "wiki" / slug
    doc_dir = wiki / "doc"
    assets_dir = doc_dir / "assets"
    raw_dir = wiki / "raw"
    for d in (doc_dir, assets_dir, raw_dir):
        d.mkdir(parents=True, exist_ok=True)

    index_rows = []
    meta_docs = []
    for doc in docs:
        vname = slugify(doc.name)
        copied = {}
        for a in doc.assets:
            a = Path(a)
            if a.exists() and a.is_file():
                dest = assets_dir / a.name
                shutil.copy2(a, dest)
                copied[a.name] = dest.name
        md = _rewrite_images(doc.markdown, copied)
        raw_name = ""
        if include_raw and doc.source and Path(doc.source).exists():
            raw_name = Path(doc.source).name
            shutil.copy2(doc.source, raw_dir / raw_name)
        # frontmatter pairing: la corrispondenza originale<->md vive nel wiki stesso
        fm = {"wiki": slug, "voce": doc.name, "engine": doc.engine or "?",
              "pages": str(doc.pages or 0)}
        if raw_name:
            fm["source"] = f"../raw/{raw_name}"
        md = with_frontmatter(md, fm)
        (doc_dir / f"{vname}.md").write_text(md, encoding="utf-8")
        index_rows.append(f"| {doc.name} | doc/{vname}.md | draft | {doc.pages} |")
        meta_docs.append({"name": doc.name, "file": f"doc/{vname}.md",
                          "pages": doc.pages, "engine": doc.engine,
                          "seconds": round(doc.seconds, 2), "review": "draft",
                          "raw": f"raw/{raw_name}" if raw_name else ""})

    titles = ", ".join(d.name for d in docs) if docs else "in allestimento"
    skill_md = (
        f"---\nname: {skill_name_for(slug)}\n"
        f"description: Documenti trascritti ({titles}). Usala quando servono contenuti, "
        f"tabelle o riferimenti di questi documenti.\n---\n\n# Wiki {slug}\n\n"
        "Leggi prima `index.md`, poi i `doc/*.md` indicati. Le immagini stanno in\n"
        "`doc/assets/`, gli originali in `raw/`. Cita sempre pagina e file.\n"
        "Stati: draft (bozza), reviewed (verificato), versioned (stabile).\n"
    )
    check_skill_frontmatter(skill_md)  # mai scrivere una SKILL.md invalida
    (wiki / "SKILL.md").write_text(skill_md, encoding="utf-8")
    (wiki / "README.md").write_text(
        f"# Wiki {slug}\n\nVoci: {len(docs)}. Engine: {docs[0].engine if docs else '?'}. "
        f"Stati in `index.md`. Export: `{slug}.zip`.\n", encoding="utf-8")
    (wiki / "AGENTS.md").write_text(
        f"# Note operative ({slug})\n\nSorgenti in `raw/`, trascrizioni corrette in "
        f"`doc/`, indice in `index.md`. Non modificare `meta.json` a mano.\n", encoding="utf-8")
    (wiki / "index.md").write_text(
        "# Indice voci\n\n| Voce | File | Stato | Pagine |\n| --- | --- | --- | --- |\n"
        + "\n".join(index_rows) + "\n", encoding="utf-8")
    (wiki / "meta.json").write_text(json.dumps({
        "slug": slug, "version": 1,
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "docs": meta_docs}, indent=2, ensure_ascii=False), encoding="utf-8")
    return wiki


def export_wiki(wiki_path, senza_raw=False) -> Path:
    """Zip stile Annota (md + images/): fratello della cartella wiki."""
    wiki = Path(wiki_path)
    if not (wiki / "index.md").exists():
        raise ValueError(f"non una wiki: {wiki}")
    base = wiki.parent.parent / wiki.name if wiki.parent.name == "wiki" else wiki.with_suffix("")
    zip_path = base.with_name(base.name + ("-senza-raw" if senza_raw else "") + ".zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(wiki.rglob("*")):
            if not f.is_file():
                continue
            rel = f.relative_to(wiki)
            if senza_raw and rel.parts[0] == "raw":
                continue
            z.write(f, f"{wiki.name}/{rel.as_posix()}")
    return zip_path


def stem_of(name: str) -> str:
    """Stem normalizzato per il match raw<->doc (stessa regola UI slugStem)."""
    base = re.sub(r"\.[^.]+$", "", str(name))
    return slugify(base)


def resolve_pair(meta_docs: list, raw_names: list, identifier: str) -> dict:
    """Risolve Pair{doc,raw} da un identificatore doc-file, voce o raw-name.
    Preferisce il campo meta `raw`, fallback allo stem match."""
    ident = str(identifier)
    # 1) match diretto doc file o nome voce
    for d in meta_docs:
        if ident in (d.get("file"), d.get("name"), Path(d.get("file", "")).stem):
            raw = d.get("raw") or ""
            if not raw:
                st = stem_of(Path(d.get("file", "")).name)
                for r in raw_names:
                    if stem_of(r) == st or stem_of(d.get("name", "")) == stem_of(r):
                        raw = f"raw/{r}" if not r.startswith("raw/") else r
                        break
            return {"doc": d.get("file"), "raw": raw, "name": d.get("name")}
    # 2) match raw -> doc
    rbase = ident.split("/")[-1]
    for d in meta_docs:
        if (d.get("raw") or "").split("/")[-1] == rbase:
            return {"doc": d.get("file"), "raw": d.get("raw"), "name": d.get("name")}
    for d in meta_docs:
        if stem_of(Path(d.get("file", "")).name) == stem_of(rbase) or \
           stem_of(d.get("name", "")) == stem_of(rbase):
            raw = d.get("raw") or f"raw/{rbase}"
            return {"doc": d.get("file"), "raw": raw, "name": d.get("name")}
    return {"doc": "", "raw": f"raw/{rbase}" if rbase else "", "name": ""}
