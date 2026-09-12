// PWA ocr-pi (u2): sidebar Folder/Wiki, split, review, menu, dock echo. Dati reali via API.
const $ = (id) => document.getElementById(id);
const state = { wikis: [], details: {}, sel: null }; // sel = {wiki, file}

async function api(path, opts = {}) {
	const r = await fetch(path, opts);
	const body = await r.json().catch(() => ({}));
	if (!r.ok) throw new Error(body.error || `errore ${r.status}`);
	return body;
}
const post = (path, data) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data ?? {}) });
const toast = (m) => { $("mtoast").textContent = m; };
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

function opts() {
	try {
		return JSON.parse(localStorage.getItem("ocr-pi-opt") || "{}");
	} catch {
		return {};
	}
}

// --- mini renderer markdown: tabelle, immagini, titoli, codice ---
function renderMd(md, fileUrl) {
	const dir = fileUrl.split("/").slice(0, -1).join("/");
	const lines = md.split("\n");
	let html = "", i = 0, inCode = false;
	const inlineImg = (t) => t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
		const u = src.startsWith("http") || src.startsWith("/") ? src : dir + "/" + src;
		return `<img class="doc" loading="lazy" alt="${esc(alt)}" src="${u}">`;
	});
	while (i < lines.length) {
		const l = lines[i];
		if (l.trim().startsWith("```")) { html += inCode ? "</pre>" : "<pre>"; inCode = !inCode; i++; continue; }
		if (inCode) { html += esc(l) + "\n"; i++; continue; }
		if (l.trim().startsWith("|") && lines[i + 1] && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
			const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => `<td>${inlineImg(esc(c.trim()))}</td>`).join("");
			const head = l.trim().replace(/^\||\|$/g, "").split("|").map((c) => `<th>${esc(c.trim())}</th>`).join("");
			html += `<div class="tablewrap"><table class="hl"><tr>${head}</tr>`;
			i += 2;
			while (i < lines.length && lines[i].trim().startsWith("|")) { html += `<tr>${cells(lines[i])}</tr>`; i++; }
			html += "</table></div>";
			continue;
		}
		const h = l.match(/^(#{1,3})\s+(.*)/);
		if (h) { const n = h[1].length + 1; html += `<h${n}>${inlineImg(esc(h[2]))}</h${n}>`; i++; continue; }
		if (l.trim()) html += `<p>${inlineImg(esc(l))}</p>`;
		i++;
	}
	return html || "<p>(vuoto)</p>";
}

const SENSITIVE = /[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

// --- sidebar ---
async function refresh() {
	const wikis = await api("/api/wikis");
	state.wikis = wikis.map((w) => w.slug);
	state.details = {};
	for (const slug of state.wikis) {
		try {
			state.details[slug] = await api("/api/wiki/" + encodeURIComponent(slug));
		} catch {
			state.details[slug] = { docs: [], trash: [], raw: [] };
		}
	}
	renderSide();
	if (!state.sel && state.wikis.length) {
		const d = state.details[state.wikis[0]];
		if (d.docs.length) select(state.wikis[0], d.docs[0].file);
	}
}

function renderSide(filter = "") {
	const q = filter.toLowerCase();
	const folder = $("folder");
	folder.innerHTML = "";
	for (const slug of state.wikis) {
		const d = state.details[slug];
		if (!d.raw.length) continue;
		folder.insertAdjacentHTML("beforeend", `<li><b>${esc(slug)}</b></li>`);
		for (const f of d.raw) {
			folder.insertAdjacentHTML("beforeend", `<li class="sub">raw/${esc(f)}</li>`);
		}
	}
	if (!folder.children.length) folder.innerHTML = "<li class='sub'>—</li>";
	const ul = $("wikis");
	ul.innerHTML = "";
	for (const slug of state.wikis) {
		const d = state.details[slug];
		ul.insertAdjacentHTML("beforeend", `<li><b>${esc(slug)}</b></li>`);
		for (const v of d.docs) {
			if (q && !(v.name.toLowerCase().includes(q))) continue;
			const sel = state.sel && state.sel.wiki === slug && state.sel.file === v.file ? " sel" : "";
			const mark = v.review === "reviewed" ? " ✓" : v.review === "versioned" ? " ✓✓" : "";
			ul.insertAdjacentHTML("beforeend", `<li class="sub${sel}"><button data-w="${esc(slug)}" data-f="${esc(v.file)}">${esc(v.name)}${mark}</button></li>`);
		}
	}
	ul.querySelectorAll("button").forEach((b) => { b.onclick = () => { select(b.dataset.w, b.dataset.f); document.body.classList.remove("nav"); }; });
	const trashN = Object.values(state.details).reduce((n, d) => n + (d.trash ? d.trash.length : 0), 0);
	$("trashn").textContent = trashN;
}

// --- split ---
async function select(wiki, file) {
	state.sel = { wiki, file };
	location.hash = `#/w/${encodeURIComponent(wiki)}/v/${encodeURIComponent(file)}`;
	renderSide($("q").value);
	const base = `/api/wiki/${encodeURIComponent(wiki)}`;
	const [meta, text] = await Promise.all([
		api(base),
		fetch(base + "/file?path=" + encodeURIComponent(file)).then((r) => { if (!r.ok) throw new Error("voce illeggibile"); return r.text(); }),
	]);
	const doc = (meta.docs || []).find((x) => x.file === file) || { name: file, review: "?" };
	const pill = SENSITIVE.test(text) ? '<span class="pill" title="possibili dati sensibili: canale LLM mascherato">sensibili</span>' : "";
	$("conv").innerHTML = `<h2>${esc(doc.name)} <span style="font-size:12px;color:#5f6368">${esc(doc.review || "")}</span>${pill}</h2>
		<div class="toolbar"><button class="primary" data-s="reviewed">Approva</button><button data-s="draft">Rimanda a draft</button>
		<button id="bMask" aria-pressed="false">Mostra Mask</button></div>
		<div id="mdhost">${renderMd(text, base + "/file?path=" + encodeURIComponent(file))}</div>
		<p id="toast" role="status"></p>`;
	$("conv").querySelectorAll("[data-s]").forEach((b) => { b.onclick = async () => {
		await post(`${base}/review`, { voce: doc.name, stato: b.dataset.s });
		$("toast").textContent = "stato: " + b.dataset.s;
		await refresh();
	}; });
	let masked = false;
	$("bMask").onclick = (e) => {
		masked = !masked;
		e.currentTarget.textContent = masked ? "Mostra valori" : "Mostra Mask";
		$("mdhost").innerHTML = renderMd(masked ? text.replace(/[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]/g, "[CF_1]").replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL_1]") : text, base + "/file?path=" + encodeURIComponent(file));
	};
	const raw = (meta.raw || [])[0];
	$("orig").innerHTML = raw
		? `<h2>originale</h2><p><a href="${base}/file?path=${encodeURIComponent("raw/" + raw)}">apri originale (${esc(raw)})</a></p>`
		: `<h2>originale</h2><p style="color:#5f6368">nessun originale allegato.</p>`;
}

// --- menu wiki ---
function currentWiki() {
	return (state.sel && state.sel.wiki) || state.wikis[0];
}
$("wikimenubtn").onclick = (e) => {
	const m = $("wikimenu");
	const open = !m.classList.contains("open");
	m.classList.toggle("open", open);
	e.currentTarget.setAttribute("aria-expanded", open);
};
$("wikimenu").addEventListener("click", async (e) => {
	const b = e.target.closest("button");
	if (!b) return;
	$("wikimenu").classList.remove("open");
	const w = currentWiki();
	if (!w) return toast("nessuna wiki");
	try {
		if (b.dataset.m === "export") location.href = `/api/wiki/${encodeURIComponent(w)}/export.zip`;
		else if (b.dataset.m === "export-slim") location.href = `/api/wiki/${encodeURIComponent(w)}/export.zip?senza_raw=1`;
		else if (b.dataset.m === "import") $("impick").click();
		else if (b.dataset.m === "rename") {
			const nuovo = prompt("Nuovo nome wiki:", w);
			if (nuovo) { await post(`/api/wiki/${encodeURIComponent(w)}/rename`, { nuovo }); await refresh(); }
		} else if (b.dataset.m === "new") {
			const nome = prompt("Nome nuova wiki:");
			if (nome) { await post("/api/wiki", { slug: nome }); state.sel = null; await refresh(); }
		}
		toast("fatto");
	} catch (err) {
		toast("errore: " + err.message);
	}
});

// --- converti da file ---
$("upick").addEventListener("change", async (e) => {
	const f = e.target.files[0];
	if (!f) return;
	toast("conversione in corso… (prima volta ~2 min)");
	try {
		const buf = await f.arrayBuffer();
		let binary = "";
		for (const b of new Uint8Array(buf)) binary += String.fromCharCode(b);
		const o = opts();
		const r = await post("/api/convert-upload", { name: f.name, dataBase64: btoa(binary), engine: o.engine || "docling", deskew: !!o.deskew });
		sessionStorage.setItem("ocr-pi-conv", JSON.stringify(r));
		$("conv").innerHTML = `<h2>${esc(f.name)} <span style="font-size:12px;color:#5f6368">anteprima non salvata</span></h2>
			<div class="toolbar"><button class="primary" id="bsave">Salva in wiki…</button></div>
			<div>${renderMd(r.markdown, "")}</div>`;
		$("bsave").onclick = async () => {
			const w = prompt("Wiki di destinazione:", currentWiki() || "demo");
			if (!w) return;
			await post(`/api/wiki/${encodeURIComponent(w)}/add`, { markdown: r.markdown, title: f.name.replace(/\.[^.]+$/, ""), assets: r.assets || [] });
			toast("salvata come draft");
			await refresh();
		};
		toast("convertita: premi Salva in wiki");
	} catch (err) {
		toast("errore: " + err.message);
	}
	e.target.value = "";
});

// --- opzioni motore/deskew ---
(function optionsBar() {
	const bar = document.createElement("div");
	bar.className = "toolbar";
	bar.innerHTML = `<label>Motore <select id="engine"><option>docling</option><option>fake</option></select></label>
		<label><input type="checkbox" id="deskew"> deskew</label>`;
	document.querySelector("main").prepend(bar);
	const o = opts();
	if (o.engine) bar.querySelector("#engine").value = o.engine;
	bar.querySelector("#deskew").checked = !!o.deskew;
	bar.addEventListener("change", () => {
		localStorage.setItem("ocr-pi-opt", JSON.stringify({ engine: bar.querySelector("#engine").value.trim(), deskew: bar.querySelector("#deskew").checked }));
	});
})();

// --- dock (echo fino a u3) ---
$("dockform").insertAdjacentHTML("beforebegin", `<div style="display:flex;gap:12px;padding:0 12px 4px;font-size:13px">
	<label><input type="checkbox" id="dockocr" checked> OCR immagini</label>
	<label><input type="checkbox" id="docksens"> sensibili (mask)</label>
	<label>allega <input type="file" id="dockimg" accept="image/*" aria-label="allega immagine"></label>
</div>`);
$("dockform").addEventListener("submit", async (e) => {
	e.preventDefault();
	const v = $("dockin").value.trim();
	const f = $("dockimg").files[0];
	if (!v && !f) return;
	$("dock").classList.add("open");
	$("docklog").insertAdjacentHTML("beforeend", `<div><b>tu:</b> ${esc(v)}</div>`);
	$("dockin").value = "";
	try {
		let images = [];
		if (f) {
			const buf = await f.arrayBuffer();
			let bin = "";
			for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
			images = [{ name: f.name, dataBase64: btoa(bin) }];
		}
		const r = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: v, images, ocr: $("dockocr").checked, sensitive: $("docksens").checked }) });
		$("dockimg").value = "";
		const text = await r.text();
		for (const line of text.split("\n")) {
			if (!line.startsWith("data: ")) continue;
			const ev = JSON.parse(line.slice(6));
			if (ev.type === "text_delta") $("docklog").insertAdjacentHTML("beforeend", `<div><b>pi:</b> ${esc(ev.delta)}</div>`);
		}
	} catch (err) {
		$("docklog").insertAdjacentHTML("beforeend", `<div><b>pi:</b> errore: ${esc(err.message)}</div>`);
	}
});

// --- chrome mobile/desktop ---
$("burger").onclick = () => document.body.classList.toggle("nav");
$("tPdf").onclick = () => setTab("pdf");
$("tMd").onclick = () => setTab("md");
function setTab(t) {
	$("split").dataset.tab = t;
	$("tPdf").setAttribute("aria-pressed", t === "pdf");
	$("tMd").setAttribute("aria-pressed", t === "md");
	const h = location.hash.replace(/\/tab\/\w+/, "") + `/tab/${t}`;
	history.replaceState(null, "", h);
}
$("q").addEventListener("input", (e) => renderSide(e.target.value));
$("docktoggle").onclick = () => $("dock").classList.toggle("open");

// --- avvio da hash ---
(function init() {
	const m = location.hash.match(/#\/w\/([^/]+)\/v\/(.+?)(\/tab\/(\w+))?$/);
	if (m) {
		if (m[4]) setTab(m[4]);
		refresh().then(() => select(decodeURIComponent(m[1]), decodeURIComponent(m[2])).catch(() => {}));
	} else {
		refresh().catch((e) => { $("conv").textContent = "errore backend: " + e.message + " (avvia ui/server.mjs)"; });
	}
})();
