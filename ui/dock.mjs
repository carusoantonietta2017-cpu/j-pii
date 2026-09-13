// Dock agente (u3): sessione SDK pi + custom tools wiki/ocr. Solo SDK come dipendenza logica
// (import dinamico: i test delle funzioni pure non caricano pi).
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- implementazioni tool (testabili senza SDK): wraps sopra cli.py / demone ---
export function makeTools({ cli, daemonConvert, wikiRoot }) {
	return {
		async wiki_search({ query, stato = "", wiki = "" }) {
			return cli(["search", query, ...(stato ? ["--stato", stato] : []), ...(wiki ? ["--wiki", wiki] : [])]);
		},
		async wiki_list() {
			return cli(["list"]);
		},
		async wiki_add({ wiki, markdown = "", file = "", title = "" }) {
			const args = ["add", wiki, file];
			if (title) args.push("--titolo", title);
			if (!file && !markdown) throw new Error("servono file o markdown");
			return cli(args, { markdown });
		},
		async wiki_review({ wiki, voce, stato }) {
			return cli(["review", wiki, voce, stato]);
		},
		async wiki_get({ wiki, voce }) {
			if (!wiki || !voce) throw new Error("servono wiki e voce");
			return cli(["get", wiki, voce]);
		},
		async ocr_convert({ path = "", dataBase64 = "", name = "img.png", engine = "docling" }) {
			let src = path;
			if (!src && dataBase64) {
				const dir = mkdtempSync(join(tmpdir(), "ocr-pi-dock-"));
				src = join(dir, name.replace(/[^\w.\-]+/g, "_"));
				writeFileSync(src, Buffer.from(dataBase64, "base64"));
			}
			if (!src) throw new Error("servono path o dataBase64");
			return daemonConvert({ path: src, engine });
		},
	};
}

// --- sessione SDK (caricata solo all'uso: import dinamico, niente costo nei test) ---
let sessionPromise = null;

export async function getSession({ cli, daemonConvert, jpiExtension, model: modelRef }) {
	if (sessionPromise) return sessionPromise;
	sessionPromise = (async () => {
		try {
			return await createSession({ cli, daemonConvert, jpiExtension, modelRef });
		} catch (err) {
			// mai avvelenare la cache: il prossimo messaggio riprova da zero
			sessionPromise = null;
			throw err;
		}
	})();
	return sessionPromise;
}

async function createSession({ cli, daemonConvert, jpiExtension, modelRef }) {
		const pi = await import("@earendil-works/pi-coding-agent");
		const { DefaultResourceLoader, SessionManager, createAgentSession, getAgentDir, ModelRuntime } = pi;
		const { Type } = await import("typebox");
		const tools = makeTools({ cli, daemonConvert });
		const factories = [(piApi) => {
			piApi.registerTool({
				name: "wiki_search",
				label: "Wiki Search",
				description: "Cerca nelle voci wiki per nome o contenuto. Se conosci già wiki e voce esatta, usa wiki_get invece di cercare ancora.",
				parameters: Type.Object({ query: Type.String(), stato: Type.Optional(Type.String()), wiki: Type.Optional(Type.String()) }),
				execute: async (_id, params) => ({ content: [{ type: "text", text: JSON.stringify(await tools.wiki_search(params)) }], details: {} }),
			});
			piApi.registerTool({
				name: "wiki_list",
				label: "Wiki List",
				description: "Elenca i dizionari wiki disponibili.",
				parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text", text: JSON.stringify(await tools.wiki_list()) }], details: {} }),
			});
			piApi.registerTool({
				name: "wiki_add",
				label: "Wiki Add",
				description: "Crea una voce draft con titolo e markdown reali e completi. Mai placeholder tipo <placeholder> o <contenuto-placeholder>: scrivi contenuto vero.",
				parameters: Type.Object({ wiki: Type.String(), markdown: Type.String(), title: Type.Optional(Type.String()) }),
				execute: async (_id, params) => ({ content: [{ type: "text", text: JSON.stringify(await tools.wiki_add(params)) }], details: {} }),
			});
			piApi.registerTool({
				name: "wiki_get",
				label: "Wiki Get",
				description: "Legge TUTTO il contenuto di una voce nota in 1 chiamata. Usalo invece di ripetere wiki_search quando conosci wiki e nome voce.",
				parameters: Type.Object({ wiki: Type.String(), voce: Type.String() }),
				execute: async (_id, params) => ({ content: [{ type: "text", text: JSON.stringify(await tools.wiki_get(params)) }], details: {} }),
			});
			piApi.registerTool({
				name: "ocr_convert",
				label: "OCR Convert",
				description: "Converte un'immagine allegata in Markdown locale (già fatto dal server per gli allegati: riusa il testo OCR nel prompt, non richiamarlo se non serve).",
				parameters: Type.Object({ name: Type.Optional(Type.String()), dataBase64: Type.Optional(Type.String()) }),
				execute: async (_id, params) => ({ content: [{ type: "text", text: JSON.stringify(await tools.ocr_convert(params)) }], details: {} }),
			});
			piApi.registerTool({
				name: "wiki_review",
				label: "Wiki Review",
				description: "Cambia stato voce: draft/reviewed/versioned.",
				parameters: Type.Object({ wiki: Type.String(), voce: Type.String(), stato: Type.String() }),
				execute: async (_id, params) => ({ content: [{ type: "text", text: JSON.stringify(await tools.wiki_review(params)) }], details: {} }),
			});
		}];
		const loader = new DefaultResourceLoader({
			cwd: process.cwd(),
			agentDir: getAgentDir(),
			additionalExtensionPaths: [jpiExtension],
			extensionFactories: factories,
		});
		await loader.reload();
		const modelRuntime = await ModelRuntime.create();
		const [provider, id] = String(modelRef ?? "opencode/muse-spark-1.3-contributor-free").split("/", 2);
		const model = modelRuntime.getModel(provider, id);
		if (!model) throw new Error(`modello non trovato: ${modelRef}`);
		const { session } = await createAgentSession({
			model,
			modelRuntime,
			sessionManager: SessionManager.inMemory(),
			resourceLoader: loader,
		});
		return session;
}

export function resetSession() {
	sessionPromise = null;
}
