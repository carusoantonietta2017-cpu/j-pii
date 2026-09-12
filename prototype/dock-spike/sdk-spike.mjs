/** Spike dock: sessione SDK + custom tool wiki_search su fixture + prompt reale.
 *  Uso: node prototype/dock-spike/sdk-spike.mjs  (serve provider configurato)
 *  Log su stdout = tool chiamati + risposta finale.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	DefaultResourceLoader,
	SessionManager,
	createAgentSession,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const FIXTURE = new URL("./fixture/", import.meta.url).pathname;
const calls = [];

const loader = new DefaultResourceLoader({
	cwd: process.cwd(),
	agentDir: getAgentDir(),
	extensionFactories: [
		(pi) => {
			pi.registerTool({
				name: "wiki_search",
				label: "Wiki Search",
				description: "Cerca nelle voci wiki. Usa per trovare documenti.",
				parameters: Type.Object({ query: Type.String() }),
				execute: async (_toolCallId, params, _signal, _onUpdate, _ctx) => {
					calls.push(params.query);
					const hits = [];
					for (const f of readdirSync(FIXTURE).filter((x) => x.endsWith(".md"))) {
						const text = readFileSync(join(FIXTURE, f), "utf-8");
						text.split("\n").forEach((line, i) => {
							if (line.toLowerCase().includes(params.query.toLowerCase())) {
								hits.push(`${f}:${i + 1}: ${line.trim()}`);
							}
						});
					}
					return { content: [{ type: "text", text: hits.join("\n") || "niente" }], details: {} };
				},
			});
		},
	],
});
await loader.reload();

const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
const modelRuntime = await ModelRuntime.create();
const model = modelRuntime.getModel("opencode", "muse-spark-1.3-contributor-free");
if (!model) throw new Error("modello opencode non trovato");
const { session } = await createAgentSession({
	model,
	modelRuntime,
	sessionManager: SessionManager.inMemory(),
	resourceLoader: loader,
});

let answer = "";
const seen = [];
session.subscribe((event) => {
	seen.push(event.type);
	if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
		answer += event.assistantMessageEvent.delta;
	}
});

try {
	await session.prompt("Usa wiki_search con query 'iva'. Rispondi solo con i titoli trovati, niente altro.");
} catch (e) {
	console.log("prompt error:", e.message);
}
session.dispose();
console.log("eventi:", JSON.stringify(seen.slice(0, 20)));
console.log("tool chiamati:", JSON.stringify(calls));
console.log("risposta:", JSON.stringify(answer.trim().slice(0, 300)));
