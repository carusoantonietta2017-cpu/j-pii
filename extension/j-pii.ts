// j-pii v1 (T1): pi extension skeleton. Thin hook wiring over the pure
// mask/restore core; analyzer is fake here (T2 plugs in rizzo-pii),
// session mapping is a naive module map (T3 builds the real store).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { restore, type Analyzer } from "./mask.ts";
import { createSessionStore, type SessionStore } from "./store.ts";

const CF_RE = /[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]/;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function regexDetections(text: string) {
	const out: Array<{ start: number; end: number; label: string }> = [];
	for (const [re, label] of [
		[CF_RE, "CF"],
		[EMAIL_RE, "EMAIL"],
	] as const) {
		const g = new RegExp(re.source, "g");
		let m: RegExpExecArray | null;
		while ((m = g.exec(text)) !== null) {
			out.push({ start: m.index, end: m.index + m[0].length, label });
		}
	}
	return out;
}

// T1 fake: regex shapes where rizzo-pii detections will flow from T2.
export const fakeAnalyzer: Analyzer = { analyze: async (text) => regexDetections(text) };

// Session-scoped mapping (T3): canonical store plus the cumulative
// placeholder→value map used for restore. Both reset on session
// boundaries; nothing is persisted.
let store: SessionStore = createSessionStore();
const sessionMapping = new Map<string, string>();

function resetSession() {
	store = createSessionStore();
	sessionMapping.clear();
}

export async function maskStrings<T>(value: T): Promise<T> {
	if (typeof value === "string") {
		const { masked, mapping } = await store.mask(value, fakeAnalyzer);
		for (const [ph, v] of mapping) sessionMapping.set(ph, v);
		return masked as T;
	}
	if (Array.isArray(value)) return (await Promise.all(value.map(maskStrings))) as T;
	if (value && typeof value === "object") {
		const o: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) o[k] = await maskStrings(v);
		return o as T;
	}
	return value;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", () => {
		resetSession();
	});

	pi.on("session_shutdown", () => {
		resetSession();
	});

	pi.on("before_provider_request", (event) => {
		return maskStrings(JSON.parse(JSON.stringify(event.payload)));
	});

	pi.on("message_end", (event) => {
		const m = event.message;
		if (m.role !== "assistant") return undefined;
		let changed = false;
		const content = m.content.map((block) => {
			if (block.type !== "text") return block;
			const restored = restore(block.text, sessionMapping);
			if (restored === block.text) return block;
			changed = true;
			return { ...block, text: restored };
		});
		if (!changed) return undefined;
		return { message: { ...m, content } };
	});
}
