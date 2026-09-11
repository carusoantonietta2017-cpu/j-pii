// j-pii v1 (T1): pi extension skeleton. Thin hook wiring over the pure
// mask/restore core; analyzer is fake here (T2 plugs in rizzo-pii),
// session mapping is a naive module map (T3 builds the real store).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { restore, type Analyzer, type DoubtfulSpan } from "./mask.ts";
import { createSessionStore, type SessionStore } from "./store.ts";
import { reviewDoubtful } from "./review.ts";
import { rizzoAnalyzer } from "./rizzo.ts";

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

// Analyzer selection: fake regex shapes by default (no model needed);
// JPII_ANALYZER=real talks to the local rizzo-pii sidecar, whose
// validated flags drive the doubtful-span review.
// T1 fake: regex shapes where rizzo-pii detections flow in tests.
export const fakeAnalyzer: Analyzer = { analyze: async (text) => regexDetections(text) };

const analyzer: Analyzer =
	process.env.JPII_ANALYZER === "real"
		? rizzoAnalyzer(process.env.JPII_SIDECAR_URL ?? "http://127.0.0.1:5005")
		: fakeAnalyzer;

// Session-scoped mapping (T3): canonical store plus the cumulative
// placeholder→value map used for restore. Both reset on session
// boundaries; nothing is persisted.
let store: SessionStore = createSessionStore();
const sessionMapping = new Map<string, string>();

function resetSession() {
	store = createSessionStore();
	sessionMapping.clear();
}

export async function maskStrings<T>(value: T): Promise<{ result: T; doubtful: DoubtfulSpan[] }> {
	const doubtful: DoubtfulSpan[] = [];
	const walk = async (v: unknown): Promise<unknown> => {
		if (typeof v === "string") {
			const r = await store.mask(v, analyzer);
			for (const [ph, val] of r.mapping) sessionMapping.set(ph, val);
			for (const d of r.doubtful) {
				if (!doubtful.some((x) => x.value === d.value && x.label === d.label)) doubtful.push(d);
			}
			return r.masked;
		}
		if (Array.isArray(v)) return Promise.all(v.map(walk));
		if (v && typeof v === "object") {
			const o: Record<string, unknown> = {};
			for (const [k, x] of Object.entries(v)) o[k] = await walk(x);
			return o;
		}
		return v;
	};
	return { result: (await walk(value)) as T, doubtful };
}

function applyForced(value: unknown, forced: Map<string, string>): unknown {
	if (typeof value === "string") {
		let out = value;
		for (const [ph, val] of forced) out = out.split(val).join(ph);
		return out;
	}
	if (Array.isArray(value)) return value.map((v) => applyForced(v, forced));
	if (value && typeof value === "object") {
		const o: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) o[k] = applyForced(v, forced);
		return o;
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

	pi.on("before_provider_request", async (event, ctx) => {
		try {
			const { result, doubtful } = await maskStrings(JSON.parse(JSON.stringify(event.payload)));
			if (doubtful.length === 0) return result;
			const { force, cleared } = await reviewDoubtful(doubtful, async (span) => {
				const choice = await ctx.ui.select(
					`j-pii doubtful ${span.label}: "${span.value}" — mask it?`,
					["Mask it", "Send in clear"],
				);
				if (choice === undefined) throw new Error("j-pii review dismissed, failing closed");
				return choice === "Mask it" ? "mask" : "clear";
			});
			const forced = new Map<string, string>();
			for (const span of force) {
				const ph = store.forceMask(span.value, span.label);
				forced.set(ph, span.value);
				sessionMapping.set(ph, span.value);
			}
			for (const span of cleared) {
				console.error(`[j-pii] explicit send-in-clear: ${span.label} "${span.value}"`);
			}
			if (cleared.length > 0) {
				ctx.ui.notify(`j-pii: ${cleared.length} doubtful span(s) sent in clear by your choice`, "warning");
			}
				return applyForced(result, forced);
		} catch (err) {
		// Fail closed: never let the original (unmasked) payload through.
		// An empty object makes the provider reject the request outright.
		ctx.ui.notify(`j-pii blocked a request: ${err instanceof Error ? err.message : String(err)}`, "error");
			return {};
		}
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
