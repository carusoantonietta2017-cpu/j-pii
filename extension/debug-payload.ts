// DEBUG ONLY — never ship enabled. Dumps a compact view of every
// LLM-bound message to /tmp/jpii-payload.log so you can verify with your
// own eyes that only placeholders travel. Usage:
// pi -e ./extension/j-pii.ts -e ./extension/debug-payload.ts
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LOG = "/tmp/jpii-payload.log";

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((b) => {
				if (typeof b === "string") return b;
				if (b && typeof b === "object") {
					const o = b as Record<string, unknown>;
					if (typeof o.text === "string") return o.text;
					if (typeof o.output === "string") return o.output;
					if (o.type === "function_call") return `[tool:${String((o as { name?: unknown }).name)}]`;
				}
				return "";
			})
			.join("");
	}
	return "";
}

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", (event) => {
		const p = event.payload as { messages?: unknown[]; input?: unknown[] };
		const items = Array.isArray(p.messages) ? p.messages : Array.isArray(p.input) ? p.input : [];
		const lines = [`\n===== ${new Date().toISOString()} OUTBOUND (${items.length} items) =====`];
		for (const m of items) {
			if (typeof m === "string") {
				lines.push(`[string] ${m.slice(0, 300)}`);
				continue;
			}
			if (m && typeof m === "object") {
				const o = m as Record<string, unknown>;
				const who = String(o.role ?? o.type ?? "?");
				const text = textOf(o.content ?? o.output ?? o.text ?? "");
				lines.push(`[${who}] ${String(text).slice(0, 300)}`);
			}
		}
		appendFileSync(LOG, lines.join("\n") + "\n", "utf8");
	});
}
