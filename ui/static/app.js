// ocr-pi PWA: sidebar, split, ricerca globale, cestino, convert, dock. Dati reali via API.
const $ = (id) => document.getElementById(id);
const state = { wikis: [], details: {}, sources: [], sel: null, card: null, config: { model: "…" }, search: null };
const SENSITIVE = /[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const stripFrontmatter = (md) => String(md || '').replace(/^---\n[\s\S]*?\n---\n/, '');
const parseFrontmatter = (md) => {
  const m = String(md || '').match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
};
// Pair originale<->md: preferisce meta.raw, fallback stem match (stessa regola server)
const slugStem = (n) => String(n).toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');
const resolvePair = (docs, rawNames, identifier) => {
  const ident = String(identifier);
  for (const d of docs || []) {
    if (ident === d.file || ident === d.name) {
      let raw = d.raw || '';
      if (!raw) {
        const st = slugStem((d.file || '').split('/').pop());
        const hit = (rawNames || []).find((r) => slugStem(r) === st || slugStem(d.name || '') === slugStem(r));
        if (hit) raw = 'raw/' + hit;
      }
      return { doc: d.file, raw, name: d.name };
    }
  }
  const rbase = ident.split('/').pop();
  for (const d of docs || []) {
    if ((d.raw || '').split('/').pop() === rbase) return { doc: d.file, raw: d.raw, name: d.name };
  }
  for (const d of docs || []) {
    if (slugStem((d.file || '').split('/').pop()) === slugStem(rbase) || slugStem(d.name || '') === slugStem(rbase)) {
      return { doc: d.file, raw: d.raw || ('raw/' + rbase), name: d.name };
    }
  }
  return { doc: '', raw: rbase ? 'raw/' + rbase : '', name: '' };
};

async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  const ct = r.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await r.json().catch(() => ({})) : await r.text().catch(() => "");
  if (!r.ok) {
    const msg = body && typeof body === "object" ? body.error || `errore ${r.status}` : `errore ${r.status}`;
    throw new Error(msg);
  }
  return body;
}
const post = (path, data) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data ?? {}) });
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const shortPath = (p) => {
  const parts = String(p).replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length > 2 ? "…/" + parts.slice(-2).join("/") : String(p);
};
const slugPrev = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "wiki";
const fmtSec = (n) => new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 }).format(Number(n || 0));
let lastHash = location.hash;
function nav(h) {
  lastHash = h;
  if (location.hash !== h) location.hash = h;
}

let toastTimer = 0;
function toast(m) {
  const t = $("toast");
  t.textContent = m;
  t.classList.add("show");
  $("mtoast").textContent = m;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}
function opts() {
  try { return JSON.parse(localStorage.getItem("ocr-pi-opt") || "{}"); } catch { return {}; }
}
function saveOpts(o) { localStorage.setItem("ocr-pi-opt", JSON.stringify({ ...opts(), ...o })); }

/* ---------- dialog ---------- */
function openDialog({ title, bodyHTML, actions = [{ label: "Chiudi", value: null }] }) {
  return new Promise((resolve) => {
    const dlg = $("dlg");
    $("dlgtitle").textContent = title;
    $("dlgbody").innerHTML = bodyHTML;
    const box = $("dlgactions");
    box.innerHTML = "";
    const close = (v) => { dlg.close(); dlg.onclose = null; resolve(v); };
    for (const a of actions) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = a.label;
      b.className = "btn" + (a.kind === "primary" ? " primary" : a.kind === "danger" ? " danger" : "");
      b.onclick = () => {
        if (a.validate) {
          const err = a.validate($("dlgbody"));
          if (err) { toast(err); return; }
        }
        const val = a.collect ? a.collect($("dlgbody")) : a.value;
        close(val);
      };
      box.appendChild(b);
    }
    dlg.onclose = () => resolve(null);
    dlg.showModal();
    const first = $("dlgbody").querySelector("input, select, textarea");
    if (first) first.focus();
  });
}

/* ---------- markdown ---------- */
function renderMd(md, fileUrl) {
  // risolve asset relativi tipo assets/x.png rispetto al file md (via ?path=, con encoding corretto)
  const resolveImg = (src) => {
    const s = String(src).trim();
    if (/^(javascript|vbscript|data:text\/html)/i.test(s)) return null;
    if (s.startsWith("http") || s.startsWith("/") || s.startsWith("blob:") || s.startsWith("data:")) return s;
    const fu = String(fileUrl || "");
    const m = fu.match(/^(\/api\/wiki\/[^/]+)\/file\?path=(.+)$/);
    if (m) {
      try {
        const cur = decodeURIComponent(m[2]);
        const dir = cur.includes("/") ? cur.slice(0, cur.lastIndexOf("/")) : "";
        const joined = dir ? dir + "/" + s : s;
        return m[1] + "/file?path=" + encodeURIComponent(joined);
      } catch { /* fallback sotto */ }
    }
    const dir = fu.split("/").slice(0, -1).join("/");
    return dir ? dir + "/" + s : s;
  };
  const imgTag = (tok) => {
    const m = tok.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (!m) return esc(tok);
    const u = resolveImg(m[2]);
    if (u === null) return esc(m[1]);
    return `<img class="doc" loading="lazy" alt="${esc(m[1])}" src="${esc(u)}">`;
  };
  const inline = (raw) => {
    const parts = String(raw).split(/(!\[[^\]]*\]\([^)]+\))/g).map((tok, k) => (k % 2 ? imgTag(tok) : esc(tok))).join("");
    return parts.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|\W)\*([^*\n]+)\*/g, "$1<em>$2</em>");
  };
  const lines = String(md || "").split("\n");
  let html = "", i = 0, inCode = false, inList = false;
  const closeList = () => { if (inList) { html += "</ul>"; inList = false; } };
  while (i < lines.length) {
    const l = lines[i];
    if (l.trim().startsWith("```")) { closeList(); html += inCode ? "</pre>" : "<pre>"; inCode = !inCode; i++; continue; }
    if (inCode) { html += esc(l) + "\n"; i++; continue; }
    if (l.trim().startsWith("|") && lines[i + 1] && /^\|[\s:|-]+\|$/.test(lines[i + 1].trim())) {
      closeList();
      const row = (r, cell) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => `<${cell}>${inline(c.trim())}</${cell}>`).join("");
      html += `<div class="tablewrap"><table class="hl"><tr>${row(lines[i], "th")}</tr>`;
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith("|")) { html += `<tr>${row(lines[i], "td")}</tr>`; i++; }
      html += "</table></div>";
      continue;
    }
    const h = l.match(/^(#{1,3})\s+(.*)/);
    if (h) { closeList(); const n = h[1].length + 1; html += `<h${n}>${inline(h[2])}</h${n}>`; i++; continue; }
    const li = l.match(/^\s*[-*]\s+(.*)/);
    if (li) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${inline(li[1])}</li>`; i++; continue; }
    closeList();
    if (l.trim()) html += `<p>${inline(l)}</p>`;
    i++;
  }
  closeList();
  return html || "<p>(vuoto)</p>";
}

/* ---------- sidebar ---------- */
async function refresh() {
  const [wikis, sources, config] = await Promise.all([
    api("/api/wikis"),
    api("/api/sources").catch(() => []),
    api("/api/config").catch(() => ({ model: "…" })),
  ]);
  state.wikis = wikis.map((w) => w.slug);
  state.sources = sources;
  state.config = config;
  const badge = `${config.model || ""}`;
  $("modelbadge").textContent = badge;
  $("modelbadge").title = `Modello dock: ${badge}`;
  $("dockmodel").textContent = badge;
  state.details = {};
  await Promise.all(state.wikis.map(async (slug) => {
    try { state.details[slug] = await api("/api/wiki/" + encodeURIComponent(slug)); }
    catch { state.details[slug] = { docs: [], trash: [], raw: [] }; }
  }));
  renderSide();
  if (state.sel) {
    try { await select(state.sel.wiki, state.sel.file, { silent: true }); }
    catch { state.sel = null; emptySplit(); }
    return;
  }
  if (state.wikis.length) {
    const d = state.details[state.wikis[0]];
    if (d.docs.length) return select(state.wikis[0], d.docs[0].file);
  }
  emptySplit();
}

function emptySplit(msg) {
  state.card = null;
  renderCrumbs(null);
  $("orig").innerHTML = `<div class="empty"><div class="big" aria-hidden="true">📄</div><p>${esc(msg || "Scegli una voce dalla sidebar, oppure converti un file dal pulsante in alto.")}</p><p><button class="btn" id="empty-new">Crea la prima wiki…</button></p></div>`;
  $("conv").innerHTML = `<div class="empty"><div class="big" aria-hidden="true">🔍</div><p>Qui vedrai la trascrizione con tabelle evidenziate, anteprima mask e review a tre stati.</p></div>`;
  $("empty-new") && ($("empty-new").onclick = () => newWikiDialog());
}

function renderSide(filter = "") {
  const q = filter.toLowerCase();
  const folder = $("folder");
  folder.innerHTML = "";
  for (const s of state.sources || []) {
    const files = (s.files || []).filter((f) => !q || f.split("/").pop().toLowerCase().includes(q));
    folder.insertAdjacentHTML("beforeend", `<li class="grp"><span class="fname">${esc(shortPath(s.path))}</span><span class="count num">${files.length}</span><span class="rowbtns"><button class="mini" data-rm-src="${esc(s.path)}" title="Rimuovi sorgente">✕</button></span></li>`);
    for (const f of files) {
      const base = f.split("/").pop();
      folder.insertAdjacentHTML("beforeend", `<li class="sub"><button data-src="${esc(f)}" title="Converti ${esc(base)}"><span class="fname">${esc(base)}</span></button></li>`);
    }
  }
  for (const slug of state.wikis) {
    const d = state.details[slug];
    if (!d.raw.length) continue;
    const raws = d.raw.filter((f) => !q || f.toLowerCase().includes(q));
    if (!raws.length) continue;
    folder.insertAdjacentHTML("beforeend", `<li class="grp"><span class="fname">${esc(slug)} · raw</span></li>`);
    for (const f of raws) folder.insertAdjacentHTML("beforeend", `<li class="sub"><button data-wraw="${esc(slug)}" data-raw="${esc(f)}" title="Mostra ${esc(f)}"><span class="fname">raw/${esc(f)}</span></button></li>`);
  }
  folder.insertAdjacentHTML("beforeend", `<li class="sub"><button id="addsrc">+ Aggiungi cartella sorgente…</button></li>`);
  folder.querySelectorAll("button[data-src]").forEach((b) => { b.onclick = () => convertServerFile(b.dataset.src); });
  folder.querySelectorAll("button[data-wraw]").forEach((b) => { b.onclick = () => { selectRaw(b.dataset.wraw, b.dataset.raw); document.body.classList.remove("nav"); }; });
  folder.querySelectorAll("button[data-rm-src]").forEach((b) => {
    b.onclick = async (e) => {
      e.stopPropagation();
      const yes = await openDialog({
        title: "Rimuovi sorgente?",
        bodyHTML: `<p>Rimuovo <code>${esc(b.dataset.rmSrc)}</code> dalla sidebar? I file restano sul disco.</p>`,
        actions: [{ label: "Annulla", value: false }, { label: "Rimuovi", kind: "danger", value: true }],
      });
      if (!yes) return;
      try {
        await api("/api/sources", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: b.dataset.rmSrc }) });
        toast("Sorgente rimossa");
        await refresh();
      } catch (err) { toast("Errore: " + err.message); }
    };
  });
  folder.querySelector("#addsrc").onclick = () => addSourceDialog();
  const ul = $("wikis");
  ul.innerHTML = "";
  if (!state.wikis.length) ul.innerHTML = `<li class="dim">Nessuna wiki — premi “Nuova wiki”.</li>`;
  for (const slug of state.wikis) {
    const d = state.details[slug];
    const shown = d.docs.filter((v) => !q || v.name.toLowerCase().includes(q));
    ul.insertAdjacentHTML("beforeend", `<li class="grp"><span class="fname">${esc(slug)}</span><span class="count num">${d.docs.length}</span></li>`);
    for (const v of shown) {
      const sel = state.sel && state.sel.wiki === slug && state.sel.file === v.file ? " sel" : "";
      const mark = v.review === "reviewed" ? " · ✓" : v.review === "versioned" ? " · ✓✓" : "";
      ul.insertAdjacentHTML("beforeend", `<li class="sub${sel}"><button data-w="${esc(slug)}" data-f="${esc(v.file)}" title="${esc(v.name)}"><span class="fname">${esc(v.name)}${mark}</span><span class="st ${esc(v.review || "")}">${esc(v.review || "")}</span></button></li>`);
    }
  }
  ul.querySelectorAll("button").forEach((b) => { b.onclick = () => { select(b.dataset.w, b.dataset.f); document.body.classList.remove("nav"); }; });
  const trashN = Object.values(state.details).reduce((n, d) => n + (d.trash ? d.trash.length : 0), 0);
  $("trashn").textContent = trashN;
}

/* ---------- crumbs ---------- */
function renderCrumbs(sel, extra) {
  const c = $("crumbs");
  if (!sel) {
    c.innerHTML = state.search
      ? `<nav aria-label="Breadcrumb"><button class="linklike" id="cr-home">Wiki</button><span class="sep">/</span><b>Ricerca: “${esc(state.search.q)}”</b><span class="pill num">${state.search.hits.length} risultati</span><button class="mini" id="cr-clear">✕ chiudi</button></nav>`
      : `<nav aria-label="Breadcrumb"><span class="hint">Scegli una voce dalla sidebar, oppure converti un file.</span></nav>`;
    $("cr-home") && ($("cr-home").onclick = () => { state.search = null; emptySplit(); });
    $("cr-clear") && ($("cr-clear").onclick = () => { state.search = null; state.sel ? select(state.sel.wiki, state.sel.file) : emptySplit(); });
    return;
  }
  c.innerHTML = `<nav aria-label="Breadcrumb"><button class="linklike" id="cr-home">Wiki</button><span class="sep">/</span><button class="linklike" id="cr-wiki">${esc(sel.wiki)}</button><span class="sep">/</span><b>${esc(extra?.name || sel.file)}</b>${extra ? `<span class="pill ${extra.review === "reviewed" ? "ok" : extra.review === "versioned" ? "acc" : ""}">${esc(extra.review || "")}</span>` : ""}${extra?.sensitive ? `<span class="pill warn">sensibili</span>` : ""}</nav>`;
  $("cr-home").onclick = () => emptySplit();
  $("cr-wiki").onclick = () => showWikiCard(sel.wiki);
}

/* ---------- split ---------- */
async function select(wiki, file, { silent } = {}) {
  state.sel = { wiki, file };
  state.card = null;
  state.search = null;
  nav(`#/w/${encodeURIComponent(wiki)}/v/${encodeURIComponent(file)}`);
  renderSide($("q").value);
  if (!silent) {
    $("orig").innerHTML = `<div class="skel" style="height:120px"></div>`;
    $("conv").innerHTML = `<div class="skel" style="height:120px"></div><div class="skel" style="height:60px;margin-top:8px"></div>`;
  }
  try {
    const base = `/api/wiki/${encodeURIComponent(wiki)}`;
    const [meta, text] = await Promise.all([
      api(base),
      fetch(base + "/file?path=" + encodeURIComponent(file)).then((r) => { if (!r.ok) throw new Error("Voce illeggibile: scegli un’altra voce"); return r.text(); }),
    ]);
    const doc = (meta.docs || []).find((x) => x.file === file) || { name: file, review: "?" };
    const body = stripFrontmatter(text);
    const fm = parseFrontmatter(text);
    const pair = resolvePair(meta.docs || [], meta.raw || [], file);
    const pairedRaw = (doc.raw || pair.raw || fm.source?.replace(/^\.\.\//, '') || '').replace(/^raw\//, '');
    const sensitive = SENSITIVE.test(body);
    renderCrumbs({ wiki, file }, { ...doc, sensitive });
    $("conv").innerHTML = `<h2>${esc(doc.name)}</h2>
      <div class="toolbar">
        <button class="btn small" id="bOpt" aria-expanded="false">Opzioni</button>
        <button class="btn small" id="bMask" aria-pressed="false">Anteprima mask locale</button>
        <span class="hint">Pagine <b class="num">${doc.pages ?? 0}</b> · motore <b>${esc(doc.engine || "—")}</b> · <span class="num">${fmtSec(doc.seconds)} s</span></span>
      </div>
      <div id="optpanel" aria-label="Opzioni di conversione future">
        <div class="grid">
          <label>Motore<select id="engine"><option>docling</option><option>fake</option></select></label>
          <label>Pagine<input id="pages" type="text" inputmode="numeric" autocomplete="off" placeholder="Tutte, es. 1-3…" aria-label="Pagine da convertire"></label>
          <label style="align-content:end"><span><input type="checkbox" id="deskew"> Raddrizza foto storte</span></label>
        </div>
        <div class="hint">Le opzioni valgono per le prossime conversioni (upload, sorgenti, originali wiki). I modelli restano in locale, mai in rete.</div>
      </div>
      <div class="toolbar" role="tablist" aria-label="Modo editor">
        <div class="segmented" role="group" aria-label="Anteprima o modifica">
          <button id="tabPrev" aria-pressed="true">Anteprima</button>
          <button id="tabEdit" aria-pressed="false">Modifica</button>
        </div>
        <span class="hint" id="piiHint">Evidenzio PII come rizzo-pii…</span>
      </div>
      <div id="mdhost">${renderMd(body, base + "/file?path=" + encodeURIComponent(file))}</div>
      <div id="edithost" hidden>
        <label class="hint" for="mdedit">Markdown (frontmatter preservato in automatico)</label>
        <textarea id="mdedit" style="min-height:260px" spellcheck="false"></textarea>
        <div class="toolbar"><button class="btn primary small" id="bSave">Salva</button><button class="btn small" id="bCancel">Annulla</button><span class="hint">Salvataggio rimette <b>draft</b> se era approvata.</span></div>
      </div>
      <div class="card"><h3>Review</h3>
        <div class="segmented" role="group" aria-label="Stato di review">
          ${["draft", "reviewed", "versioned"].map((s) => `<button data-s="${s}" aria-pressed="${doc.review === s}"> ${s === "draft" ? "Draft" : s === "reviewed" ? "✓ Reviewed" : "✓✓ Versioned"}</button>`).join("")}
        </div>
        <span id="toast2" class="hint" role="status" aria-live="polite" style="margin-left:8px"></span>
        <div class="hint">Tutto nasce <b>draft</b>: esporta solo <b>reviewed</b> o superiore.</div>
      </div>
      <div class="dangerzone"><span class="hint">Voce errata?</span><button class="btn small danger" id="btrash">Sposta nel cestino…</button></div>`;
    const o = opts();
    if (o.engine) $("engine").value = o.engine;
    if (o.pages) $("pages").value = o.pages;
    $("deskew").checked = !!o.deskew;
    $("optpanel").addEventListener("change", () => {
      saveOpts({ engine: $("engine").value, pages: $("pages").value.trim(), deskew: $("deskew").checked });
      const dd = $("dockengine");
      if (dd) dd.value = $("engine").value;
    });
    $("bOpt").onclick = (e) => {
      const p = $("optpanel");
      const open = !p.classList.contains("open");
      p.classList.toggle("open", open);
      e.currentTarget.setAttribute("aria-expanded", open);
    };
    $("conv").querySelectorAll("[data-s]").forEach((b) => {
      b.onclick = async () => {
        $("toast2").textContent = "Salvataggio…";
        try {
          await post(`${base}/review`, { voce: doc.name, stato: b.dataset.s });
          $("toast2").textContent = `Stato: ${b.dataset.s}`;
          toast(`“${doc.name}” ora è ${b.dataset.s}`);
          await refresh();
        } catch (err) { $("toast2").textContent = ""; toast("Errore: " + err.message + " — riprova"); }
      };
    });
    let masked = false;
    let piiSegs = [];
    let piiEngine = "…";
    const paintPii = () => {
      if (masked) return;
      if (!$("mdhost")) return;
      let html = renderMd(body, base + "/file?path=" + encodeURIComponent(file));
      // evidenzia valori PII come rizzo-pii: wrap con <mark data-label>
      const seen = new Set();
      for (const s of piiSegs) {
        const val = body.slice(s.start, s.end);
        if (!val || val.length < 2 || seen.has(s.label + "\0" + val)) continue;
        seen.add(s.label + "\0" + val);
        const rx = esc(val);
        const cls = s.validated === false ? "pii doubtful" : "pii";
        html = html.split(rx).join(`<mark class="${cls}" data-label="${esc(s.label)}" title="${esc(s.label)}${s.validated === false ? " · doubtful: Mask it / Send in clear" : ""} — click per dettagli">${rx}</mark>`);
      }
      $("mdhost").innerHTML = html;
      $("mdhost").querySelectorAll("mark.pii").forEach((m) => {
        m.onclick = () => piiDialog(m.dataset.label, m.textContent);
      });
    };
    const loadPii = async () => {
      const myWiki = wiki, myFile = file;
      try {
        const r = await post("/api/mask/preview", { text: body });
        if (!state.sel || state.sel.wiki !== myWiki || state.sel.file !== myFile) return;
        if (!$("piiHint") || !$("mdhost")) return;
        piiSegs = r.segments || [];
        piiEngine = r.engine || "?";
        $("piiHint").textContent = piiSegs.length
          ? `${piiSegs.length} PII via ${piiEngine} — click su un valore per dettagli`
          : `Nessuna PII via ${piiEngine}`;
        paintPii();
      } catch {
        if (!state.sel || state.sel.wiki !== myWiki || state.sel.file !== myFile) return;
        if ($("piiHint")) $("piiHint").textContent = "PII non disponibile";
      }
    };
    loadPii();
    $("bMask").onclick = (e) => {
      masked = !masked;
      e.currentTarget.textContent = masked ? "Mostra valori" : "Anteprima mask locale";
      e.currentTarget.setAttribute("aria-pressed", masked);
      if (masked) {
        // mask locale sullo stesso body: placeholder come j-pii fake
        let t2 = body;
        const byLabel = {};
        for (const s of piiSegs.length ? piiSegs : [{ label: "CF" }, { label: "EMAIL" }]) {
          void s;
        }
        t2 = t2.replace(/[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]/g, "[CF_1]").replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "[EMAIL_1]");
        // se engine reale, maschera anche gli altri valori rilevati
        for (const s of piiSegs) {
          const val = body.slice(s.start, s.end);
          if (val && !/\[CF_1\]|\[EMAIL_1\]/.test(val)) {
            byLabel[s.label] = (byLabel[s.label] || 0) + 1;
            // usa contatore stabile per label solo se non già placeholder
            if (s.label !== "CF" && s.label !== "EMAIL") t2 = t2.split(val).join(`[${s.label}_1]`);
          }
        }
        $("mdhost").innerHTML = renderMd(t2, base + "/file?path=" + encodeURIComponent(file));
      } else paintPii();
    };
    // tabs Anteprima | Modifica (inline, PUT preserva pairing)
    $("mdedit").value = body;
    const setTab = (edit) => {
      $("tabPrev").setAttribute("aria-pressed", !edit);
      $("tabEdit").setAttribute("aria-pressed", edit);
      $("mdhost").hidden = edit;
      $("edithost").hidden = !edit;
      $("bMask").disabled = edit;
    };
    $("tabPrev").onclick = () => setTab(false);
    $("tabEdit").onclick = () => setTab(true);
    $("bCancel").onclick = () => { $("mdedit").value = body; setTab(false); };
    $("bSave").onclick = async () => {
      const v = $("mdedit").value;
      if (!v.trim()) return toast("Testo vuoto: nessuna modifica salvata");
      try {
        const fm = parseFrontmatter(text);
        const toSave = Object.keys(fm).length ? `---\n${Object.entries(fm).map(([k, val]) => `${k}: ${val}`).join("\n")}\n---\n\n${v}` : v;
        const r = await fetch(`/api/wiki/${encodeURIComponent(wiki)}/file?path=${encodeURIComponent(file)}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markdown: toSave }),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `errore ${r.status}`);
        toast("Salvata (torna draft se era approvata)");
        await select(wiki, file, { silent: true });
      } catch (err) { toast("Errore salvataggio: " + err.message); }
    };
    $("btrash").onclick = () => trashVoceDialog(wiki, doc.name);
    // originale accoppiato: prima il raw collegato (meta.raw/frontmatter), poi gli altri
    const raws = meta.raw || [];
    const isImg = (n) => /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(n);
    const others = (raws || []).filter((r) => r !== pairedRaw);
    const singleHtml = (rn) => isImg(rn)
      ? `<p><img class="doc" loading="lazy" alt="Originale ${esc(rn)}" src="${base}/file?path=${encodeURIComponent("raw/" + rn)}"></p><p><a class="btn small" href="${base}/file?path=${encodeURIComponent("raw/" + rn)}" download>Scarica ${esc(rn)}</a></p>`
      : `<p><a class="btn small" href="${base}/file?path=${encodeURIComponent("raw/" + rn)}" download>Apri originale (${esc(rn)})</a></p>`;
    $("orig").innerHTML = `<h2>Originale${pairedRaw ? `: ${esc(pairedRaw)}` : ""}</h2><p class="hint">Accoppiato a <code>${esc(file)}</code>${pairedRaw ? ` via <code>raw/${esc(pairedRaw)}</code>` : " — senza originale collegato"}.</p>`
      + (pairedRaw ? `<p><span class="pill acc">collegato</span></p>` + singleHtml(pairedRaw) : `<p class="hint">Nessun originale allegato a questa voce.</p>`)
      + (others.length ? `<details><summary>Altri originali della wiki (${others.length})</summary>` + others.map(singleHtml).join("") + `</details>` : ``)
      + `<div class="card"><h3>File wiki</h3><p class="hint">Indice, skill e metadati generati in automatico.</p><p style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn small" href="${base}/file?path=${encodeURIComponent("index.md")}">index.md</a>
        <a class="btn small" href="${base}/file?path=${encodeURIComponent("SKILL.md")}">SKILL.md</a>
        <a class="btn small" href="${base}/file?path=${encodeURIComponent("meta.json")}">meta.json</a></p></div>`;
  } catch (err) {
    renderCrumbs(null);
    $("orig").innerHTML = `<div class="empty"><div class="big" aria-hidden="true">📄</div><p>Seleziona un'altra voce dalla sidebar.</p></div>`;
    $("conv").innerHTML = `<div class="empty"><div class="big" aria-hidden="true">⚠️</div><p>${esc(err.message)}</p><p><button class="btn" onclick="location.hash='';location.reload()">Ricarica</button></p></div>`;
  }
}

function rawPreviewHTML(wiki, raw) {
  const url = `/api/wiki/${encodeURIComponent(wiki)}/file?path=${encodeURIComponent("raw/" + raw)}`;
  if (/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(raw)) return `<img class="doc" loading="lazy" alt="Originale ${esc(raw)}" src="${url}">`;
  if (/\.pdf$/i.test(raw)) return `<object data="${url}" type="application/pdf" width="100%" height="520" aria-label="Anteprima ${esc(raw)}"><p><a class="btn small" href="${url}" download="${esc(raw)}">Apri originale (${esc(raw)})</a></p></object>`;
  return `<p><a class="btn small" href="${url}" download="${esc(raw)}">Apri originale (${esc(raw)})</a></p>`;
}

/* dialog PII stile rizzo-pii: spiega placeholder/mapping, propone exclude */
async function piiDialog(label, value) {
  await openDialog({
    title: `PII ${label}`,
    bodyHTML: `<p>Valore rilevato: <code>${esc(value)}</code></p><p>Inviato all'LLM come <code translate="no">[${esc(label)}_1]</code> via <span translate="no">mask</span> j-pii. Il <span translate="no">mapping</span> resta solo locale.</p><p class="hint">Doubtful span = ti chiedo prima di mandarlo. Per falsi positivi (es. DATE nei nomi file) usa <code>JPII_EXCLUDE_TAGS</code> nei settings.</p>`,
    actions: [{ label: "Chiudi", kind: "primary", value: null }],
  });
}

/* editor minimale WP0: modifica md via PUT, preserva pairing raw */
async function openEditorDialog(wiki, file, fullText) {
  const current = stripFrontmatter(fullText);
  const v = await openDialog({
    title: `Modifica ${file}`,
    bodyHTML: `<div class="field"><span><label for="f-md-edit">Markdown (frontmatter preservato in automatico)</label></span><textarea id="f-md-edit" style="min-height:220px" spellcheck="false">${esc(current)}</textarea><span class="hint">Salvataggio rimette <b>draft</b> se era reviewed/versioned. Originale collegato invariato.</span></div>`,
    actions: [{ label: "Annulla", value: null }, { label: "Salva", kind: "primary", collect: (b) => b.querySelector("#f-md-edit").value }],
  });
  if (v === null || v === undefined) return;
  if (!String(v).trim()) { toast("Testo vuoto: nessuna modifica salvata"); return; }
  try {
    // ricostruisci con frontmatter originale preservato dal server (update_file fa merge)
    const fm = parseFrontmatter(fullText);
    const toSave = fm && Object.keys(fm).length ? `---\n${Object.entries(fm).map(([k, val]) => `${k}: ${val}`).join("\n")}\n---\n\n${v}` : v;
    const r = await fetch(`/api/wiki/${encodeURIComponent(wiki)}/file?path=${encodeURIComponent(file)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markdown: toSave }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || `errore ${r.status}`);
    }
    toast("Salvata (torna draft se era approvata)");
    await select(wiki, file, { silent: true });
  } catch (err) { toast("Errore salvataggio: " + err.message); }
}

/* originale già in wiki: immagine a sinistra, voce collegata (o converti) a destra */
async function selectRaw(wiki, raw) {
  state.search = null;
  nav(`#/w/${encodeURIComponent(wiki)}/raw/${encodeURIComponent(raw)}`);
  renderSide($("q").value);
  $("orig").innerHTML = `<div class="skel" style="height:120px"></div>`;
  $("conv").innerHTML = `<div class="skel" style="height:120px"></div>`;
  try {
    const meta = await api(`/api/wiki/${encodeURIComponent(wiki)}`);
    const pair = resolvePair(meta.docs || [], meta.raw || [], raw);
    const doc = (meta.docs || []).find((x) => x.file === pair.doc);
    if (doc) {
      state.sel = { wiki, file: doc.file };
      nav(`#/w/${encodeURIComponent(wiki)}/v/${encodeURIComponent(doc.file)}`);
      await select(wiki, doc.file, { silent: true });
      $("orig").innerHTML = `<h2>Originale: ${esc(raw)}</h2>` + rawPreviewHTML(wiki, raw);
      return;
    }
    state.sel = null;
    state.card = wiki;
    renderCrumbs(null);
    $("crumbs").innerHTML = `<nav aria-label="Breadcrumb"><button class="linklike" id="cr-home">Wiki</button><span class="sep">/</span><b>${esc(wiki)} — raw/${esc(raw)}</b><span class="pill warn">senza voce</span></nav>`;
    $("cr-home").onclick = () => emptySplit();
    $("orig").innerHTML = `<h2>Originale: ${esc(raw)}</h2>` + rawPreviewHTML(wiki, raw);
    $("conv").innerHTML = `<div class="card"><h3>Nessuna voce collegata</h3><p>Questo originale non ha ancora una trascrizione. Convertilo ora: vedrai l'anteprima e poi potrai salvarla come draft.</p><p><button class="btn primary" id="bconvraw">Converti ora…</button></p></div>`;
    $("bconvraw").onclick = () => convertRawFile(wiki, raw);
  } catch (err) {
    $("orig").innerHTML = "";
    $("conv").innerHTML = `<div class="empty"><div class="big" aria-hidden="true">⚠️</div><p>${esc(err.message)} — scegli un'altra voce e riprova.</p></div>`;
  }
}

async function convertRawFile(wiki, raw) {
  toast("Conversione in corso… (la prima volta ~2 min)");
  $("conv").innerHTML = `<div class="skel" style="height:120px"></div><p class="hint">Conversione di raw/${esc(raw)} in corso…</p>`;
  try {
    const o = opts();
    const r = await post(`/api/wiki/${encodeURIComponent(wiki)}/convert-raw`, { file: raw, engine: o.engine || "docling", pages: o.pages || null, deskew: !!o.deskew });
    const url = `/api/wiki/${encodeURIComponent(wiki)}/file?path=${encodeURIComponent("raw/" + raw)}`;
    const mime = /\.pdf$/i.test(raw) ? "application/pdf" : "image/*";
    showConverted(raw, r, url, mime, wiki, raw.replace(/\.[^.]+$/, ""), { rawWiki: wiki, rawFile: raw });
    toast("Convertita: premi “Salva in wiki”");
  } catch (err) {
    $("conv").innerHTML = `<div class="empty"><div class="big" aria-hidden="true">⚠️</div><p>Conversione fallita: ${esc(err.message)}</p><p><button class="btn" id="bretry">Riprova</button></p></div>`;
    $("bretry").onclick = () => convertRawFile(wiki, raw);
  }
}

async function showWikiCard(slug) {
  state.sel = null;
  state.card = slug;
  const d = state.details[slug] || { docs: [], trash: [], raw: [] };
  nav(`#/w/${encodeURIComponent(slug)}`);
  renderSide($("q").value);
  renderCrumbs(null);
  $("crumbs").innerHTML = `<nav aria-label="Breadcrumb"><button class="linklike" id="cr-home">Wiki</button><span class="sep">/</span><b>${esc(slug)}</b><span class="pill num">${d.docs.length} voci</span><span class="pill">Cestino ${d.trash.length}</span></nav>`;
  $("cr-home").onclick = () => emptySplit();
  $("orig").innerHTML = `<div class="card"><h3>Voci (${d.docs.length})</h3>${d.docs.length ? `<div class="tablewrap"><table><tr><th>Voce</th><th>Stato</th><th>Pagine</th></tr>${d.docs.map((v) => `<tr><td><a href="#/w/${encodeURIComponent(slug)}/v/${encodeURIComponent(v.file)}">${esc(v.name)}</a></td><td>${esc(v.review)}</td><td class="num">${v.pages ?? 0}</td></tr>`).join("")}</table></div>` : `<p class="hint">Wiki vuota: converti un file o crea una voce a mano.</p><p><button class="btn primary" id="wc-add">Nuova voce…</button></p>`}</div>
    <div class="card"><h3>Azioni</h3><div class="toolbar"><button class="btn small" id="wc-exp">Esporta zip</button><button class="btn small" id="wc-slim">Senza originali</button><button class="btn small" id="wc-ren">Rinomina…</button><button class="btn small" id="wc-trash">Cestino</button></div></div>`;
  $("conv").innerHTML = `<div class="card"><h3>Come la usi</h3><p>Converti un file dal pulsante in alto, oppure allega immagini all’agente qui sotto con <b>OCR</b> attivo. Le voci nascono <b>draft</b>: approvale per esportarle.</p><p class="hint">Consulta <code>SKILL.md</code> per il formato wiki.</p></div>`;
  $("wc-exp") && ($("wc-exp").onclick = () => { location.href = `/api/wiki/${encodeURIComponent(slug)}/export.zip`; });
  $("wc-slim") && ($("wc-slim").onclick = () => { location.href = `/api/wiki/${encodeURIComponent(slug)}/export.zip?senza_raw=1`; });
  $("wc-ren") && ($("wc-ren").onclick = () => renameDialog(slug));
  $("wc-trash") && ($("wc-trash").onclick = () => showTrash(slug));
  $("wc-add") && ($("wc-add").onclick = () => newVoceDialog(slug));
}

/* ---------- ricerca globale ---------- */
async function globalSearch(q, stato) {
  state.sel = null;
  state.card = null;
  const hits = await api(`/api/search?q=${encodeURIComponent(q)}${stato ? `&stato=${encodeURIComponent(stato)}` : ""}`);
  state.search = { q, hits };
  renderCrumbs(null);
  $("orig").innerHTML = `<div class="card"><h3>Ricerca “${esc(q)}”</h3><p class="hint">${hits.length} risultat${hits.length === 1 ? "o" : "i"}${stato ? ` con stato <b>${esc(stato)}</b>` : ""}. Premi un risultato per aprirlo.</p></div>`;
  $("conv").innerHTML = hits.length
    ? `<div class="searchres">${hits.slice(0, 100).map((h) => `<article><button data-w="${esc(h.wiki)}" data-f="${esc(h.file)}">${esc(h.wiki)} — ${esc(h.file.split("/").pop())}</button><div><code class="num">riga ${h.linea}</code></div><p>${esc(h.testo)}</p></article>`).join("")}</div>${hits.length > 100 ? `<p class="hint">Mostrati i primi 100 su ${hits.length}.</p>` : ""}`
    : `<div class="empty"><div class="big" aria-hidden="true">🔍</div><p>Nessun risultato per “${esc(q)}”. Prova con un’altra parola o togli il filtro di stato.</p></div>`;
  $("conv").querySelectorAll("button[data-w]").forEach((b) => { b.onclick = () => select(b.dataset.w, b.dataset.f); });
}

/* ---------- cestino ---------- */
async function showTrash(slug) {
  state.card = slug || null;
  const slugs = slug ? [slug] : state.wikis;
  renderCrumbs(null);
  $("crumbs").innerHTML = `<nav aria-label="Breadcrumb"><button class="linklike" id="cr-home">Wiki</button><span class="sep">/</span><b>Cestino${slug ? ` — ${esc(slug)}` : ""}</b></nav>`;
  $("cr-home").onclick = () => emptySplit();
  $("orig").innerHTML = `<div class="card"><h3>Cestino</h3><p>Le voci cestinate restano in <code>trash/</code> dentro la wiki: recuperale a mano copiando il file in <code>doc/</code>, oppure chiedi all’agente qui sotto.</p></div>`;
  let html = "";
  for (const s of slugs) {
    let items = [];
    try { items = await api(`/api/wiki/${encodeURIComponent(s)}/trash`); } catch { items = []; }
    html += `<div class="card"><h3>${esc(s)} <span class="pill num">${items.length}</span></h3>${items.length ? `<ul>${items.map((t) => `<li><a href="/api/wiki/${encodeURIComponent(s)}/file?path=${encodeURIComponent("trash/" + t)}">${esc(t)}</a></li>`).join("")}</ul>` : `<p class="hint">Vuoto.</p>`}</div>`;
  }
  $("conv").innerHTML = html || `<div class="empty"><p>Cestino vuoto.</p></div>`;
}

/* ---------- dialoghi CRUD ---------- */
const currentWiki = () => (state.sel && state.sel.wiki) || state.card || state.wikis[0];

async function newWikiDialog() {
  const v = await openDialog({
    title: "Nuova wiki",
    bodyHTML: `<div class="field"><span><label for="f-slug">Nome</label></span><input id="f-slug" name="slug" autocomplete="off" placeholder="Fatture 2026, es. fatture-2026…"><span class="hint" id="f-prev">Slug: <b>wiki</b></span><span class="hint">Solo lettere, numeri e trattini. La crei vuota, poi aggiungi voci.</span></div>`,
    actions: [{ label: "Annulla", value: null }, { label: "Crea wiki", kind: "primary", collect: (b) => b.querySelector("#f-slug").value.trim() }],
  });
  if (!v) return;
  try {
    await post("/api/wiki", { slug: v });
    state.sel = null;
    await refresh();
    toast(`Wiki “${v}” creata`);
    showWikiCard(slugPrev(v));
  } catch (err) { toast("Errore: " + err.message + " — scegli un altro nome"); }
}
async function renameDialog(slug) {
  const v = await openDialog({
    title: `Rinomina “${slug}”`,
    bodyHTML: `<div class="field"><span><label for="f-new">Nuovo nome</label></span><input id="f-new" autocomplete="off" placeholder="Nuovo nome, es. fatture-2027…"><span class="hint" id="f-prev2"></span></div>`,
    actions: [{ label: "Annulla", value: null }, { label: "Rinomina", kind: "primary", collect: (b) => b.querySelector("#f-new").value.trim() }],
  });
  if (!v) return;
  try {
    const r = await post(`/api/wiki/${encodeURIComponent(slug)}/rename`, { nuovo: v });
    state.sel = null;
    await refresh();
    toast(`Rinominata in “${r.slug}”`);
    showWikiCard(r.slug);
  } catch (err) { toast("Errore: " + err.message); }
}
async function newVoceDialog(slug) {
  const target = slug || currentWiki();
  if (!target) return toast("Crea prima una wiki");
  const v = await openDialog({
    title: `Nuova voce in “${target}”`,
    bodyHTML: `<div class="field"><span><label for="f-t">Titolo</label></span><input id="f-t" autocomplete="off" placeholder="Titolo voce, es. Scontrino gennaio…"></div>
      <div class="field"><span><label for="f-md">Markdown</label></span><textarea id="f-md" placeholder="# Titolo…&#10;&#10;| Colonna | Valore |&#10;| --- | --- |&#10;| Totale | 12,00 € |"></textarea><span class="hint">Nasce <b>draft</b>. Tabelle in formato Markdown.</span></div>`,
    actions: [{ label: "Annulla", value: null }, {
      label: "Salva come draft", kind: "primary",
      collect: (b) => ({ title: b.querySelector("#f-t").value.trim(), md: b.querySelector("#f-md").value }),
    }],
  });
  if (!v || !v.title || !v.md) { if (v) toast("Scrivi titolo e testo, poi riprova"); return; }
  try {
    await post(`/api/wiki/${encodeURIComponent(target)}/add`, { markdown: v.md, title: v.title });
    toast("Voce salvata come draft");
    await refresh();
  } catch (err) { toast("Errore: " + err.message); }
}
async function addSourceDialog() {
  const v = await openDialog({
    title: "Aggiungi cartella sorgente",
    bodyHTML: `<div class="field"><span><label for="f-p">Percorso cartella</label></span><input id="f-p" autocomplete="off" spellcheck="false" placeholder="C:/documenti oppure /mnt/c/documenti…"><span class="hint">Leggo PDF e immagini fino a 2 livelli, max 200 file.</span></div>`,
    actions: [{ label: "Annulla", value: null }, { label: "Aggiungi", kind: "primary", collect: (b) => b.querySelector("#f-p").value.trim() }],
  });
  if (!v) return;
  try {
    await post("/api/sources", { path: v });
    toast("Cartella aggiunta");
    await refresh();
  } catch (err) { toast("Errore: " + err.message + " — controlla il percorso"); }
}
async function trashVoceDialog(wiki, voce) {
  const ok = await openDialog({
    title: `Cestinare “${voce}”?`,
    bodyHTML: `<p>La sposto in <code>trash/</code>: sparisce dall'indice e dalle esportazioni, ma resta recuperabile copiando il file indietro da <code>trash/</code> a <code>doc/</code>. Procedo?</p>`,
    actions: [{ label: "Annulla", value: false }, { label: "Sposta nel cestino", kind: "danger", value: true }],
  });
  if (!ok) return;
  try {
    await post(`/api/wiki/${encodeURIComponent(wiki)}/remove`, { voce });
    state.sel = null;
    toast("Voce nel cestino");
    await refresh();
  } catch (err) { toast("Errore: " + err.message); }
}
async function removeWikiDialog(slug) {
  const v = await openDialog({
    title: `Eliminare “${slug}”?`,
    bodyHTML: `<p><b>Azione distruttiva.</b> Cancella wiki, voci e cestino. Per confermare, digita <b translate="no">${esc(slug)}</b> qui sotto.</p><div class="field"><span><label for="f-c">Conferma</label></span><input id="f-c" autocomplete="off" spellcheck="false" placeholder="Digita il nome wiki…"></div>`,
    actions: [{ label: "Annulla", value: null }, { label: "Elimina wiki", kind: "danger", collect: (b) => b.querySelector("#f-c").value.trim() }],
  });
  if (!v) return;
  if (v !== slug) return toast("Nome diverso: eliminazione annullata");
  try {
    await post(`/api/wiki/${encodeURIComponent(slug)}/remove`, { confirm: true });
    state.sel = null;
    toast("Wiki eliminata");
    await refresh();
  } catch (err) { toast("Errore: " + err.message); }
}
async function importDialog() {
  const f = await new Promise((res) => {
    const inp = $("impick");
    inp.value = "";
    inp.onchange = () => { inp.oncancel = null; res(inp.files[0] || null); };
    inp.oncancel = () => res(null);
    inp.click();
  });
  if (!f) return;
  const merge = await openDialog({
    title: `Importa “${f.name}”`,
    bodyHTML: `<div class="field"><label><span><input type="checkbox" id="f-merge" checked> Unisci se la wiki esiste (<code>merge</code>)</span></label><span class="hint">Senza merge, una wiki con lo stesso slug blocca l’import. I conflitti voce vengono saltati e riportati.</span></div>`,
    actions: [{ label: "Annulla", value: null }, { label: "Importa", kind: "primary", collect: (b) => b.querySelector("#f-merge").checked }],
  });
  if (merge === null) return;
  try {
    const buf = await f.arrayBuffer();
    let bin = "";
    for (const x of new Uint8Array(buf)) bin += String.fromCharCode(x);
    const r = await post("/api/wiki/import", { name: f.name, dataBase64: btoa(bin), merge: !!merge });
    toast(`Importate ${r.imported ?? "?"}, saltate ${(r.skipped || []).length}`);
    await refresh();
  } catch (err) { toast("Errore: " + err.message); }
}

/* ---------- menu wiki ---------- */
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
  $("wikimenubtn").setAttribute("aria-expanded", "false");
  const w = currentWiki();
  try {
    if (b.dataset.m === "new") return newWikiDialog();
    if (b.dataset.m === "addvoce") return newVoceDialog(w);
    if (!w) return toast("Crea prima una wiki");
    if (b.dataset.m === "export") location.href = `/api/wiki/${encodeURIComponent(w)}/export.zip`;
    else if (b.dataset.m === "export-slim") location.href = `/api/wiki/${encodeURIComponent(w)}/export.zip?senza_raw=1`;
    else if (b.dataset.m === "import") return importDialog();
    else if (b.dataset.m === "rename") return renameDialog(w);
    else if (b.dataset.m === "trashview") return showTrash(w);
    else if (b.dataset.m === "removewiki") return removeWikiDialog(w);
    toast("Fatto");
  } catch (err) { toast("Errore: " + err.message); }
});
$("trashbtn").onclick = () => showTrash(currentWiki());
$("newwikibtn").onclick = () => newWikiDialog();

/* ---------- converti ---------- */
function showConverted(name, r, objUrl, mime, wikiHint, titleHint, rawInfo) {
  state.search = null;
  renderCrumbs(null);
  $("crumbs").innerHTML = `<nav aria-label="Breadcrumb"><b>Anteprima non salvata</b><span class="pill num">${fmtSec(r.seconds)} s</span><span class="pill">${esc(r.engine || "")}</span></nav>`;
  $("orig").innerHTML = `<h2>Originale: ${esc(name)}</h2>` + (mime.startsWith("image/")
    ? `<img class="doc" src="${objUrl}" alt="Originale ${esc(name)}">`
    : mime === "application/pdf"
      ? `<object data="${objUrl}" type="application/pdf" width="100%" height="520" aria-label="Anteprima ${esc(name)}"><p><a class="btn small" href="${objUrl}" download="${esc(name)}">Apri originale (${esc(name)})</a></p></object>`
      : `<p><a class="btn small" href="${objUrl}" download="${esc(name)}">Apri originale (${esc(name)})</a></p>`);
  const amap = {};
  for (const a of r.assets || []) {
    if (!a.dataBase64) continue;
    const bytes = Uint8Array.from(atob(a.dataBase64), (c) => c.charCodeAt(0));
    amap[a.name] = URL.createObjectURL(new Blob([bytes]));
  }
  let md = r.markdown || "";
  for (const [aname, url] of Object.entries(amap)) {
    md = md.split(`](assets/${aname})`).join(`](${url})`).split(`](${aname})`).join(`](${url})`);
  }
  $("conv").innerHTML = `<h2>${esc(name)} <span style="font-size:12px;color:var(--muted)">anteprima non salvata</span></h2>
    <div class="toolbar"><button class="btn primary" id="bsave">Salva in wiki…</button></div>
    <div>${renderMd(md, "")}</div>`;
  $("bsave").onclick = async () => {
    const v = await openDialog({
      title: "Salva in wiki",
      bodyHTML: `<div class="field"><span><label for="f-w">Wiki</label></span><input id="f-w" autocomplete="off" placeholder="Nome wiki, es. fatture…" value="${esc(wikiHint || currentWiki() || "demo")}"><span class="hint">Se non esiste, la creo.</span></div>
        <div class="field"><span><label for="f-t">Titolo voce</label></span><input id="f-t" autocomplete="off" value="${esc(titleHint || name.replace(/\.[^.]+$/, ""))}"></div>`,
      actions: [{ label: "Annulla", value: null }, { label: "Salva come draft", kind: "primary", collect: (b) => ({ w: b.querySelector("#f-w").value.trim(), t: b.querySelector("#f-t").value.trim() }) }],
    });
    if (!v || !v.w || !v.t) { if (v) toast("Scrivi wiki e titolo, poi riprova"); return; }
    try {
      const payload = { markdown: r.markdown, title: v.t, assets: r.assets || [], ...(rawInfo || {}) };
      const saved = await post(`/api/wiki/${encodeURIComponent(v.w)}/add`, payload);
      toast("Salvata come draft con originale collegato");
      await refresh();
      try { await select(v.w, saved.file); } catch { /* fallback: resta su refresh */ }
    } catch (err) { toast("Errore: " + err.message); }
  };
}
$("upick").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  const buf = await f.arrayBuffer();
  await convertUpload(f.name, buf, f.type || "");
});
let lastUpload = null;
async function convertUpload(name, buf, mime) {
  lastUpload = { name, buf, mime };
  state.search = null;
  renderCrumbs(null);
  const objUrl = URL.createObjectURL(new Blob([buf], { type: mime || "application/octet-stream" }));
  $("crumbs").innerHTML = `<nav aria-label="Breadcrumb"><b>Anteprima non salvata</b></nav>`;
  $("orig").innerHTML = `<h2>Originale: ${esc(name)}</h2>` + (mime.startsWith("image/")
    ? `<img class="doc" src="${objUrl}" alt="Originale ${esc(name)}">`
    : mime === "application/pdf"
      ? `<object data="${objUrl}" type="application/pdf" width="100%" height="520" aria-label="Anteprima ${esc(name)}"><p><a class="btn small" href="${objUrl}" download="${esc(name)}">Apri originale (${esc(name)})</a></p></object>`
      : `<p><a class="btn small" href="${objUrl}" download="${esc(name)}">Apri originale (${esc(name)})</a></p>`);
  $("conv").innerHTML = `<div class="skel" style="height:120px"></div><p class="hint">Conversione in corso… la prima volta i modelli impiegano ~2 min, poi secondi.</p>`;
  toast("Conversione in corso… (la prima volta ~2 min)");
  await runUploadConvert();
}
async function runUploadConvert() {
  const up = lastUpload;
  if (!up) return;
  try {
    let binary = "";
    for (const x of new Uint8Array(up.buf)) binary += String.fromCharCode(x);
    const o = opts();
    const r = await post("/api/convert-upload", { name: up.name, dataBase64: btoa(binary), engine: o.engine || "docling", pages: o.pages || null, deskew: !!o.deskew });
    let _bin = "";
    for (const x of new Uint8Array(up.buf)) _bin += String.fromCharCode(x);
    showConverted(up.name, r, URL.createObjectURL(new Blob([up.buf], { type: up.mime || "application/octet-stream" })), up.mime || "", undefined, undefined, { rawName: up.name, rawDataBase64: btoa(_bin) });
    toast("Convertita: premi “Salva in wiki”");
  } catch (err) {
    $("conv").innerHTML = `<div class="empty"><div class="big" aria-hidden="true">⚠️</div><p>Conversione fallita: ${esc(err.message)}</p><p><button class="btn" id="bretry3">Riprova</button></p></div>`;
    $("bretry3").onclick = () => runUploadConvert();
    toast("Errore: " + err.message);
  }
}
async function convertServerFile(path) {
  toast("Conversione in corso… (la prima volta ~2 min)");
  try {
    const o = opts();
    const base = path.split("/").pop();
    const fileUrl = `/api/file?path=${encodeURIComponent(path)}`;
    const isImg = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(base);
    const isPdf = /\.pdf$/i.test(base);
    state.search = null;
    renderCrumbs(null);
    $("crumbs").innerHTML = `<nav aria-label="Breadcrumb"><b>Anteprima non salvata</b></nav>`;
    $("orig").innerHTML = `<h2>Originale: ${esc(base)}</h2>` + (isImg
      ? `<img class="doc" src="${fileUrl}" alt="Originale ${esc(base)}" loading="lazy">`
      : isPdf
        ? `<object data="${fileUrl}" type="application/pdf" width="100%" height="520" aria-label="Anteprima ${esc(base)}"><p><a class="btn small" href="${fileUrl}" download="${esc(base)}">Apri originale (${esc(base)})</a></p></object>`
        : `<p><a class="btn small" href="${fileUrl}" download="${esc(base)}">Apri originale (${esc(base)})</a></p>`)
      + `<p class="hint">${esc(path)}</p>`;
    $("conv").innerHTML = `<div class="skel" style="height:120px"></div><p class="hint">Conversione in corso… la prima volta i modelli impiegano ~2 min, poi secondi.</p>`;
    let r;
    try {
      r = await post("/api/convert", { path, engine: o.engine || "docling", pages: o.pages || null, deskew: !!o.deskew });
    } catch (err) {
      $("conv").innerHTML = `<div class="empty"><div class="big" aria-hidden="true">⚠️</div><p>Conversione fallita: ${esc(err.message)}</p><p><button class="btn" id="bretry">Riprova</button></p></div>`;
      $("bretry").onclick = () => convertServerFile(path);
      toast("Errore: " + err.message);
      return;
    }
    $("crumbs").innerHTML = `<nav aria-label="Breadcrumb"><b>Anteprima non salvata</b><span class="pill num">${fmtSec(r.seconds)} s</span></nav>`;
    const amap = {};
    for (const a of r.assets || []) {
      if (!a.dataBase64) continue;
      const bytes = Uint8Array.from(atob(a.dataBase64), (c) => c.charCodeAt(0));
      amap[a.name] = URL.createObjectURL(new Blob([bytes]));
    }
    let md = r.markdown || "";
    for (const [aname, url] of Object.entries(amap)) {
      md = md.split(`](assets/${aname})`).join(`](${url})`).split(`](${aname})`).join(`](${url})`);
    }
    $("conv").innerHTML = `<h2>${esc(base)}</h2><div class="toolbar"><button class="btn primary" id="bsave2">Salva in wiki…</button></div><div>${renderMd(md, "")}</div>`;
    $("bsave2").onclick = async () => {
      const v = await openDialog({
        title: "Salva in wiki",
        bodyHTML: `<div class="field"><span><label for="f-w">Wiki</label></span><input id="f-w" autocomplete="off" value="${esc(currentWiki() || "demo")}"></div>
          <div class="field"><span><label for="f-t">Titolo voce</label></span><input id="f-t" autocomplete="off" value="${esc(base.replace(/\.[^.]+$/, ""))}"></div>`,
        actions: [{ label: "Annulla", value: null }, { label: "Salva come draft", kind: "primary", collect: (b) => ({ w: b.querySelector("#f-w").value.trim(), t: b.querySelector("#f-t").value.trim() }) }],
      });
      if (!v || !v.w) return;
      try {
        const saved = await post(`/api/wiki/${encodeURIComponent(v.w)}/add`, { markdown: r.markdown, title: v.t || base, rawPath: path });
        toast("Salvata come draft con originale collegato");
        await refresh();
        try { await select(v.w, saved.file); } catch { /* resta su refresh */ }
      } catch (err) { toast("Errore: " + err.message + " — cambia titolo o wiki e riprova"); }
    };
    toast("Convertita: premi “Salva in wiki”");
  } catch (err) { toast("Errore: " + err.message); }
}

/* ---------- dock ---------- */
function dockSay(who, text) {
  const host = $("docklog");
  const div = document.createElement("div");
  div.className = "msg" + (who === "pi" ? " pi" : "");
  const w = document.createElement("span");
  w.className = "who";
  w.textContent = who + ": ";
  div.appendChild(w);
  div.appendChild(document.createTextNode(String(text).replace(/\*\*/g, "")));
  host.appendChild(div);
  host.scrollTop = host.scrollHeight;
  return div;
}
$("docknew").onclick = async () => {
  try { await post("/api/chat/new", {}); $("docklog").innerHTML = ""; toast("Conversazione azzerata"); }
  catch (err) { toast("Errore: " + err.message); }
};
$("dockimg").addEventListener("change", (e) => {
  const names = [...e.target.files].map((f) => f.name).join(", ");
  $("dockfiles").textContent = names ? `Allegati: ${names}` : "";
});
$("dockform").addEventListener("submit", async (e) => {
  e.preventDefault();
  const v = $("dockin").value.trim();
  const files = [...$("dockimg").files];
  if (!v && !files.length) return;
  $("dock").classList.add("open");
  $("docktoggle").setAttribute("aria-expanded", "true");
  dockSay("tu", v || ("[allegati: " + files.map((f) => f.name).join(", ") + "]"));
  $("dockin").value = "";
  const btn = $("docksend");
  btn.disabled = true;
  const label = btn.textContent;
  btn.textContent = "Invio…";
  const typing = document.createElement("div");
  typing.className = "msg typing";
  typing.textContent = "pi sta scrivendo…";
  try {
    const images = [];
    for (const f of files) {
      const buf = await f.arrayBuffer();
      let bin = "";
      for (const x of new Uint8Array(buf)) bin += String.fromCharCode(x);
      images.push({ name: f.name, dataBase64: btoa(bin) });
    }
    const o = opts();
    const ctx = state.sel ? { wiki: state.sel.wiki, voce: state.sel.file } : state.card ? { wiki: state.card } : {};
    const r = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: v, images,
        ocr: $("dockocr").checked, sensitive: $("docksens").checked,
        engine: $("dockengine").value || o.engine || "docling", deskew: $("dockdeskew").checked || !!o.deskew,
        context: ctx,
      }),
    });
    $("dockimg").value = "";
    $("dockfiles").textContent = "";
    $("docklog").appendChild(typing);
    const text = await r.text();
    let piAnswered = false;
    let streamEl = null; // i delta di una risposta si accumulano in un solo fumetto
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      let ev;
      try { ev = JSON.parse(line.slice(6)); } catch { continue; }
      if (ev.type === "text_delta") {
        piAnswered = true;
        if (streamEl) {
          streamEl.appendChild(document.createTextNode(ev.delta));
          $("docklog").scrollTop = $("docklog").scrollHeight;
        } else {
          streamEl = dockSay("pi", ev.delta);
        }
      }
      else if (ev.type === "tool") { piAnswered = true; streamEl = null; dockSay("pi", `(uso ${ev.tool}…)`); }
    }
    if (!piAnswered) dockSay("pi", "Nessuna risposta: premi “Nuova conversazione” e riprova; se persiste, avvia con JPII_ANALYZER=fake per escludere il sidecar j-pii.");
  } catch (err) {
    dockSay("pi", "Errore: " + err.message + " — riprova");
  } finally {
    typing.remove();
    btn.disabled = false;
    btn.textContent = label;
  }
});
document.querySelectorAll("#chips button").forEach((b) => {
  b.onclick = () => { $("dockin").value = b.dataset.q; $("dockform").requestSubmit(); };
});

/* ---------- dock dual-mode WP3 ---------- */
function setDockMode(mode) {
  const d = $("dock");
  d.dataset.mode = mode;
  try { localStorage.setItem("ocr-pi-dockmode", mode); } catch {}
  const floating = mode === "floating";
  $("dockpop").hidden = floating;
  $("dockpin").hidden = !floating;
  $("dockassist").setAttribute("aria-expanded", floating || d.classList.contains("open"));
}
function initDockMode() {
  let mode = "embedded";
  try { mode = localStorage.getItem("ocr-pi-dockmode") || "embedded"; } catch {}
  if (mode !== "floating") mode = "embedded";
  setDockMode(mode);
  $("dockpop").onclick = () => { setDockMode("floating"); $("dock").classList.add("open"); $("dockin").focus(); };
  $("dockpin").onclick = () => setDockMode("embedded");
  $("dockassist").onclick = () => {
    const d = $("dock");
    if (d.dataset.mode === "floating") setDockMode("embedded");
    else { setDockMode("floating"); d.classList.add("open"); $("dockin").focus(); }
  };
  // drag popup da dockhead (mouse + touch, no librerie)
  const head = $("dockhead");
  let sx = 0, sy = 0, ox = 0, oy = 0, drag = false;
  head.addEventListener("pointerdown", (e) => {
    if ($("dock").dataset.mode !== "floating") return;
    if (e.target.closest("button,input,select,textarea")) return;
    drag = true; sx = e.clientX; sy = e.clientY;
    const r = $("dock").getBoundingClientRect();
    ox = window.innerWidth - r.right; oy = window.innerHeight - r.bottom;
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    const d = $("dock");
    d.style.right = Math.max(8, ox - dx) + "px";
    d.style.bottom = Math.max(8, oy - dy) + "px";
    d.style.left = "auto"; d.style.top = "auto";
  });
  head.addEventListener("pointerup", () => { drag = false; });
}

/* ---------- chrome ---------- */
function initTheme() {
  const saved = localStorage.getItem("ocr-pi-theme");
  const root = document.documentElement;
  const apply = (t) => { root.dataset.theme = t; localStorage.setItem("ocr-pi-theme", t); };
  if (saved) root.dataset.theme = saved;
  else root.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  $("themebtn").onclick = () => apply(root.dataset.theme === "dark" ? "light" : "dark");
}
$("burger").onclick = () => document.body.classList.toggle("nav");
$("tPdf").onclick = () => setTab("pdf");
$("tMd").onclick = () => setTab("md");
function setTab(t) {
  $("split").dataset.tab = t;
  $("tPdf").setAttribute("aria-pressed", t === "pdf");
  $("tMd").setAttribute("aria-pressed", t === "md");
}
$("q").addEventListener("input", (e) => renderSide(e.target.value));
$("gsearch").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("gq").value.trim();
  if (!q) return;
  try { await globalSearch(q, $("gstato").value); }
  catch (err) { toast("Errore ricerca: " + err.message); }
});
$("docktoggle").onclick = (e) => {
  const open = !$("dock").classList.contains("open");
  $("dock").classList.toggle("open", open);
  e.currentTarget.setAttribute("aria-expanded", open);
  e.currentTarget.textContent = open ? "Riduci agente" : "Espandi agente";
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.body.classList.remove("nav");
    if ($("dock") && $("dock").dataset.mode === "floating") setDockMode("embedded");
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("gq").focus(); }
});
window.addEventListener("hashchange", () => {
  if (location.hash === lastHash) return; // navigazione programmatica: già gestita
  lastHash = location.hash;
  const m = location.hash.match(/#\/w\/([^/]+)(?:\/v\/(.+))?/);
  if (m) {
    const wiki = decodeURIComponent(m[1]);
    if (m[2]) select(wiki, decodeURIComponent(m[2])).catch(() => {});
    else if (state.details[wiki]) showWikiCard(wiki);
  }
});

/* ---------- avvio ---------- */
(function init() {
  initTheme();
  try { initDockMode(); } catch {}
  try {
    const o = opts();
    if (o.engine) { const d = $("dockengine"); if (d) d.value = o.engine; }
  } catch { /* prefs assenti: default */ }
  const raw = location.hash.match(/#\/w\/([^/]+)\/raw\/(.+)$/);
  const m = location.hash.match(/#\/w\/([^/]+)\/v\/(.+?)(\/tab\/(\w+))?$/);
  if (raw) {
    refresh().then(() => selectRaw(decodeURIComponent(raw[1]), decodeURIComponent(raw[2])).catch(() => {}))
      .catch((e) => {
        $("conv").innerHTML = `<div class="empty"><div class="big" aria-hidden="true">🔌</div><p>Backend non raggiungibile (${esc(e.message)}). Avvia <code>node ui/server.mjs</code> e ricarica.</p></div>`;
        $("orig").innerHTML = "";
      });
  } else if (m) {
    if (m[4]) setTab(m[4]);
    refresh().then(() => select(decodeURIComponent(m[1]), decodeURIComponent(m[2])).catch(() => {})).catch((e) => {
      $("conv").innerHTML = `<div class="empty"><p>Backend non raggiungibile (${esc(e.message)}). Avvia <code>node ui/server.mjs</code> e ricarica.</p></div>`;
    });
  } else {
    const w = location.hash.match(/#\/w\/([^/]+)$/);
    refresh().then(() => { if (w && state.details[decodeURIComponent(w[1])]) showWikiCard(decodeURIComponent(w[1])); })
      .catch((e) => {
        $("conv").innerHTML = `<div class="empty"><div class="big" aria-hidden="true">🔌</div><p>Backend non raggiungibile (${esc(e.message)}). Avvia <code>node ui/server.mjs</code> e ricarica.</p></div>`;
        $("orig").innerHTML = "";
      });
  }
})();
