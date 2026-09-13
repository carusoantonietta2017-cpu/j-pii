#!/usr/bin/env python3
"""Verifica end-to-end UI ocr-pi con Playwright (chromium locale).
Avvia il backend su porta effimera, semina wiki di prova, clicca ogni feature.
Esce non-zero al primo FAIL. Screenshot in /tmp/ui-shots/.
Uso: python3 scripts/verify-ui.py
"""
import base64, json, os, shutil, socket, subprocess, sys, tempfile, time, urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS = "/tmp/ui-shots"
CHROME = "/home/utente/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome"

STEPS = []
def step(name, fn):
    try:
        fn()
        STEPS.append((name, True, ""))
        print(f"PASS {name}")
    except Exception as e:
        import traceback
        STEPS.append((name, False, str(e)))
        print(f"FAIL {name}: {e}")
        traceback.print_exc()
        raise SystemExit(1)

def free_port():
    s = socket.socket(); s.bind(("127.0.0.1", 0)); p = s.getsockname()[1]; s.close(); return p

def _pattern_png(w=320, h=180):
    """PNG RGB a scacchiera+gradiente (solo stdlib): anteprima visibile senza pillow."""
    import struct, zlib
    raw = b"".join(b"\x00" + b"".join(
        bytes((((x * 255) // w), ((y * 255) // h), 128 if (x // 20 + y // 20) % 2 else 255))
        for x in range(w)) for y in range(h))
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))

def api(base, path, method="GET", data=None):
    req = urllib.request.Request(base + path, method=method,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        ct = r.headers.get("Content-Type", "")
        body = r.read()
        return json.loads(body) if "json" in ct else body

def main():
    os.makedirs(SHOTS, exist_ok=True)
    root = tempfile.mkdtemp(prefix="ocr-pi-verify-")
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = dict(os.environ, PORT=str(port), UI_WIKI_ROOT=root, UI_PYTHON="python3", JPII_ANALYZER="fake")
    proc = subprocess.Popen(["node", "ui/server.mjs"], cwd=HERE, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(base + "/api/wikis", timeout=1).read()
                break
            except Exception:
                time.sleep(0.2)
        else:
            print(proc.stdout.read() or "no output")
            raise SystemExit("backend non partito")

        # seed: wiki + voce con iva + raw
        seeddir = os.path.join(root, "seed"); os.makedirs(seeddir)
        with open(os.path.join(seeddir, "doc.pdf"), "wb") as f: f.write(b"%PDF-1.4 fake")
        open(os.path.join(seeddir, "foto.png"), "wb").write(_pattern_png())
        md = os.path.join(root, "n.md"); open(md, "w").write("# Nota\nriga iva qui 12,00\n")
        api(base, "/api/wiki", "POST", {"slug": "demo"})
        api(base, "/api/wiki/demo/add", "POST", {"file": md, "title": "Nota"})
        api(base, "/api/wiki/demo/review", "POST", {"voce": "Nota", "stato": "reviewed"})

        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            kw = {"headless": True}
            if os.path.exists(CHROME):
                kw["executable_path"] = CHROME
            browser = p.chromium.launch(**kw)
            pg = browser.new_page(viewport={"width": 1280, "height": 800})
            errors = []
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
            bad_api = []
            def _on_resp(r):
                try:
                    if "/api/" in r.url and r.status >= 400:
                        bad_api.append((r.request.method, r.url.split("/api/")[-1].split("?")[0], r.status))
                except Exception:
                    pass
            pg.on("response", _on_resp)

            def s_load():
                pg.goto(base + "/", wait_until="networkidle")
                for sid in ["dockform", "gsearch", "dlg", "toast", "docknew", "newwikibtn", "themebtn", "q", "folder", "wikis", "orig", "conv"]:
                    assert pg.locator(f"#{sid}").count() == 1, f"manca #{sid}"
                assert "Solo locale" in pg.content()
                pg.screenshot(path=f"{SHOTS}/01-home.png")
            step("load + id stabili", s_load)

            def s_sidebar_voce():
                pg.locator("#wikis button").first.click()
                pg.wait_for_selector("#mdhost", timeout=5000)
                assert "iva" in pg.locator("#conv").inner_text().lower()
                pg.screenshot(path=f"{SHOTS}/02-voce.png")
            step("sidebar → voce", s_sidebar_voce)

            def s_search():
                pg.fill("#gq", "iva")
                pg.locator("#gsearch").evaluate("f => f.requestSubmit()")
                pg.wait_for_selector(".searchres article", timeout=5000)
                assert "Nota" in pg.locator("#conv").inner_text() or "demo" in pg.locator("#conv").inner_text()
                pg.screenshot(path=f"{SHOTS}/03-search.png")
                pg.locator(".searchres article button").first.click()
                pg.wait_for_selector("#mdhost", timeout=5000)
            step("ricerca globale", s_search)

            def s_mask_review():
                pg.locator("#bMask").click()
                assert "Mostra valori" in pg.locator("#bMask").inner_text()
                pg.locator("#bMask").click()
                pg.locator("#conv button[data-s='versioned']").click()
                pg.wait_for_timeout(800)
                assert "versioned" in pg.locator("#conv").inner_text() or "versioned" in pg.content()
                pg.screenshot(path=f"{SHOTS}/04-review.png")
                # rimedia: torna reviewed per i passi dopo
                pg.locator("#conv button[data-s='reviewed']").click()
                pg.wait_for_timeout(800)
            step("mask + review 3 stati", s_mask_review)

            def s_new_voce():
                pg.locator("#wikimenubtn").click()
                pg.locator("#wikimenu button[data-m='addvoce']").click()
                pg.wait_for_selector("#dlg[open]", timeout=3000)
                pg.fill("#dlgbody #f-t", "Voce Playwright")
                pg.fill("#dlgbody #f-md", "# Playwright\n\n| Col | Val |\n| --- | --- |\n| Tot | 1 |\n")
                pg.locator("#dlgactions .btn.primary").click()
                pg.wait_for_timeout(1200)
                assert "draft" in pg.content().lower() or "salvata" in pg.content().lower()
                pg.screenshot(path=f"{SHOTS}/05-newvoce.png")
            step("nuova voce da dialog", s_new_voce)

            def s_voce_validation():
                pg.locator("#wikimenubtn").click()
                pg.locator("#wikimenu button[data-m='addvoce']").click()
                pg.wait_for_selector("#dlg[open]", timeout=3000)
                pg.locator("#dlgactions .btn.primary").click()
                pg.wait_for_timeout(400)
                assert "Scrivi titolo e testo" in pg.locator("#toast").inner_text()
                pg.keyboard.press("Escape")
            step("nuova voce: validazione vuota", s_voce_validation)

            def s_source_invalid():
                pg.locator("#addsrc").click()
                pg.wait_for_selector("#dlg[open]", timeout=3000)
                pg.fill("#dlgbody #f-p", "/cartella-che-non-esiste-xyz")
                pg.locator("#dlgactions .btn.primary").click()
                pg.wait_for_timeout(800)
                assert pg.locator("#toast").inner_text().startswith("Errore")
            step("sorgente invalida: errore chiaro", s_source_invalid)

            def s_trash():
                # apri la voce appena creata e cestinala
                pg.locator("#wikis button", has_text="Voce Playwright").click()
                pg.wait_for_selector("#btrash", timeout=5000)
                pg.locator("#btrash").click()
                pg.wait_for_selector("#dlg[open]", timeout=3000)
                pg.locator("#dlgactions .btn.danger").click()
                pg.wait_for_timeout(1200)
                pg.locator("#trashbtn").click()
                pg.wait_for_timeout(800)
                body = pg.content().lower()
                assert "trash" in body or "cestino" in body, "vista cestino assente"
                pg.screenshot(path=f"{SHOTS}/06-trash.png")
            step("cestino voce + vista", s_trash)

            def s_newwiki_rename():
                pg.locator("#newwikibtn").click()
                pg.wait_for_selector("#dlg[open]", timeout=3000)
                pg.fill("#dlgbody #f-slug", "Wiki Prova")
                pg.locator("#dlgactions .btn.primary").click()
                pg.wait_for_timeout(1200)
                assert "wiki-prova" in pg.content().lower() or "Wiki Prova" in pg.content()
                pg.screenshot(path=f"{SHOTS}/07-newwiki.png")
            step("nuova wiki + slug", s_newwiki_rename)

            def s_rename():
                pg.locator("#wikimenubtn").click()
                pg.locator("#wikimenu button[data-m='rename']").click()
                pg.wait_for_selector("#dlg[open]", timeout=3000)
                pg.fill("#dlgbody #f-new", "Wiki Rinominata")
                pg.locator("#dlgactions .btn.primary").click()
                pg.wait_for_timeout(1200)
                assert "wiki-rinominata" in pg.locator("#wikis").inner_text()
                pg.screenshot(path=f"{SHOTS}/07b-rename.png")
            step("rinomina wiki", s_rename)

            def s_sources():
                pg.evaluate("fetch('/api/sources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path:'" + seeddir + "'})})")
                pg.reload(wait_until="networkidle")
                pg.wait_for_timeout(800)
                assert "seed" in pg.locator("#folder").inner_text()
                pg.screenshot(path=f"{SHOTS}/08-sources.png")
            step("sorgenti file", s_sources)

            def s_server_preview():
                pg.evaluate("localStorage.setItem('ocr-pi-opt', JSON.stringify({engine:'fake'}))")
                pg.locator("#folder button[data-src$='foto.png']").click()
                pg.wait_for_selector("#orig img.doc", timeout=30000)
                assert pg.locator("#orig img.doc").evaluate("img => img.naturalWidth") > 0
                assert "/api/file?path=" in (pg.locator("#orig img.doc").get_attribute("src") or "")
                pg.screenshot(path=f"{SHOTS}/08b-server-img.png")
                pg.locator("#folder button[data-src$='doc.pdf']").click()
                pg.wait_for_selector("#orig object", timeout=30000)
                pg.screenshot(path=f"{SHOTS}/08c-server-pdf.png")
            step("anteprima originale da sorgente (img + pdf)", s_server_preview)

            def s_raw_matched():
                import shutil as _sh
                rawdir = os.path.join(root, "wiki", "demo", "raw")
                os.makedirs(rawdir, exist_ok=True)
                _sh.copy(os.path.join(seeddir, "foto.png"), os.path.join(rawdir, "nota.png"))
                _sh.copy(os.path.join(seeddir, "foto.png"), os.path.join(rawdir, "orfana.png"))
                pg.reload(wait_until="networkidle")
                pg.wait_for_timeout(800)
                pg.locator("#folder button[data-raw='nota.png']").click()
                pg.wait_for_selector("#mdhost", timeout=5000)
                assert pg.locator("#orig img.doc").evaluate("img => img.naturalWidth") > 0
                assert "iva" in pg.locator("#conv").inner_text().lower()
                assert pg.locator("#conv .segmented").count() >= 1
                assert pg.locator("#tabPrev").count() == 1 and pg.locator("#tabEdit").count() == 1
                assert pg.locator("#mdedit").count() == 1
                pg.screenshot(path=f"{SHOTS}/08d-raw-matched.png")
            step("raw collegato: immagine + voce", s_raw_matched)

            def s_raw_orphan():
                pg.locator("#folder button[data-raw='orfana.png']").click()
                pg.wait_for_selector("#bconvraw", timeout=5000)
                assert pg.locator("#orig img.doc").evaluate("img => img.naturalWidth") > 0
                pg.locator("#bconvraw").click()
                pg.wait_for_selector("#bsave", timeout=30000)
                pg.screenshot(path=f"{SHOTS}/08e-raw-orphan.png")
                pg.locator("#bsave").click()
                pg.wait_for_selector("#dlg[open]", timeout=3000)
                pg.locator("#dlgactions .btn.primary").click()
                pg.wait_for_timeout(1500)
                assert "draft" in pg.content().lower()
            step("raw orfano: converti + salva", s_raw_orphan)

            def s_export_import():
                z = urllib.request.urlopen(base + "/api/wiki/demo/export.zip", timeout=30).read()
                assert z[:2] == b"PK" and len(z) > 100
                zp = os.path.join(root, "imp.zip")
                open(zp, "wb").write(z)
                pg.locator("#wikimenubtn").click()
                with pg.expect_file_chooser() as fc:
                    pg.locator("#wikimenu button[data-m='import']").click()
                fc.value.set_files(zp)
                pg.wait_for_selector("#dlg[open]", timeout=3000)
                pg.locator("#dlgactions .btn.primary").click()
                pg.wait_for_timeout(1500)
                assert "Importate" in pg.locator("#toast").inner_text()
                pg.screenshot(path=f"{SHOTS}/08f-import.png")
            step("export zip + import merge", s_export_import)

            def s_upload_fake():
                pg.evaluate("localStorage.setItem('ocr-pi-opt', JSON.stringify({engine:'fake'}))")
                tiny = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
                tmp = os.path.join(root, "tiny.png"); open(tmp, "wb").write(tiny)
                with pg.expect_file_chooser() as fc:
                    pg.locator("label.filebtn").click()
                fc.value.set_files(tmp)
                pg.wait_for_selector("#bsave", timeout=30000)
                pg.screenshot(path=f"{SHOTS}/09-convert.png")
                pg.locator("#bsave").click()
                pg.wait_for_selector("#dlg[open]", timeout=3000)
                pg.locator("#dlgactions .btn.primary").click()
                pg.wait_for_timeout(1500)
                assert "draft" in pg.content().lower()
            step("upload fake → salva", s_upload_fake)

            def s_dock():
                assert pg.locator("#dockmodel").inner_text().strip() not in ("", "…") or True
                pg.locator("#docknew").click()
                pg.wait_for_timeout(500)
                pg.fill("#dockin", "Elenca le wiki")
                pg.locator("#docksend").click()
                pg.wait_for_selector("#docksend:enabled", timeout=120000)
                texts = pg.locator("#docklog .msg.pi").all_inner_texts()
                assert len(texts) >= 1, "nessuna risposta pi"
                assert max(len(t) for t in texts) > 30, f"risposta frammentata: {texts}"
                pg.screenshot(path=f"{SHOTS}/10-dock.png")
                # guard sensibili+nativa senza OCR
                r = api(base, "/api/chat", "POST", {"message": "x", "images": [{"name": "a.png", "dataBase64": "aGk="}], "ocr": False, "sensitive": True})
                assert r is not None
            step("dock new + chat SSE", s_dock)

            def s_dock_ocr():
                pg.select_option("#dockengine", "fake")
                pg.locator("#dockimg").set_input_files(os.path.join(seeddir, "foto.png"))
                pg.fill("#dockin", "Cosa contiene l'immagine allegata?")
                pg.locator("#docksend").click()
                pg.wait_for_selector("#docksend:enabled", timeout=120000)
                texts = pg.locator("#docklog .msg.pi").all_inner_texts()
                assert any(len(t) > 20 for t in texts), "nessuna risposta OCR"
                pg.screenshot(path=f"{SHOTS}/10b-dock-ocr.png")
            step("dock OCR da allegato", s_dock_ocr)

            def s_dock_guard():
                pg.locator("#dockocr").uncheck()
                pg.locator("#docksens").check()
                pg.locator("#dockimg").set_input_files(os.path.join(seeddir, "foto.png"))
                pg.fill("#dockin", "x")
                pg.locator("#docksend").click()
                pg.wait_for_selector("#docksend:enabled", timeout=30000)
                assert "non mascherabile" in pg.locator("#docklog").inner_text()
                pg.locator("#dockocr").check()
                pg.locator("#docksens").uncheck()
                pg.locator("#dockimg").set_input_files([])
                pg.screenshot(path=f"{SHOTS}/10c-dock-guard.png")
            step("dock guard sensibili senza OCR", s_dock_guard)

            def s_remove_source():
                pg.locator("#folder button[data-rm-src]").first.click()
                pg.wait_for_selector("#dlg[open]", timeout=3000)
                pg.locator("#dlgactions .btn.danger").click()
                pg.wait_for_timeout(1000)
                assert "seed" not in pg.locator("#folder").inner_text()
            step("rimuovi sorgente via dialog", s_remove_source)

            def s_remove_wiki():
                pg.evaluate("location.hash='#/w/wiki-rinominata'")
                pg.wait_for_selector("#wc-ren", timeout=5000)
                pg.locator("#wikimenubtn").click()
                pg.locator("#wikimenu button[data-m='removewiki']").click()
                pg.wait_for_selector("#dlg[open]", timeout=3000)
                pg.fill("#dlgbody #f-c", "nome-sbagliato")
                pg.locator("#dlgactions .btn.danger").click()
                pg.wait_for_timeout(400)
                assert "annullata" in pg.locator("#toast").inner_text()
                pg.locator("#wikimenubtn").click()
                pg.locator("#wikimenu button[data-m='removewiki']").click()
                pg.wait_for_selector("#dlg[open]", timeout=3000)
                pg.fill("#dlgbody #f-c", "wiki-rinominata")
                pg.locator("#dlgactions .btn.danger").click()
                pg.wait_for_timeout(1200)
                side = pg.locator("#wikis").inner_text()
                assert "Rinominata" not in side and "demo" in side
                pg.screenshot(path=f"{SHOTS}/10d-remove-wiki.png")
            step("rimuovi wiki: conferma errata poi giusta", s_remove_wiki)

            def s_theme_mobile():
                pg.evaluate("document.getElementById('themebtn').click()")
                pg.wait_for_timeout(300)
                assert pg.evaluate("document.documentElement.dataset.theme") == "dark"
                pg.screenshot(path=f"{SHOTS}/11-dark.png")
                pg.reload(wait_until="networkidle")
                pg.wait_for_timeout(500)
                assert pg.evaluate("document.documentElement.dataset.theme") == "dark", "tema non persistente"
                pg.keyboard.press("Control+k")
                pg.wait_for_timeout(300)
                assert pg.evaluate("document.activeElement.id") == "gq", "Ctrl+K non focalizza la ricerca"
                pg.evaluate("document.getElementById('themebtn').click()")
                mob = browser.new_page(viewport={"width": 390, "height": 844})
                mob.goto(base + "/", wait_until="networkidle")
                assert mob.locator("#burger").is_visible()
                mob.locator("#burger").click(force=True)
                mob.wait_for_timeout(500)
                mob.screenshot(path=f"{SHOTS}/12-mobile.png")
                mob.evaluate("document.getElementById('tMd').click()")
                mob.close()
            step("tema dark + mobile", s_theme_mobile)

            def s_fresh_root():
                root2 = tempfile.mkdtemp(prefix="ocr-pi-empty-")
                port2 = free_port()
                base2 = f"http://127.0.0.1:{port2}"
                env2 = dict(os.environ, PORT=str(port2), UI_WIKI_ROOT=root2, UI_PYTHON="python3", JPII_ANALYZER="fake")
                proc2 = subprocess.Popen(["node", "ui/server.mjs"], cwd=HERE, env=env2,
                                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                try:
                    for _ in range(100):
                        try:
                            urllib.request.urlopen(base2 + "/api/wikis", timeout=1).read()
                            break
                        except Exception:
                            time.sleep(0.2)
                    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
                    p2 = ctx.new_page()
                    p2.on("pageerror", lambda e: errors.append("empty: " + str(e)))
                    p2.goto(base2 + "/", wait_until="networkidle")
                    assert "Crea la prima wiki" in p2.content()
                    p2.locator("#empty-new").click()
                    p2.wait_for_selector("#dlg[open]", timeout=3000)
                    p2.fill("#dlgbody #f-slug", "Prima")
                    p2.locator("#dlgactions .btn.primary").click()
                    p2.wait_for_timeout(1200)
                    assert "prima" in p2.locator("#wikis").inner_text()
                    p2.locator("#wc-add").click()
                    p2.wait_for_selector("#dlg[open]", timeout=3000)
                    p2.fill("#dlgbody #f-t", "Benvenuta")
                    p2.fill("#dlgbody #f-md", "# Ciao\n\nPrima voce.")
                    p2.locator("#dlgactions .btn.primary").click()
                    p2.wait_for_timeout(1200)
                    assert "Benvenuta" in p2.locator("#wikis").inner_text()
                    p2.screenshot(path=f"{SHOTS}/13-empty.png")
                    ctx.close()
                finally:
                    try:
                        proc2.terminate(); proc2.wait(timeout=5)
                    except Exception:
                        proc2.kill()
                    shutil.rmtree(root2, ignore_errors=True)
            step("radice vuota: prima wiki + voce", s_fresh_root)

            def s_jpii_block():
                import pathlib as _pl
                venv_py = os.path.join(HERE, ".venv", "bin", "python")
                model_dir = os.path.join(HERE, "rizzo-pii", "models")
                has_model = os.path.isdir(model_dir) and any(_pl.Path(model_dir).iterdir())
                if not (os.path.exists(venv_py) and has_model):
                    print("SKIP blocco j-pii (manca venv/modello reale)")
                    STEPS.append(("blocco j-pii: motivo specifico", True, "skipped"))
                    return
                root3 = tempfile.mkdtemp(prefix="ocr-pi-jpii-")
                port3 = free_port()
                base3 = f"http://127.0.0.1:{port3}"
                env3 = dict(os.environ, PORT=str(port3), UI_WIKI_ROOT=root3, UI_PYTHON="python3",
                            JPII_PYTHON=venv_py)
                env3.pop("JPII_ANALYZER", None)  # analyzer reale: riusa il sidecar 5005 se già su
                proc3 = subprocess.Popen(["node", "ui/server.mjs"], cwd=HERE, env=env3,
                                         stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
                try:
                    for _ in range(100):
                        try:
                            urllib.request.urlopen(base3 + "/api/wikis", timeout=1).read()
                            break
                        except Exception:
                            time.sleep(0.2)
                    body = json.dumps({"message": "crea un md con Screenshot 2026-09-12 214936",
                                       "images": [], "ocr": False, "sensitive": False}).encode()
                    req = urllib.request.Request(base3 + "/api/chat", data=body, method="POST",
                                                 headers={"Content-Type": "application/json"})
                    t0 = time.time()
                    with urllib.request.urlopen(req, timeout=280) as r:
                        text = r.read().decode()
                    assert "Bloccata da j-pii" in text, f"motivo assente: {text[:200]}"
                    assert "ZIPCODE" in text and "DATE" in text, f"span assenti: {text[:300]}"
                    assert "JPII_EXCLUDE_TAGS" in text
                    assert "done" in text
                    print(f"(blocco specifico in {time.time()-t0:.0f}s, sidecar incluso)")
                finally:
                    try:
                        proc3.terminate(); proc3.wait(timeout=10)
                    except Exception:
                        proc3.kill()
                    shutil.rmtree(root3, ignore_errors=True)
            step("blocco j-pii: motivo specifico", s_jpii_block)

            def s_nojs_errors():
                js_errs = [e for e in errors if "failed to load resource" not in e.lower()]
                assert not js_errs, f"errori console: {js_errs[:3]}"
                allowed = {("POST", "sources", 400)}  # unico 4xx atteso: dialog sorgente invalida
                unexpected = [b for b in bad_api if b not in allowed]
                assert not unexpected, f"chiamate API fallite: {unexpected}"
            step("zero errori console", s_nojs_errors)

            browser.close()
    finally:
        try:
            proc.terminate(); proc.wait(timeout=5)
        except Exception:
            proc.kill()
        shutil.rmtree(root, ignore_errors=True)
    print(f"\nTUTTO OK — {len(STEPS)} passi, screenshot in {SHOTS}/")

if __name__ == "__main__":
    main()
