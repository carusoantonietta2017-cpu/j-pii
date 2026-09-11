// j-pii v1 (T1): pi extension skeleton. Thin hook wiring over the pure
// mask/restore core; analyzer is fake here (T2 plugs in rizzo-pii),
// session mapping is a naive module map (T3 builds the real store).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { restore, restoreDeep, type Analyzer, type DoubtfulSpan } from "./mask.ts";
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
const forcedKeys = new Set<string>();
const clearedKeys = new Set<string>();

export const spanKey = (s: DoubtfulSpan): string => `${s.label} ${s.value}`;

export function partitionDecided(
	spans: DoubtfulSpan[],
	forced: Set<string>,
	cleared: Set<string>,
): { autoForce: DoubtfulSpan[]; autoClear: DoubtfulSpan[]; fresh: DoubtfulSpan[] } {
	const autoForce: DoubtfulSpan[] = [];
	const autoClear: DoubtfulSpan[] = [];
	const fresh: DoubtfulSpan[] = [];
	for (const span of spans) {
		const key = spanKey(span);
		if (forced.has(key)) autoForce.push(span);
		else if (cleared.has(key)) autoClear.push(span);
		else fresh.push(span);
	}
	return { autoForce, autoClear, fresh };
}

function resetSession() {
	store = createSessionStore();
	sessionMapping.clear();
	forcedKeys.clear();
	clearedKeys.clear();
}

export async function maskStrings<T>(value: T): Promise<{ result: T; doubtful: DoubtfulSpan[] }> {
	const doubtful: DoubtfulSpan[] = [];
	const maskText = async (t: string): Promise<string> => {
		const r = await store.mask(t, analyzer);
		for (const [ph, val] of r.mapping) sessionMapping.set(ph, val);
		for (const d of r.doubtful) {
			if (!doubtful.some((x) => x.value === d.value && x.label === d.label)) doubtful.push(d);
		}
		return r.masked;
	};
	const walkContent = async (c: unknown): Promise<unknown> => {
		if (typeof c === "string") return maskText(c);
		if (Array.isArray(c)) {
			return Promise.all(
				c.map(async (item) => {
					if (item && typeof item === "object" && typeof (item as { text?: unknown }).text === "string") {
						return { ...item, text: await maskText((item as { text: string }).text) };
					}
					return item;
				}),
			);
		}
		return c;
	};
	const walk = async (v: unknown): Promise<unknown> => {
		if (typeof v === "string") return maskText(v);
		if (Array.isArray(v)) return Promise.all(v.map(walk));
		if (v && typeof v === "object") {
			const rec = v as Record<string, unknown>;
			// Scope to conversation content (chat `messages` or Responses
			// API `input`): model ids, tool schemas and other infrastructure
			// strings must never reach the analyzer. Covers `content`,
			// `output` (function results) and bare text parts.
			if (Array.isArray(rec.messages) || Array.isArray(rec.input)) {
				const out: Record<string, unknown> = { ...rec };
				for (const key of ["messages", "input"] as const) {
					const list = rec[key];
					if (!Array.isArray(list)) continue;
					out[key] = await Promise.all(
						list.map(async (m) => {
							if (typeof m === "string") return maskText(m);
							if (m && typeof m === "object") {
								const mm = { ...(m as Record<string, unknown>) };
								for (const field of ["content", "output", "text"] as const) {
									const f = mm[field];
									if (typeof f === "string" || Array.isArray(f)) {
										mm[field] = await walkContent(f);
									}
								}
								return mm;
							}
							return m;
						}),
					);
				}
				return out;
			}
			const o: Record<string, unknown> = {};
			for (const [k, x] of Object.entries(rec)) o[k] = await walk(x);
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
			const { autoForce, autoClear, fresh } = partitionDecided(doubtful, forcedKeys, clearedKeys);
			const forced = new Map<string, string>();
			for (const span of autoForce) {
				const ph = store.forceMask(span.value, span.label);
				forced.set(ph, span.value);
				sessionMapping.set(ph, span.value);
			}
			for (const span of autoClear) {
				console.error(`[j-pii] send-in-clear (remembered choice): ${span.label} "${span.value}"`);
			}
			const { force, cleared } = await reviewDoubtful(fresh, async (span) => {
				const choice = await ctx.ui.select(
					`j-pii doubtful ${span.label}: "${span.value}" — mask it?`,
					["Mask it", "Send in clear"],
				);
				if (choice === undefined) throw new Error("j-pii review dismissed, failing closed");
				return choice === "Mask it" ? "mask" : "clear";
			});
			for (const span of force) {
				const ph = store.forceMask(span.value, span.label);
				forced.set(ph, span.value);
				sessionMapping.set(ph, span.value);
			}
			for (const span of force) forcedKeys.add(spanKey(span));
			for (const span of cleared) {
				clearedKeys.add(spanKey(span));
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

	pi.on("tool_call", (event) => {
		// Restore placeholders in args before execution (Q3 decision):
		// files on disk get real values, the LLM only ever saw placeholders.
		// Mutating event.input in place is the documented seam.
		const input = event.input as unknown;
		if (input && typeof input === "object") {
			for (const [k, v] of Object.entries(input)) {
				(input as Record<string, unknown>)[k] = restoreDeep(v, sessionMapping);
			}
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
