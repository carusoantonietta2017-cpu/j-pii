// ocr-pi hook (b6, spec #21): doppia domanda una tantum sulle immagini
// allegate + OCR locale + Mask j-pii. Ricorda solo in memoria di sessione,
// fail-closed senza UI o senza risposta.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { maskTextForOcr } from "./j-pii.ts";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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

let runner: Runner = defaultRunner;
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

const failClosed = (why: string): never => {
	throw new Error(`ocr-pi blocked: ${why} (fail-closed, niente inviato)`);
};

export default function (pi: ExtensionAPI) {
	pi.on("session_start", () => {
		__resetSession();
	});
	pi.on("session_shutdown", () => {
		__resetSession();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const images = (event.images ?? []) as Array<{ data: string; mimeType: string }>;
		if (images.length === 0) return undefined;
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

		const parts: string[] = [];
		for (let i = 0; i < images.length; i++) {
			const path = await imageToTmpFile(images[i]);
			const r = await runner(path, ctx.cwd);
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
