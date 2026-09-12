// Backend PWA ocr-pi (u1): statici + REST sopra demone/cli.py + SSE chat (echo fino a u3).
// Zero dipendenze. Config: PORT, UI_WIKI_ROOT (default ./wikis), UI_PYTHON.
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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

const daemon = new Daemon();

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
	".js": "text/javascript",
	".css": "text/css",
	".json": "application/json",
	".png": "image/png",
	".svg": "image/svg+xml",
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
			if (req.method === "GET" && seg[0] === "api" && seg[1] === "wiki" && seg[3] === "file") {
				const dir = join(config.wikiRoot, "wiki", decodeURIComponent(seg[2]));
				const rel = (url.searchParams.get("path") ?? "").replace(/\\/g, "/");
				const file = normalize(join(dir, rel));
				if (rel.includes("..") || (file !== dir && !file.startsWith(dir + sep))) {
					return send(res, 403, { error: "fuori dalla wiki" });
				}
				try {
					if (!(await stat(file)).isFile()) return send(res, 404, { error: "non trovato" });
					const ext = extname(file);
					res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
					return res.end(await readFile(file));
				} catch {
					return send(res, 404, { error: "non trovato" });
				}
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
				return send(res, 200, result);
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
					return send(res, 200, await cli(args));
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
				const { getSession } = await import("./dock.mjs");
				res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
				const say = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
				try {
					const images = body.images ?? [];
					if (images.length && !body.ocr && body.sensitive) {
						say({ type: "text_delta", delta: "Nativa non mascherabile: attiva OCR per i documenti sensibili, poi riprova." });
						say({ type: "done" });
						return res.end();
					}
					let prompt = body.message ?? "";
					const sdkImages = [];
					for (const img of images) {
						if (body.ocr) {
							const dir = mkdtempSync(join(tmpdir(), "ocr-pi-dock-"));
							const src = join(dir, String(img.name ?? "img.png").replace(/[^\w.\-]+/g, "_"));
							writeFileSync(src, Buffer.from(img.dataBase64, "base64"));
							const r = await daemon.convert({ path: src, engine: body.engine ?? "docling", pages: null, workdir: dir, deskew: !!body.deskew }, process.cwd());
							prompt += `\n\n[OCR ${r.engine}: ${img.name}]\n${r.markdown}`;
						} else {
							sdkImages.push({ type: "image", source: { type: "base64", mediaType: "image/png", data: img.dataBase64 } });
						}
					}
					const dockCli = async (args, extra = {}) => {
						if (extra.markdown) {
							// wiki_add via agent: ["add", wiki, file?, --titolo?] -> file da markdown
							const dir = mkdtempSync(join(tmpdir(), "ocr-pi-dockadd-"));
							const file = join(dir, "voce.md");
							writeFileSync(file, extra.markdown);
							const head = args.slice(0, 2);
							return cli([...head, file, ...args.slice(2)]);
						}
						return cli(args);
					};
					const session = await getSession({
						cli: dockCli,
						daemonConvert: (a) => daemon.convert({ ...a, workdir: join(tmpdir(), "ocr-pi") }, process.cwd()),
						jpiExtension: join(OCR_PI, "..", "extension", "j-pii.ts"),
						model: process.env.UI_MODEL ?? "opencode/muse-spark-1.3-contributor-free",
					});
					session.subscribe((event) => {
						if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
							say({ type: "text_delta", delta: event.assistantMessageEvent.delta });
						}
						if (event.type === "tool_execution_start") say({ type: "tool", tool: event.toolName });
					});
					await session.prompt(prompt, sdkImages.length ? { images: sdkImages } : undefined);
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

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
	const { mkdirSync } = await import("node:fs");
	mkdirSync(join(config.wikiRoot, "wiki"), { recursive: true });
	createApp().listen(config.port, () => console.log(`ocr-pi ui su http://localhost:${config.port} (wiki: ${config.wikiRoot})`));
}
