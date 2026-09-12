// ocr-pi hook (b6, spec #21): doppia domanda una tantum sulle immagini
// allegate + OCR locale + Mask j-pii. Ricorda solo in memoria di sessione,
// fail-closed senza UI o senza risposta.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { maskTextForOcr } from "./j-pii.ts";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

export interface Converted {
	markdown: string;
	assets: string[];
	pages: number;
	engine: string;
	seconds: number;
}

export type Runner = (imagePath: string, cwd: string) => Promise<Converted>;

const EXT_DIR = dirname(fileURLToPath(import.meta.url));

function findPython(): string {
	if (process.env.OCRPI_PYTHON) return process.env.OCRPI_PYTHON;
	return join(EXT_DIR, "..", "ocr-pi", ".venv", "bin", "python");
}

/** Demone converter persistente: una sola istanza, modelli caricati una volta. */
export class Daemon {
	private proc: ChildProcess | undefined;
	private nextId = 1;
	private pending = new Map<number, (msg: any) => void>();
	private buf = "";

	private spawn(cwd: string): void {
		this.proc = spawn(findPython(), [join(EXT_DIR, "..", "ocr-pi", "daemon.py")], {
			cwd,
			stdio: ["pipe", "pipe", "inherit"],
		});
		this.proc.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
		this.proc.on("exit", () => {
			for (const resolve of this.pending.values()) {
				resolve({ id: -1, ok: false, error: "demone terminato" });
			}
			this.pending.clear();
			this.proc = undefined;
		});
	}

	private onData(chunk: Buffer): void {
		this.buf += chunk.toString("utf-8");
		let nl: number;
		while ((nl = this.buf.indexOf("\n")) >= 0) {
			const line = this.buf.slice(0, nl).trim();
			this.buf = this.buf.slice(nl + 1);
			if (!line) continue;
			try {
				const msg = JSON.parse(line);
				this.pending.get(msg.id)?.(msg);
				this.pending.delete(msg.id);
			} catch { /* riga non JSON: ignora */ }
		}
	}

	async request(imagePath: string, cwd: string, timeoutMs = 900_000, engine = "docling"): Promise<Converted> {
		if (!this.proc || this.proc.exitCode !== null) {
			this.proc = undefined;
			this.pending.clear();
			this.spawn(cwd);
		}
		const id = this.nextId++;
		const proc = this.proc;
		if (!proc?.stdin?.writable) throw new Error("ocr-pi: demone non raggiungibile");
		const msg = await new Promise<any>((done) => {
			const timer = setTimeout(() => {
				if (this.pending.delete(id)) done({ id, ok: false, error: "demone: timeout risposta" });
			}, timeoutMs);
			this.pending.set(id, (m: any) => {
				clearTimeout(timer);
				done(m);
			});
			proc.stdin?.write(JSON.stringify({ id, op: "convert", source: imagePath, engine, workdir: join(tmpdir(), "ocr-pi") }) + "\n");
		});
		if (!msg.ok) throw new Error(`ocr-pi: conversione fallita: ${msg.error ?? "errore demone"}`);
		return msg.result as Converted;
	}

	stop(): void {
		try {
			this.proc?.stdin?.end();
		} catch { /* best-effort */ }
		this.proc = undefined;
		this.pending.clear();
	}
}

const defaultRunner: Runner = async (imagePath, cwd) => {
	const cli = join(EXT_DIR, "..", "ocr-pi", "convert_cli.py");
	try {
		const { stdout } = await execFileAsync(
			findPython(),
			[cli, "--source", imagePath, "--engine", "docling", "--workdir", join(tmpdir(), "ocr-pi")],
			{ cwd, timeout: 600_000, maxBuffer: 64 * 1024 * 1024 },
		);
		const out = JSON.parse(stdout) as Converted & { error?: string };
		if (out.error || typeof out.markdown !== "string") {
			throw new Error(out.error ?? "output conversione non valido");
		}
		return out;
	} catch (err) {
		throw new Error(`ocr-pi: conversione fallita per ${imagePath}: ${err instanceof Error ? err.message : String(err)}`);
	}
};

let daemon: Daemon | undefined;

const daemonFirstRunner: Runner = async (imagePath, cwd) => {
	try {
		if (!daemon) daemon = new Daemon();
		return await daemon.request(imagePath, cwd);
	} catch (err) {
		console.error(`ocr-pi: demone non disponibile, fallback spawn singolo: ${err instanceof Error ? err.message : String(err)}`);
		daemon = undefined;
		return defaultRunner(imagePath, cwd);
	}
};

export function __stopDaemon(): void {
	daemon?.stop();
	daemon = undefined;
}

let runner: Runner = daemonFirstRunner;
/** Solo test: inietta un converter finto. */
export function __setRunner(r: Runner): void {
	runner = r;
}

// Remember di sessione (mai su disco, come il mapping j-pii).
let asked = false;
let useOcr = false;
let sensitive = false;
export function __resetSession(): void {
	asked = false;
	useOcr = false;
	sensitive = false;
}

const IMG_SUFFIX = /\.(png|jpe?g|tiff?|webp|gif|bmp)$/i;

/** Percorsi immagine citati nel testo (tag <file name="..."> di pi, @path, path nudi). */
export function imagePathsFromPrompt(prompt: string): string[] {
	const found: string[] = [];
	const push = (raw: string) => {
		const clean = raw.replace(/^@/, "").replace(/^"|"$/g, "");
		if (!IMG_SUFFIX.test(clean)) return;
		try {
			if (existsSync(clean) && statSync(clean).isFile() && !found.includes(clean)) found.push(clean);
		} catch { /* path non locale: ignora */ }
	};
	for (const m of prompt.matchAll(/<file\s+name="([^"]+)">/g)) push(m[1]);
	for (const m of prompt.matchAll(/(?:^|\s)(@?\/[\w\-.\/]+\.(?:png|jpe?g|tiff?|webp|gif|bmp))/gi)) push(m[1]);
	return found;
}

const MIME_SUFFIX: Record<string, string> = {
	"image/png": ".png",
	"image/jpeg": ".jpg",
	"image/webp": ".webp",
	"image/gif": ".gif",
	"image/tiff": ".tiff",
};

export async function imageToTmpFile(
	img: { data: string; mimeType: string },
): Promise<string> {
	const b64 = img.data.includes(",") ? img.data.slice(img.data.indexOf(",") + 1) : img.data;
	const dir = join(tmpdir(), "ocr-pi-images");
	await mkdir(dir, { recursive: true });
	const suffix = MIME_SUFFIX[img.mimeType] ?? ".bin";
	const name = `${createHash("sha256").update(b64).digest("hex").slice(0, 16)}-${randomUUID().slice(0, 8)}${suffix}`;
	const path = join(dir, name);
	await writeFile(path, Buffer.from(b64, "base64"));
	return path;
}

/** Avanzamento facoltativo: non deve mai rompere (test e RPC senza widget). */
function progress(ctx: any, msg?: string): void {
	try {
		if (msg) {
			ctx.ui.notify?.(msg, "info");
			ctx.ui.setStatus?.("ocr-pi", msg);
		} else {
			ctx.ui.setStatus?.("ocr-pi", "");
		}
	} catch { /* ui assente: ignora */ }
}

const failClosed = (why: string): never => {
	throw new Error(`ocr-pi blocked: ${why} (fail-closed, niente inviato)`);
};

export default function (pi: ExtensionAPI) {
	pi.on("session_start", () => {
		__resetSession();
	});
	pi.on("session_shutdown", () => {
		__resetSession();
		__stopDaemon();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const images = (event.images ?? []) as Array<{ data: string; mimeType: string }>;
		const cited = imagePathsFromPrompt(event.prompt ?? "");
		if (images.length === 0 && cited.length === 0) return undefined;
		if (!asked) {
		if (!ctx.hasUI) failClosed("immagini allegate ma nessuna UI per le domande");

		const ocr = await ctx.ui.select("ocr-pi: usare l'OCR locale per le immagini allegate?", [
			"Sì, converti in locale",
			"No, invia immagini originali",
		]);
		if (ocr === undefined) failClosed("risposta mancata alla domanda OCR");
		const sens = await ctx.ui.select("ocr-pi: il documento contiene dati sensibili?", [
			"Sì, maschera con j-pii",
			"No",
		]);
		if (sens === undefined) failClosed("risposta mancata alla domanda sensibili");
		asked = true;
		useOcr = (ocr as string).startsWith("Sì");
		sensitive = (sens as string).startsWith("Sì");
		}
		if (!useOcr) {
			ctx.ui.notify("ocr-pi: immagini originali inviate al provider (non convertite)", "warning");
			return undefined;
		}

		const sources: string[] = [];
		for (const c of cited) sources.push(c);
		for (const img of images) sources.push(await imageToTmpFile(img));
		const parts: string[] = [];
		for (let i = 0; i < sources.length; i++) {
			const path = sources[i];
			progress(ctx, `ocr-pi: conversione immagine ${i + 1}/${sources.length} in corso (la prima volta ~2 min)...`);
			const r = await runner(path, ctx.cwd);
			progress(ctx);
			let md = r.markdown;
			if (sensitive) {
				const m = await maskTextForOcr(md, ctx.cwd);
				md = m.text;
				if (m.doubtfulForced > 0) {
					ctx.ui.notify(
						`ocr-pi: ${m.doubtfulForced} span dubbi forzati in mask (fail-safe)`,
						"warning",
					);
				}
			}
			parts.push(`### Immagine ${i + 1} (OCR ${r.engine}, ${r.seconds}s)\n\n${md}`);
		}
		return {
			message: { customType: "ocr-pi", content: parts.join("\n\n"), display: true },
		};
	});
}
