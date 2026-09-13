// Backend PWA ocr-pi (u1): statici + REST sopra demone/cli.py + SSE chat (echo fino a u3).
// Zero dipendenze. Config: PORT, UI_WIKI_ROOT (default ./wikis), UI_PYTHON.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Daemon } from "./daemon.mjs";

const execFileAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const OCR_PI = join(HERE, "..", "ocr-pi");

export const config = {
	port: Number(process.env.PORT ?? 8000),
	wikiRoot: resolve(process.env.UI_WIKI_ROOT ?? join(process.cwd(), "wikis")),
	python: process.env.UI_PYTHON ?? join(OCR_PI, ".venv", "bin", "python"),
};

// Il dock carica l'extension j-pii, che di default cerca il sidecar con un
// python relativo (mai valido): se JPII_PYTHON manca e c'è il venv del repo,
// usalo, così la chat funziona senza configurazione extra.
if (!process.env.JPII_PYTHON) {
	const venvPy = resolve(process.cwd(), ".venv", "bin", "python");
	if (existsSync(venvPy)) process.env.JPII_PYTHON = venvPy;
}

const daemon = new Daemon();

// WP7-bis warmup OCR reale: precarica modelli docling in background, espone stato
const ocrState = { loading: false, ready: false, error: "", engine: process.env.UI_WARMUP_ENGINE || "docling", startedAt: 0 };
export function ocrStatus() { return { ...ocrState }; }
export async function warmupOcr(force = false) {
  if (process.env.UI_PREWARM === "0" && !force) return ocrStatus();
  if (ocrState.loading || (ocrState.ready && !force)) return ocrStatus();
  ocrState.loading = true; ocrState.ready = false; ocrState.error = "";
  ocrState.startedAt = Date.now();
  try {
    const dir = mkdtempSync(join(tmpdir(), "ocr-pi-warm-"));
    // PNG 1x1 minimo: basta a far caricare i modelli docling
    const tiny = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    const src = join(dir, "warm.png");
    writeFileSync(src, tiny);
    await daemon.convert({ path: src, engine: ocrState.engine, workdir: dir, deskew: false }, process.cwd());
    ocrState.ready = true;
    console.log(`[warmup] modelli OCR (${ocrState.engine}) pronti in ${Math.round((Date.now() - ocrState.startedAt) / 1000)}s`);
  } catch (err) {
    ocrState.error = err instanceof Error ? err.message : String(err);
    console.error(`[warmup] OCR non pronto: ${ocrState.error}`);
  } finally {
    ocrState.loading = false;
  }
  return ocrStatus();
}

// WP4 trasparenza LLM: storico invii al modello (mai valori veri, solo placeholder e conteggi)
const llmLog = [];
function logLlm(entry) {
  llmLog.unshift({ t: new Date().toISOString(), ...entry });
  if (llmLog.length > 100) llmLog.length = 100;
}
async function maskPreviewForLog(text) {
  try {
    const analyzer = process.env.JPII_ANALYZER ?? "real";
    const sidecarUrl = process.env.JPII_SIDECAR_URL ?? "http://127.0.0.1:5005";
    if (analyzer !== "fake") {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      try {
        const r = await fetch(`${sidecarUrl}/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: String(text).slice(0, 8000), include_mapping: true }), signal: ctl.signal });
        clearTimeout(timer);
        if (r.ok) {
          const data = await r.json();
          const segs = Array.isArray(data.segments) ? data.segments : [];
          const out = []; let cursor = 0;
          const full = String(text);
          for (const sg of segs) {
            if (typeof sg.t !== "string" || !sg.t || typeof sg.label !== "string") continue;
            const i = full.indexOf(sg.t, cursor);
            if (i === -1) continue;
            out.push({ start: i, end: i + sg.t.length, label: sg.label });
            cursor = i + sg.t.length;
            if (out.length >= 50) break;
          }
          return { segments: out, engine: "rizzo-pii" };
        }
      } catch { try { clearTimeout(timer); } catch {} }
    }
  } catch {}
  const full = String(text || "");
  const out = [];
  for (const pat of [{ re: /[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]/g, label: "CF" }, { re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, label: "EMAIL" }]) {
    let m; while ((m = pat.re.exec(full)) !== null && out.length < 50) out.push({ start: m.index, end: m.index + m[0].length, label: pat.label });
  }
  out.sort((a, b) => a.start - b.start);
  return { segments: out, engine: "fake" };
}

async function cli(args) {
	try {
		const { stdout } = await execFileAsync(
			config.python,
			[join(OCR_PI, "cli.py"), "--root", config.wikiRoot, "--json", ...args],
			{ timeout: 60000, maxBuffer: 16 * 1024 * 1024 },
		);
		return JSON.parse(stdout || "null");
	} catch (err) {
		const out = String(err?.stdout ?? "").trim();
		try {
			const parsed = JSON.parse(out);
			if (parsed && typeof parsed.error === "string") {
				const wrapped = new Error(parsed.error);
				wrapped.status = 400;
				throw wrapped;
			}
		} catch (parseErr) {
			if (parseErr.status) throw parseErr;
		}
		throw err;
	}
}

function readBody(req, limit = 10 * 1024 * 1024) {
	return new Promise((resolveBody, reject) => {
		let n = 0;
		const chunks = [];
		req.on("data", (c) => {
			n += c.length;
			if (n > limit) {
				reject(Object.assign(new Error("body troppo grande"), { status: 413 }));
				req.destroy();
			} else chunks.push(c);
		});
		req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf-8")));
		req.on("error", reject);
	});
}

function send(res, status, data) {
	const body = JSON.stringify(data);
	res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
	res.end(body);
}

function sendErr(res, err) {
	const status = err?.status ?? 500;
	const msg = err instanceof Error ? err.message : String(err);
	send(res, status, { error: msg });
}

async function listSourceFiles(dir) {
	const exts = [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".tiff", ".tif", ".gif", ".bmp"];
	const out = [];
	const walk = async (d, depth) => {
		if (depth > 2 || out.length > 200) return;
		let entries = [];
		try {
			entries = await readdir(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			const full = join(d, e.name);
			if (e.isDirectory()) await walk(full, depth + 1);
			else if (exts.includes(extname(full).toLowerCase())) out.push(full);
		}
	};
	await walk(dir, 0);
	return out.sort();
}

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json",
	".md": "text/markdown; charset=utf-8",
	".pdf": "application/pdf",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".bmp": "image/bmp",
	".tif": "image/tiff",
	".tiff": "image/tiff",
	".svg": "image/svg+xml",
	".ico": "image/x-icon",
	".webmanifest": "application/manifest+json",
};

async function serveStatic(req, res, url) {
	const rel = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
	const file = normalize(join(HERE, "static", rel));
	if (file !== join(HERE, "static") && !file.startsWith(join(HERE, "static") + sep)) {
		return send(res, 403, { error: "fuori da static/" });
	}
	try {
		if (!(await stat(file)).isFile()) return send(res, 404, { error: "non trovato" });
		res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream" });
		res.end(await readFile(file));
	} catch {
		send(res, 404, { error: "non trovato" });
	}
}

export function jpiBlockMessage(notes) {
	const line = (notes || []).find((l) => l.includes("blocked a request")) || "";
	const reason = line.includes("blocked a request:") ? line.split("blocked a request:")[1].trim() : "";
	if (reason) {
		return `Bloccata da j-pii prima del modello: ${reason}. Se sono falsi positivi (es. date o numeri dentro un nome file), riavvia con JPII_EXCLUDE_TAGS=DATE,TIME,BUILDINGNUM,AGE,ZIPCODE oppure riformula il messaggio senza quei valori. Dettagli nel log del server.`;
	}
	return "Nessuna risposta dall'agente: la richiesta è stata bloccata prima del modello (spesso è j-pii che non avvia il sidecar). Prova con JPII_ANALYZER=fake e JPII_PYTHON=<venv>/bin/python, poi premi “Nuova conversazione” e riprova.";
}

export function createApp() {
	const server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url ?? "/", "http://x");
			const seg = url.pathname.split("/").filter(Boolean);

			if (!url.pathname.startsWith("/api/")) return serveStatic(req, res, url);

			// GET /api/wikis
			if (req.method === "GET" && seg.join("/") === "api/wikis") {
				return send(res, 200, await cli(["list"]));
			}

			// GET /api/config (modello dock + radici, per badge UI)
			if (req.method === "GET" && url.pathname === "/api/config") {
				return send(res, 200, { model: process.env.UI_MODEL ?? "opencode/muse-spark-1.3-contributor-free", wikiRoot: config.wikiRoot });
			}

			// POST /api/mask/preview {text} -> segments rizzo-pii (o regex fallback fake)
			// Usato dall'editor per evidenziare PII come fa rizzo-pii. Mai valori veri in log.
			if (req.method === "POST" && url.pathname === "/api/mask/preview") {
				const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)) || "{}");
				const text = String(body.text ?? "");
				if (!text) return send(res, 200, { segments: [], engine: "none" });
				const analyzer = process.env.JPII_ANALYZER ?? "real";
				const sidecarUrl = process.env.JPII_SIDECAR_URL ?? "http://127.0.0.1:5005";
				if (analyzer !== "fake") {
					try {
						const ctl = new AbortController();
						const t = setTimeout(() => ctl.abort(), 15000);
						const r = await fetch(`${sidecarUrl}/analyze`, {
							method: "POST", headers: { "Content-Type": "application/json" },
							body: JSON.stringify({ text, include_mapping: true }), signal: ctl.signal,
						});
						clearTimeout(t);
						if (r.ok) {
							const data = await r.json();
							const segs = Array.isArray(data.segments) ? data.segments : [];
							// segments -> detections con offset (cursor in ordine documento)
							const out = [];
							let cursor = 0;
							for (const s of segs) {
								if (typeof s.t !== "string" || !s.t || typeof s.label !== "string") continue;
								const i = text.indexOf(s.t, cursor);
								if (i === -1) continue;
								out.push({ start: i, end: i + s.t.length, label: s.label, validated: s.validated });
								cursor = i + s.t.length;
								if (out.length >= 200) break;
							}
							return send(res, 200, { segments: out, engine: "rizzo-pii" });
						}
					} catch {
						/* sidecar assente: fallback regex sotto */
					}
				}
				// fallback fake: CF + EMAIL come j-pii fakeAnalyzer
				const out = [];
				const pats = [
					{ re: /[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]/g, label: "CF" },
					{ re: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, label: "EMAIL" },
				];
				for (const p of pats) {
					let m;
					while ((m = p.re.exec(text)) !== null && out.length < 200) {
						out.push({ start: m.index, end: m.index + m[0].length, label: p.label, validated: true });
					}
				}
				out.sort((a, b) => a.start - b.start);
				return send(res, 200, { segments: out, engine: "fake" });
			}

			// GET /api/status (workdir + warmup WP7: mai lento, best-effort con timeout corti)
			if (req.method === "GET" && url.pathname === "/api/status") {
				let wikiRootExists = false;
				let wikisCount = 0;
				try {
					const st = await stat(join(config.wikiRoot, "wiki"));
					wikiRootExists = st.isDirectory();
					if (wikiRootExists) {
						const out = await cli(["list"]);
						wikisCount = Array.isArray(out) ? out.length : 0;
					}
				} catch {
					wikiRootExists = false;
				}
				let daemonOk = false;
				try { daemon.ensure(process.cwd()); daemonOk = true; } catch {}
				let sidecarOk = false;
				let sidecarEngine = process.env.JPII_ANALYZER === "fake" ? "fake" : "unknown";
				if (process.env.JPII_ANALYZER === "fake") sidecarOk = true;
				else {
					try {
						const ctl = new AbortController();
						const t = setTimeout(() => ctl.abort(), 1500);
						const hr = await fetch(`${process.env.JPII_SIDECAR_URL ?? "http://127.0.0.1:5005"}/health`, { signal: ctl.signal });
						clearTimeout(t);
						sidecarOk = hr.ok;
						if (hr.ok) sidecarEngine = "rizzo-pii";
					} catch {}
				}
				return send(res, 200, { wikiRoot: config.wikiRoot, wikiRootExists, wikisCount, needsSetup: !wikiRootExists || wikisCount === 0, daemonOk, sidecarOk, sidecarEngine, ocrReady: ocrState.ready, ocrLoading: ocrState.loading, ocrError: ocrState.error, ocrEngine: ocrState.engine });
			}

			// POST /api/warmup-ocr (WP7-bis: precarica modelli ora, background)
			if (req.method === "POST" && url.pathname === "/api/warmup-ocr") {
				warmupOcr(true).catch(() => {});
				return send(res, 200, ocrStatus());
			}

			// GET /api/version (WP6 hardening: release tracciabile)
			if (req.method === "GET" && url.pathname === "/api/version") {
				let sha = "";
				try {
					const { stdout } = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd(), timeout: 5000 });
					sha = String(stdout).trim();
				} catch {}
				return send(res, 200, { name: "ocr-pi-ui", version: "0.1.0", sha, date: new Date().toISOString() });
			}

			// GET /api/llm-log (WP4: storico masked, mai valori veri)
			if (req.method === "GET" && url.pathname === "/api/llm-log") {
				return send(res, 200, llmLog);
			}

			// GET /api/search?q=&stato=&wiki=  (ricerca globale sopra cli search)
			if (req.method === "GET" && url.pathname === "/api/search") {
				const args = ["search", url.searchParams.get("q") ?? ""];
				const stato = url.searchParams.get("stato");
				const wiki = url.searchParams.get("wiki");
				if (stato) args.push("--stato", stato);
				if (wiki) args.push("--wiki", wiki);
				return send(res, 200, await cli(args));
			}

			// GET /api/wiki/:slug  (dettaglio: meta + cestino + originali)
			if (req.method === "GET" && seg[0] === "api" && seg[1] === "wiki" && seg.length === 3) {
				const slug = decodeURIComponent(seg[2]);
				const dir = join(config.wikiRoot, "wiki", slug);
				let meta;
				try {
					meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf-8"));
				} catch {
					return send(res, 404, { error: `wiki assente: ${slug}` });
				}
				const ls = async (sub) => {
					try {
						return (await readdir(join(dir, sub))).filter((f) => f.endsWith(".md") || f.endsWith(".pdf") || f.endsWith(".png"));
					} catch {
						return [];
					}
				};
				return send(res, 200, { slug, docs: meta.docs ?? [], trash: await ls("trash"), raw: await ls("raw") });
			}

			// GET /api/wiki/:slug/file?path=doc/x.md  (confinato alla wiki)
			if ((req.method === "GET" || req.method === "PUT") && seg[0] === "api" && seg[1] === "wiki" && seg[3] === "file") {
				const dir = join(config.wikiRoot, "wiki", decodeURIComponent(seg[2]));
				const rel = (url.searchParams.get("path") ?? "").replace(/\\/g, "/");
				const file = normalize(join(dir, rel));
				if (rel.includes("..") || (file !== dir && !file.startsWith(dir + sep))) {
					return send(res, 403, { error: "fuori dalla wiki" });
				}
				if (req.method === "GET") {
					try {
						if (!(await stat(file)).isFile()) return send(res, 404, { error: "non trovato" });
						const ext = extname(file);
						res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
						return res.end(await readFile(file));
					} catch {
						return send(res, 404, { error: "non trovato" });
					}
				}
				// PUT: salva editor (solo doc/*.md, preserva pairing raw via manager.update-file)
				if (!rel.startsWith("doc/") || !rel.endsWith(".md")) {
					return send(res, 400, { error: "solo doc/*.md editabili" });
				}
				const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)) || "{}");
				if (typeof body.markdown !== "string" || !body.markdown.trim()) {
					return send(res, 400, { error: "markdown vuoto" });
				}
				const slug = decodeURIComponent(seg[2]);
				const tmp = mkdtempSync(join(tmpdir(), "ocr-pi-put-"));
				const tmpFile = join(tmp, "voce.md");
				writeFileSync(tmpFile, body.markdown);
				return send(res, 200, await cli(["update-file", slug, rel, tmpFile]));
			}

			// GET /api/wiki/:slug/trash  (voci cestinate, recuperabili a mano da trash/)
			if (req.method === "GET" && seg[0] === "api" && seg[1] === "wiki" && seg[3] === "trash") {
				return send(res, 200, await cli(["trash", decodeURIComponent(seg[2])]));
			}

			// GET /api/wiki/:slug/export.zip[?senza_raw=1]  (download)
			if (req.method === "GET" && seg[0] === "api" && seg[1] === "wiki" && seg[3] === "export.zip") {
				const slug = decodeURIComponent(seg[2]);
				const out = await cli(["export", slug, ...(url.searchParams.get("senza_raw") ? ["--senza-raw"] : [])]);
				res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${slug}.zip"` });
				return res.end(await readFile(out.zip));
			}

			// GET /api/wiki/:slug/search?q=&stato=
			if (req.method === "GET" && seg[0] === "api" && seg[1] === "wiki" && seg[3] === "search") {
				const wiki = decodeURIComponent(seg[2]);
				const args = ["search", url.searchParams.get("q") ?? "", "--wiki", wiki];
				const stato = url.searchParams.get("stato");
				if (stato) args.push("--stato", stato);
				return send(res, 200, await cli(args));
			}

			// POST /api/convert {path, engine?, pages?, deskew?}
			if (req.method === "POST" && url.pathname === "/api/convert") {
				const body = JSON.parse((await readBody(req)) || "{}");
				if (!body.path) return send(res, 400, { error: "manca path" });
				const result = await daemon.convert(
					{
						path: body.path,
						engine: body.engine ?? "docling",
						pages: body.pages ?? null,
						workdir: join(tmpdir(), "ocr-pi"),
						deskew: !!body.deskew,
					},
					process.cwd(),
				);
				// asset inline (stesso formato di /api/convert-upload) per l'anteprima nel browser
				const assets = [];
				for (const a of result.assets ?? []) {
					try {
						assets.push({ name: String(a).split("/").pop(), dataBase64: (await readFile(String(a))).toString("base64") });
					} catch {
						/* asset mancante: salta */
					}
				}
				return send(res, 200, { ...result, assets });
			}

			const SOURCES = () => join(config.wikiRoot, "sources.json");
			const readSources = async () => {
				try {
					return JSON.parse(await readFile(SOURCES(), "utf-8"));
				} catch {
					return [];
				}
			};

			// GET /api/sources  +  POST /api/sources {path}  +  DELETE /api/sources {path}
			if (url.pathname === "/api/sources") {
				if (req.method === "GET") {
					const out = [];
					for (const s of await readSources()) {
						out.push({ path: s, files: await listSourceFiles(s) });
					}
					return send(res, 200, out);
				}
				const body = JSON.parse((await readBody(req)) || "{}");
				const list = await readSources();
				if (req.method === "POST") {
					let dir = String(body.path ?? "").replace(/\\/g, "/");
					const drive = dir.match(/^([A-Za-z]):\//);
					if (drive) dir = `/mnt/${drive[1].toLowerCase()}/${dir.slice(3)}`;
					try {
						if (!(await stat(dir)).isDirectory()) return send(res, 400, { error: "non una cartella" });
					} catch {
						return send(res, 400, { error: "cartella inesistente" });
					}
					if (!list.includes(dir)) list.push(dir);
					writeFileSync(SOURCES(), JSON.stringify(list));
					return send(res, 200, { path: dir, files: await listSourceFiles(dir) });
				}
				if (req.method === "DELETE") {
					const next = list.filter((x) => x !== body.path);
					writeFileSync(SOURCES(), JSON.stringify(next));
					return send(res, 200, { removed: body.path });
				}
				return send(res, 404, { error: "rotta sconosciuta" });
			}

			// GET /api/file?path=<assoluto>  (anteprima originali: solo wikiRoot o cartelle sorgente)
			if (req.method === "GET" && url.pathname === "/api/file") {
				const raw = (url.searchParams.get("path") ?? "").replace(/\\/g, "/");
				if (!raw) return send(res, 400, { error: "manca path" });
				const file = normalize(raw);
				const roots = [resolve(config.wikiRoot), ...(await readSources()).map((s) => normalize(resolve(String(s))))];
				const inside = roots.some((r) => file === r || file.startsWith(r + sep));
				if (raw.includes("..") || !inside) return send(res, 403, { error: "fuori dalle cartelle consentite" });
				try {
					if (!(await stat(file)).isFile()) return send(res, 404, { error: "non trovato" });
				res.writeHead(200, { "Content-Type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream" });
					return res.end(await readFile(file));
				} catch {
					return send(res, 404, { error: "non trovato" });
				}
			}

			// POST /api/wiki/:slug/convert-raw {file, engine?, pages?, deskew?} (raw già in wiki)
			if (req.method === "POST" && seg[0] === "api" && seg[1] === "wiki" && seg[3] === "convert-raw") {
				const slug = decodeURIComponent(seg[2]);
				const body = JSON.parse((await readBody(req)) || "{}");
				const base = String(body.file ?? "").replace(/\\/g, "/");
				if (!base || base.includes("/") || base.includes("..")) return send(res, 400, { error: "file raw non valido" });
				const dir = join(config.wikiRoot, "wiki", slug);
				const src = normalize(join(dir, "raw", base));
				if (src !== join(dir, "raw", base) || !src.startsWith(dir + sep)) return send(res, 403, { error: "fuori dalla wiki" });
				try {
					if (!(await stat(src)).isFile()) return send(res, 404, { error: "originale assente" });
				} catch {
					return send(res, 404, { error: "originale assente" });
				}
				const result = await daemon.convert(
					{ path: src, engine: body.engine ?? "docling", pages: body.pages ?? null, workdir: join(tmpdir(), "ocr-pi"), deskew: !!body.deskew },
					process.cwd(),
				);
				const assets = [];
				for (const a of result.assets ?? []) {
					try {
						assets.push({ name: String(a).split("/").pop(), dataBase64: (await readFile(String(a))).toString("base64") });
					} catch {
						/* asset mancante: salta */
					}
				}
				return send(res, 200, { ...result, assets });
			}

			// POST /api/wiki {slug}  (nuova wiki)
			if (req.method === "POST" && url.pathname === "/api/wiki") {
				const body = JSON.parse((await readBody(req)) || "{}");
				if (!body.slug) return send(res, 400, { error: "manca slug" });
				return send(res, 200, await cli(["create", body.slug]));
			}

			// POST /api/convert-upload {name, dataBase64, engine?, pages?, deskew?}
			if (req.method === "POST" && url.pathname === "/api/convert-upload") {
				const body = JSON.parse((await readBody(req, 64 * 1024 * 1024)) || "{}");
				if (!body.name || !body.dataBase64) return send(res, 400, { error: "servono name e dataBase64" });
				const dir = mkdtempSync(join(tmpdir(), "ocr-pi-up-"));
				const src = join(dir, body.name.replace(/[^\w.\-]+/g, "_"));
				writeFileSync(src, Buffer.from(body.dataBase64, "base64"));
				const result = await daemon.convert(
					{ path: src, engine: body.engine ?? "docling", pages: body.pages ?? null, workdir: dir, deskew: !!body.deskew },
					process.cwd(),
				);
				const assets = [];
				for (const a of result.assets ?? []) {
					try {
						assets.push({ name: String(a).split("/").pop(), dataBase64: (await readFile(String(a))).toString("base64") });
					} catch {
						/* asset mancante: salta */
					}
				}
				return send(res, 200, { ...result, assets });
			}

			// POST /api/wiki/:slug/{add,review,remove,export} | POST /api/wiki/import
			if (req.method === "POST" && seg[0] === "api" && seg[1] === "wiki") {
				const body = JSON.parse((await readBody(req)) || "{}");
				if (seg[2] === "import" && seg.length === 3) {
					let file = body.file ?? "";
					if (!file && body.name && body.dataBase64) {
						const dir = mkdtempSync(join(tmpdir(), "ocr-pi-imp-"));
						file = join(dir, body.name);
						writeFileSync(file, Buffer.from(body.dataBase64, "base64"));
					}
					if (!file) return send(res, 400, { error: "manca file zip" });
					return send(res, 200, await cli(["import", file, ...(body.merge ? ["--merge"] : [])]));
				}
				if (seg.length !== 4) return send(res, 404, { error: "rotta sconosciuta" });
				const slug = decodeURIComponent(seg[2]);
				const op = seg[3];
				if (op === "add") {
					let file = body.file ?? "";
				let rawTmp = "";
				// raw da upload (bytes) oppure da path server consentito (sorgenti/wiki)
				if (body.rawName && body.rawDataBase64) {
					const rdir = mkdtempSync(join(tmpdir(), "ocr-pi-raw-"));
				rawTmp = join(rdir, String(body.rawName).split("/").pop().replace(/[^\w.\-]+/g, "_"));
					writeFileSync(rawTmp, Buffer.from(body.rawDataBase64, "base64"));
				} else if (body.rawWiki && body.rawFile) {
                    const rw = String(body.rawWiki).replace(/\\/g, "/");
                    const rf = String(body.rawFile).replace(/\\/g, "/").split("/").pop();
                    if (!rw || !rf || rw.includes("..") || rf.includes("..")) return send(res, 400, { error: "raw non valido" });
                    const rp2 = normalize(join(config.wikiRoot, "wiki", rw, "raw", rf));
                    const wdir2 = normalize(join(config.wikiRoot, "wiki", rw));
                    if (rp2 !== wdir2 && !rp2.startsWith(wdir2 + sep)) return send(res, 403, { error: "raw fuori dalla wiki" });
                    try {
                        if (!(await stat(rp2)).isFile()) return send(res, 404, { error: "raw assente" });
                    } catch {
                        return send(res, 404, { error: "raw assente" });
                    }
                    rawTmp = rp2;
                } else if (body.rawPath) {
					const rp = normalize(String(body.rawPath).replace(/\\/g, "/"));
					const roots = [resolve(config.wikiRoot), ...(await readSources()).map((s) => normalize(resolve(String(s))))];
					const inside = roots.some((r) => rp === r || rp.startsWith(r + sep));
					if (!inside) return send(res, 403, { error: "raw fuori dalle cartelle consentite" });
					try {
						if (!(await stat(rp)).isFile()) return send(res, 404, { error: "raw assente" });
					} catch {
						return send(res, 404, { error: "raw assente" });
					}
					rawTmp = rp;
				}
					if (!file && body.markdown) {
						const dir = mkdtempSync(join(tmpdir(), "ocr-pi-add-"));
						for (const a of body.assets ?? []) {
							if (a.name && a.dataBase64) {
								writeFileSync(join(dir, a.name.replace(/[^\w.\-]+/g, "_")), Buffer.from(a.dataBase64, "base64"));
							}
						}
						file = join(dir, "voce.md");
						writeFileSync(file, body.markdown);
					}
					if (!file) return send(res, 400, { error: "servono file o markdown" });
					const args = ["add", slug, file];
					if (body.title) args.push("--titolo", body.title);
					if (rawTmp) args.push("--raw", rawTmp);
					return send(res, 200, await cli(args));
				}
				if (op === "link-raw") {
					return send(res, 200, await cli(["link-raw", slug]));
				}
				if (op === "review") {
					if (!body.voce || !body.stato) return send(res, 400, { error: "servono voce e stato" });
					return send(res, 200, await cli(["review", slug, body.voce, body.stato]));
				}
				if (op === "remove") {
					const args = ["remove", slug, ...(body.voce ? [body.voce] : []), ...(body.confirm ? ["--confirm"] : [])];
					return send(res, 200, await cli(args));
				}
				if (op === "export") {
					return send(res, 200, await cli(["export", slug, ...(body.senza_raw ? ["--senza-raw"] : [])]));
				}
				if (op === "rename") {
					if (!body.nuovo) return send(res, 400, { error: "manca nuovo nome" });
					return send(res, 200, await cli(["rename", slug, body.nuovo]));
				}
				return send(res, 404, { error: "rotta sconosciuta" });
			}

			// POST /api/chat/new  (nuova conversazione dock)
			if (req.method === "POST" && url.pathname === "/api/chat/new") {
				const { resetSession } = await import("./dock.mjs");
				resetSession();
				return send(res, 200, { reset: true });
			}

			// POST /api/chat {message, images?[{name,dataBase64}], ocr?, sensitive?}  (SSE dock)
			if (req.method === "POST" && url.pathname === "/api/chat") {
				const body = JSON.parse((await readBody(req, 64 * 1024 * 1024)) || "{}");
				const { getSession, resetSession } = await import("./dock.mjs");
				res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
				const say = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
				if (!(body.message ?? "").trim() && !(body.images ?? []).length) {
					say({ type: "text_delta", delta: "Scrivimi una domanda o allega un file, poi riprova." });
					say({ type: "done" });
					return res.end();
				}
				try {
					const images = body.images ?? [];
					if (images.length && !body.ocr && body.sensitive) {
						say({ type: "text_delta", delta: "Nativa non mascherabile: attiva OCR per i documenti sensibili, poi riprova." });
						say({ type: "done" });
						return res.end();
					}
					const ctx = body.context && typeof body.context === "object" ? body.context : {};
					const ctxWiki = String(ctx.wiki || "").slice(0, 64);
					const ctxVoce = String(ctx.voce || "").slice(0, 128);
					let prompt = body.message ?? "";
					if (ctxWiki || ctxVoce) {
						prompt = `[Contesto wiki${ctxWiki ? ` "${ctxWiki}"` : ""}${ctxVoce ? ` voce "${ctxVoce}"` : ""}. Strumenti: wiki_get per leggere una voce nota (1 chiamata), wiki_search solo per trovare, wiki_list per elencare. Mai raw/, mai path assoluti: gli originali restano locali, usa la trascrizione md. Masking PII automatico via j-pii: rispondi normalmente e riporta fedelmente i placeholder che i tool restituiscono ([CF_1], [FULLNAME_1]...), senza inventarne altri tipo <placeholder>. Per creare: wiki_add con titolo e markdown veri e completi.]\n\n` + prompt;
					} else {
						prompt = `[Contesto wiki non selezionata. Strumenti: wiki_get per voce nota, wiki_search per trovare, wiki_list per elencare. Mai raw/. Masking automatico: riporta i placeholder reali, non inventarli.]\n\n` + prompt;
					}
					const sdkImages = [];
					for (const img of images) {
						if (body.ocr) {
							const dir = mkdtempSync(join(tmpdir(), "ocr-pi-dock-"));
							const src = join(dir, String(img.name ?? "img.png").replace(/[^\w.\-]+/g, "_"));
							writeFileSync(src, Buffer.from(img.dataBase64, "base64"));
							const r = await daemon.convert({ path: src, engine: body.engine ?? "docling", pages: body.pages ?? null, workdir: dir, deskew: !!body.deskew }, process.cwd());
							prompt += `\n\n[OCR ${r.engine}: ${img.name}]\n${r.markdown}`;
						} else {
							sdkImages.push({ type: "image", source: { type: "base64", mediaType: "image/png", data: img.dataBase64 } });
						}
					}
					const dockCli = async (args, extra = {}) => {
						const flat = (args || []).join(" ");
						if (/\braw\//.test(flat) || flat.includes("..")) throw new Error("Originali non esposti al modello: usa la trascrizione doc/*.md collegata");
						if (extra.markdown) {
							// wiki_add via agent: ["add", wiki, file?, --titolo?] -> file da markdown (filtra stringhe vuote: bug add)
							const dir = mkdtempSync(join(tmpdir(), "ocr-pi-dockadd-"));
							const file = join(dir, "voce.md");
							writeFileSync(file, extra.markdown);
							const head = args.slice(0, 2);
							const tail = (args.slice(2) || []).filter((a) => String(a ?? "").trim() !== "");
							return cli([...head, file, ...tail]);
						}
						return cli((args || []).filter((a) => String(a ?? "").trim() !== ""));
					};
					const sessionOpts = {
						cli: dockCli,
						daemonConvert: (a) => daemon.convert({ ...a, workdir: join(tmpdir(), "ocr-pi") }, process.cwd()),
						jpiExtension: join(OCR_PI, "..", "extension", "j-pii.ts"),
						model: process.env.UI_MODEL ?? "opencode/muse-spark-1.3-contributor-free",
					};
					const timeoutMs = Number(process.env.UI_CHAT_TIMEOUT_MS ?? 180000);
					const jpiNotes = [];
					let preSegs = [];
					let preEngine = "none";
					try {
						const pre = await maskPreviewForLog(prompt);
						preSegs = pre.segments || [];
						preEngine = pre.engine || "none";
					} catch {}
					const phByLabel = {};
					for (const sg of preSegs) phByLabel[sg.label] = (phByLabel[sg.label] || 0) + 1;
					const placeholders = Object.entries(phByLabel).map(([k, n]) => `[${k}_x${n}]`);
					const leakSuspect = preSegs.length > 0 && !body.sensitive;
					let maskedSnippet = String(prompt).slice(0, 300);
					try {
						const vals = [...new Set(preSegs.map((sg) => String(prompt).slice(sg.start, sg.end)).filter(Boolean))].sort((a, b) => b.length - a.length).slice(0, 20);
						for (const v of vals) maskedSnippet = maskedSnippet.split(v).join("[PII]");
					} catch {}
					const origConsoleError = console.error;
					const runOnce = async () => {
						const session = await getSession(sessionOpts);
						let innerGot = false;
						session.subscribe((event) => {
							if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
								innerGot = true;
								say({ type: "text_delta", delta: event.assistantMessageEvent.delta });
							}
							if (event.type === "tool_execution_start") {
								innerGot = true;
								say({ type: "tool", tool: event.toolName });
							}
							if (event.type === "message_end" && event.message && event.message.role === "assistant") {
								try {
									const blocks = Array.isArray(event.message.content) ? event.message.content : [];
									const txt = blocks.filter((b) => b && b.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
									if (txt.trim()) { innerGot = true; say({ type: "restored", text: txt }); }
								} catch {}
							}
						});
						let timer;
						console.error = (...a) => {
							try {
								const line = a.map((x) => String(x)).join(" ");
								if (line.includes("[j-pii]")) jpiNotes.push(line);
							} catch {}
							origConsoleError(...a);
						};
						try {
							await Promise.race([
								session.prompt(prompt, sdkImages.length ? { images: sdkImages } : undefined),
								new Promise((_, reject) => {
									timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "CHAT_TIMEOUT" })), timeoutMs);
								}),
							]);
						} finally {
							clearTimeout(timer);
							console.error = origConsoleError;
						}
						return innerGot;
					};
					let gotContent;
					try {
						gotContent = await runOnce();
					} catch (err) {
						if (err && err.code === "CHAT_TIMEOUT") {
							resetSession();
							console.error("[dock] prompt senza risposta dopo " + timeoutMs + " ms: sessione azzerata");
							say({ type: "text_delta", delta: "Nessuna risposta entro " + Math.round(timeoutMs / 1000) + " secondi: ho azzerato la conversazione. Riprova con un messaggio semplice; se persiste, prova JPII_ANALYZER=fake o un altro modello via UI_MODEL." });
							logLlm({ model: process.env.UI_MODEL ?? "opencode/muse-spark-1.3-contributor-free", wiki: ctxWiki, voce: ctxVoce, promptChars: String(prompt).length, images: (body.images || []).length, ocr: !!body.ocr, sensitive: !!body.sensitive, engine: preEngine, placeholders, piiCount: preSegs.length, leakSuspect, blocked: true, hint: "Timeout: sessione azzerata" });
							say({ type: "done" });
							return res.end();
						}
						if (/already processing/i.test((err && err.message) || "")) {
							resetSession();
							console.error("[dock] sessione incastrata, riprovo da zero");
							gotContent = await runOnce();
						} else {
							throw err;
						}
					}
					const blocked = !gotContent;
					if (!gotContent) {
						say({ type: "text_delta", delta: jpiBlockMessage(jpiNotes) });
						say({ type: "log", event: "jpi-block" });
					}
					logLlm({ model: process.env.UI_MODEL ?? "opencode/muse-spark-1.3-contributor-free", wiki: ctxWiki, voce: ctxVoce, promptChars: String(prompt).length, images: (body.images || []).length, ocr: !!body.ocr, sensitive: !!body.sensitive, engine: preEngine, placeholders, piiCount: preSegs.length, leakSuspect, blocked, hint: blocked ? "Bloccata da j-pii: apri Trasparenza per motivo e passa a mask" : leakSuspect ? "PII rilevata senza mask: attiva Sensibili (mask) o verifica placeholders" : "" });
					say({ type: "done" });
					return res.end();
				} catch (err) {
					say({ type: "text_delta", delta: `errore: ${err instanceof Error ? err.message : String(err)}` });
					say({ type: "done" });
					return res.end();
				}
			}

			return send(res, 404, { error: "rotta sconosciuta" });
		} catch (err) {
			sendErr(res, err);
		}
	});
	server.on("close", () => daemon.stop());
	return server;
}

export function prewarm() {
	if (process.env.UI_PREWARM === "0") return;
	try { daemon.ensure(process.cwd()); } catch {}
	try { warmupOcr().catch(() => {}); } catch {}
	if ((process.env.JPII_ANALYZER ?? "real") !== "fake") {
		const url = `${process.env.JPII_SIDECAR_URL ?? "http://127.0.0.1:5005"}/health`;
		const ctl = new AbortController();
		const t = setTimeout(() => { try { ctl.abort(); } catch {} }, 2000);
		fetch(url, { signal: ctl.signal }).catch(() => {}).finally(() => clearTimeout(t));
	}
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
	const { mkdirSync } = await import("node:fs");
	mkdirSync(join(config.wikiRoot, "wiki"), { recursive: true });
	createApp().listen(config.port, () => {
		console.log(`ocr-pi ui su http://localhost:${config.port} (wiki: ${config.wikiRoot})`);
		prewarm();
	});
}
