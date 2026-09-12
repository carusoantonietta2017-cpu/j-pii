// Backend PWA ocr-pi (u1): statici + REST sopra demone/cli.py + SSE chat (echo fino a u3).
// Zero dipendenze. Config: PORT, UI_WIKI_ROOT (default ./wikis), UI_PYTHON.
import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
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

			// GET /api/wiki/:slug  (dettaglio: lista filtrata)
			if (req.method === "GET" && seg[0] === "api" && seg[1] === "wiki" && seg.length === 3) {
				const slug = decodeURIComponent(seg[2]);
				const all = await cli(["list"]);
				const found = all.find((w) => w.slug === slug);
				if (!found) return send(res, 404, { error: `wiki assente: ${slug}` });
				return send(res, 200, found);
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

			// POST /api/wiki/:slug/{add,review,remove,export} | POST /api/wiki/import
			if (req.method === "POST" && seg[0] === "api" && seg[1] === "wiki") {
				const body = JSON.parse((await readBody(req)) || "{}");
				if (seg[2] === "import" && seg.length === 3) {
					if (!body.file) return send(res, 400, { error: "manca file zip" });
					return send(res, 200, await cli(["import", body.file, ...(body.merge ? ["--merge"] : [])]));
				}
				if (seg.length !== 4) return send(res, 404, { error: "rotta sconosciuta" });
				const slug = decodeURIComponent(seg[2]);
				const op = seg[3];
				if (op === "add") {
					let file = body.file ?? "";
					if (!file && body.markdown) {
						const dir = mkdtempSync(join(tmpdir(), "ocr-pi-add-"));
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
				return send(res, 404, { error: "rotta sconosciuta" });
			}

			// POST /api/chat (SSE echo fino a u3)
			if (req.method === "POST" && url.pathname === "/api/chat") {
				const body = JSON.parse((await readBody(req)) || "{}");
				res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
				res.write(`data: ${JSON.stringify({ type: "text_delta", delta: `(dock non collegato, vedi u3 — hai scritto: ${(body.message ?? "").slice(0, 80)})` })}\n\n`);
				res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
				return res.end();
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
	createApp().listen(config.port, () => console.log(`ocr-pi ui su http://localhost:${config.port} (wiki: ${config.wikiRoot})`));
}
