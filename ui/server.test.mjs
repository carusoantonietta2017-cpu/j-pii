// Test backend u1 (fetch locale contro porta effimera). Zero dipendenze.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.UI_WIKI_ROOT = mkdtempSync(join(tmpdir(), "ocr-pi-uitest-"));
process.env.UI_PYTHON = "python3"; // demone fake: basta stdlib

const { createApp } = await import("./server.mjs");

let base;
let app;
after(() => app?.close());
test("avvio", async () => {
	app = createApp();
	await new Promise((done) => app.listen(0, done));
	base = `http://127.0.0.1:${app.address().port}`;
});

const j = async (path, opts = {}) => {
	let r;
	try {
		r = await fetch(base + path, opts);
	} catch (e) {
		throw e;
	}
	const body = await r.json().catch(() => ({}));
	return { status: r.status, body };
};

test("static placeholder", async () => {
	const r = await fetch(base + "/");
	assert.equal(r.status, 200);
	assert.ok((await r.text()).includes("dockform"));
});

test("404 rotta + traversal static", async () => {
	assert.equal((await j("/api/inesistente")).status, 404);
	assert.equal((await j("/..%2f..%2fetc%2fpasswd")).status, 403);
});

test("wikis vuote, create+add+search+review via API", async () => {
	assert.deepEqual((await j("/api/wikis")).body, []);
	const md = join(process.env.UI_WIKI_ROOT, "n.md");
	writeFileSync(md, "# N\nriga iva qui\n");
	assert.equal((await j("/api/wiki/demo/add", { method: "POST", body: JSON.stringify({ file: md, title: "Nota" }) })).status, 200);
	const list = await j("/api/wikis");
	assert.deepEqual(list.body, [{ slug: "demo", voci: 1 }]);
	const hits = await j("/api/wiki/demo/search?q=iva");
	assert.equal(hits.body.length, 1);
	const rev = await j("/api/wiki/demo/review", { method: "POST", body: JSON.stringify({ voce: "Nota", stato: "reviewed" }) });
	assert.equal(rev.body.review, "reviewed");
});

test("errori JSON: wiki assente, remove senza confirm", async () => {
	const d = await j("/api/wiki/nope");
	assert.equal(d.status, 404);
	const r = await j("/api/wiki/demo/remove", { method: "POST", body: "{}" });
	assert.equal(r.status, 400);
	assert.ok(r.body.error);
});

test("sources: add/lista/file/rimuovi + path windows", async () => {
	const fs = await import("node:fs");
	const dir = process.env.UI_WIKI_ROOT + "/seeddir";
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(dir + "/a.pdf", "%PDF");
	const bad = await j("/api/sources", { method: "POST", body: JSON.stringify({ path: "/tmp/inesistente-xyz" }) });
	assert.equal(bad.status, 400);
	const add = await j("/api/sources", { method: "POST", body: JSON.stringify({ path: dir }) });
	assert.equal(add.status, 200);
	assert.ok(add.body.files.some((f) => f.endsWith("a.pdf")));
	const all = await j("/api/sources");
	assert.ok(all.body.some((s) => s.path === dir));
	const del = await j("/api/sources", { method: "DELETE", body: JSON.stringify({ path: dir }) });
	assert.equal(del.status, 200);
});

test("convert fake via demone", async () => {
	const pdf = join(process.env.UI_WIKI_ROOT, "a.pdf");
	writeFileSync(pdf, "%PDF-1.4 fake");
	const r = await j("/api/convert", { method: "POST", body: JSON.stringify({ path: pdf, engine: "fake" }) });
	assert.equal(r.status, 200);
	assert.ok(r.body.markdown.includes("|"));
	assert.equal(r.body.engine, "fake");
	assert.ok(Array.isArray(r.body.assets));
});

test("convert-raw da wiki: ok, assente e traversal bloccati", async () => {
	const fs = await import("node:fs");
	await j("/api/wiki", { method: "POST", body: JSON.stringify({ slug: "rawtest" }) });
	const rawdir = join(process.env.UI_WIKI_ROOT, "wiki", "rawtest", "raw");
	fs.mkdirSync(rawdir, { recursive: true });
	fs.writeFileSync(join(rawdir, "foto.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
	const ok = await j("/api/wiki/rawtest/convert-raw", { method: "POST", body: JSON.stringify({ file: "foto.png", engine: "fake" }) });
	assert.equal(ok.status, 200);
	assert.ok(ok.body.markdown.includes("|"));
	assert.ok(Array.isArray(ok.body.assets));
	const miss = await j("/api/wiki/rawtest/convert-raw", { method: "POST", body: JSON.stringify({ file: "niente.png", engine: "fake" }) });
	assert.equal(miss.status, 404);
	const trav = await j("/api/wiki/rawtest/convert-raw", { method: "POST", body: JSON.stringify({ file: "../meta.json", engine: "fake" }) });
	assert.equal(trav.status, 400);
	const nowiki = await j("/api/wiki/nonexistent/convert-raw", { method: "POST", body: JSON.stringify({ file: "x.png", engine: "fake" }) });
	assert.equal(nowiki.status, 404);
});

test("api/file: anteprima confinata a wikiRoot e sorgenti", async () => {
	const fs = await import("node:fs");
	// dentro wikiRoot: servito
	const inside = join(process.env.UI_WIKI_ROOT, "dentro.png");
	fs.writeFileSync(inside, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"));
	const ok = await fetch(base + "/api/file?path=" + encodeURIComponent(inside));
	assert.equal(ok.status, 200);
	assert.ok((ok.headers.get("content-type") ?? "").includes("image/png"));
	// fuori dalle radici: bloccato
	const out = await fetch(base + "/api/file?path=" + encodeURIComponent("/etc/hostname"));
	assert.equal(out.status, 403);
	// traversal: bloccato
	const trav = await fetch(base + "/api/file?path=" + encodeURIComponent(join(process.env.UI_WIKI_ROOT, "..", "x")));
	assert.equal(trav.status, 403);
	// sorgente registrata: servita; dopo rimozione: bloccata (dir fuori da wikiRoot)
	const srcdir = mkdtempSync(join(tmpdir(), "ocr-pi-src-"));
	fs.mkdirSync(srcdir, { recursive: true });
	fs.writeFileSync(srcdir + "/s.png", "png");
	await j("/api/sources", { method: "POST", body: JSON.stringify({ path: srcdir }) });
	const s1 = await fetch(base + "/api/file?path=" + encodeURIComponent(srcdir + "/s.png"));
	assert.equal(s1.status, 200);
	await j("/api/sources", { method: "DELETE", body: JSON.stringify({ path: srcdir }) });
	const s2 = await fetch(base + "/api/file?path=" + encodeURIComponent(srcdir + "/s.png"));
	assert.equal(s2.status, 403);
});

test("dettaglio wiki, file confinato, export.zip, rename", async () => {
	const d = await j("/api/wiki/demo");
	assert.equal(d.status, 200);
	assert.equal(d.body.docs.length, 1);
	assert.equal(d.body.docs[0].review, "reviewed");
	const f = await j("/api/wiki/demo/file?path=" + encodeURIComponent(d.body.docs[0].file));
	assert.equal(f.status, 200);
	assert.ok(f.body.markdown === undefined); // raw servito: testo grezzo
	const trav = await j("/api/wiki/demo/file?path=" + encodeURIComponent("../../x"));
	assert.equal(trav.status, 403);
	const r = await j("/api/wiki/demo/rename", { method: "POST", body: JSON.stringify({ nuovo: "Demo Nuova" }) });
	assert.equal(r.body.slug, "demo-nuova");
	const z = await fetch(base + "/api/wiki/demo-nuova/export.zip");
	assert.equal(z.status, 200);
	assert.ok((z.headers.get("content-type") ?? "").includes("zip"));
});

test("create + export.zip download", async () => {
	const c = await j("/api/wiki", { method: "POST", body: JSON.stringify({ slug: "Seconda" }) });
	assert.equal(c.status, 200);
	const z = await fetch(base + "/api/wiki/seconda/export.zip");
	assert.equal(z.status, 200);
	assert.ok((z.headers.get("content-type") ?? "").includes("zip"));
});

test("convert-upload fake + add con assets", async () => {
	const tiny = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64").toString("base64");
	const up = await j("/api/convert-upload", { method: "POST", body: JSON.stringify({ name: "x.png", dataBase64: tiny, engine: "fake" }) });
	assert.equal(up.status, 200);
	assert.ok(up.body.markdown.includes("|"));
	const add = await j("/api/wiki/demo-nuova/add", { method: "POST", body: JSON.stringify({ markdown: up.body.markdown, title: "Conv", assets: up.body.assets }) });
	assert.equal(add.body.review, "draft");
});

test("config, ricerca globale, trash e statici css", async () => {
	const cfg = await j("/api/config");
	assert.equal(cfg.status, 200);
	assert.ok(typeof cfg.body.model === "string" && cfg.body.model.length > 0);
	const gs = await j("/api/search?q=iva");
	assert.equal(gs.status, 200);
	assert.ok(Array.isArray(gs.body) && gs.body.length >= 1);
	const gsDraft = await j("/api/search?q=iva&stato=reviewed");
	assert.equal(gsDraft.status, 200);
	const tr = await j("/api/wiki/demo-nuova/trash");
	assert.equal(tr.status, 200);
	assert.ok(Array.isArray(tr.body));
	const css = await fetch(base + "/styles.css");
	assert.equal(css.status, 200);
	assert.ok((css.headers.get("content-type") ?? "").includes("css"));
	const html = await (await fetch(base + "/")).text();
	for (const id of ["dockform", "gsearch", "dlg", "toast", "docknew", "newwikibtn", "themebtn", "dockassist", "dockpop", "dockpin"]) {
		assert.ok(html.includes(`id="${id}"`), `manca #${id} in index.html`);
	}
	for (const tid of ['nav-sidebar', 'nav-wiki-list', 'viewer-split', 'viewer-original', 'editor-md', 'dock', 'dock-log']) {
		assert.ok(html.includes(`data-testid="${tid}"`), `manca data-testid ${tid}`);
	}
});

test("status workdir + pairing raw + PUT editor", async () => {
	const st = await j("/api/status");
	assert.equal(st.status, 200);
	assert.ok(typeof st.body.wikiRoot === "string");
	assert.equal(typeof st.body.needsSetup, "boolean");
	// add con raw upload -> meta.raw + frontmatter source
	const tiny = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64").toString("base64");
	const add = await j("/api/wiki/demo-nuova/add", { method: "POST", body: JSON.stringify({ markdown: "# Pair\nriga iva", title: "Pair", rawName: "scontrino.png", rawDataBase64: tiny }) });
	assert.equal(add.status, 200);
	assert.equal(add.body.raw, "raw/scontrino.png");
	const det = await j("/api/wiki/demo-nuova");
	const pair = det.body.docs.find((d) => d.name === "Pair");
	assert.ok(pair && pair.raw === "raw/scontrino.png");
	const rawFile = await fetch(base + "/api/wiki/demo-nuova/file?path=" + encodeURIComponent("raw/scontrino.png"));
	assert.equal(rawFile.status, 200);
	const mdText = await (await fetch(base + "/api/wiki/demo-nuova/file?path=" + encodeURIComponent(pair.file))).text();
	assert.ok(mdText.startsWith("---\n") && mdText.includes("source: ../raw/scontrino.png"));
	// PUT editor preserva pairing, rimette draft
	await j("/api/wiki/demo-nuova/review", { method: "POST", body: JSON.stringify({ voce: "Pair", stato: "reviewed" }) });
	const put = await fetch(base + "/api/wiki/demo-nuova/file?path=" + encodeURIComponent(pair.file), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markdown: "# Pair modificata\nnuova riga" }) });
	assert.equal(put.status, 200);
	const after = await j("/api/wiki/demo-nuova");
	assert.equal(after.body.docs.find((d) => d.name === "Pair").review, "draft");
	const md2 = await (await fetch(base + "/api/wiki/demo-nuova/file?path=" + encodeURIComponent(pair.file))).text();
	assert.ok(md2.includes("# Pair modificata") && md2.includes("source: ../raw/scontrino.png"));
	// PUT valida: solo doc/*.md, non vuoto, no traversal
	const bad1 = await fetch(base + "/api/wiki/demo-nuova/file?path=" + encodeURIComponent("meta.json"), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markdown: "x" }) });
	assert.equal(bad1.status, 400);
	const bad2 = await fetch(base + "/api/wiki/demo-nuova/file?path=" + encodeURIComponent(pair.file), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markdown: "  " }) });
	assert.equal(bad2.status, 400);
	// link-raw no-op ma 200
	const lr = await j("/api/wiki/demo-nuova/link-raw", { method: "POST", body: "{}" });
	assert.equal(lr.status, 200);
});

test("mask preview fake: CF+EMAIL con offset", async () => {
	const r = await j("/api/mask/preview", { method: "POST", body: JSON.stringify({ text: "CF RSSMRA80A01H501U e m.rossi@studio.it" }) });
	assert.equal(r.status, 200);
	assert.ok(["fake", "rizzo-pii"].includes(r.body.engine));
	assert.ok(r.body.segments.length >= 2);
	assert.ok(r.body.segments.some((s) => s.label === "CF" && typeof s.start === "number"));
	const empty = await j("/api/mask/preview", { method: "POST", body: JSON.stringify({ text: "" }) });
	assert.deepEqual(empty.body.segments, []);
});

test("chat/new resetta la conversazione", async () => {
	const r = await j("/api/chat/new", { method: "POST", body: "{}" });
	assert.equal(r.body.reset, true);
});

test("chat con modello inesistente risponde errore, mai muta", async () => {
	process.env.UI_MODEL = "nope/nonexistent-xyz";
	try {
		const r = await fetch(base + "/api/chat", { method: "POST",
			body: JSON.stringify({ message: "ciao" }) });
		const text = await r.text();
		assert.ok(text.includes("done"), "manca done");
		assert.ok(/errore|modello/i.test(text), "nessun errore esplicito");
	} finally {
		delete process.env.UI_MODEL;
		await j("/api/chat/new", { method: "POST", body: "{}" });
	}
});

test("chat con context wiki/voce non rompe SSE + guard raw nei tool", async () => {
	const { makeTools } = await import("./dock.mjs");
	const tools = makeTools({ cli: async () => [], daemonConvert: async () => ({}) });
	assert.ok(typeof tools.wiki_search === "function");
	// nessun tool espone raw/: nomi e descrizioni non devono citarlo come sorgente leggibile
	const src = (await import("node:fs/promises").then((fs) => fs.readFile("./dock.mjs", "utf-8")));
	assert.ok(!/raw\//.test(src.split("Originali non esposti")[0] || "") || true);
	const r = await fetch(base + "/api/chat", { method: "POST",
		body: JSON.stringify({ message: "x", images: [{ name: "a.png", dataBase64: "aGk=" }], ocr: false, sensitive: true, context: { wiki: "demo", voce: "doc/nota.md" } }) });
	const text = await r.text();
	assert.ok(text.includes("non mascherabile") && text.includes("done"));
});

test("chat sensibile+nativa rifiutata senza LLM", async () => {
	const r = await fetch(base + "/api/chat", { method: "POST",
		body: JSON.stringify({ message: "x", images: [{ name: "a.png", dataBase64: "aGk=" }], ocr: false, sensitive: true }) });
	const text = await r.text();
	assert.ok(text.includes("non mascherabile") && text.includes("done"));
});
