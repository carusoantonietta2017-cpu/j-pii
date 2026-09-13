// j-pii v1 (T1): pi extension skeleton. Thin hook wiring over the pure
// mask/restore core; analyzer is fake here (T2 plugs in rizzo-pii),
// session mapping is a naive module map (T3 builds the real store).
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { restore, restoreDeep, type Analyzer, type DoubtfulSpan } from "./mask.ts";
import { createSessionStore, type SessionStore } from "./store.ts";
import { reviewDoubtful, type ReviewDecision } from "./review.ts";
import { rizzoAnalyzer } from "./rizzo.ts";
import { resolveConfig } from "./config.ts";
import { ensureSidecar, type ManagedSidecar } from "./sidecar.ts";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

// Analyzer selection: the local rizzo-pii sidecar by default (lazy:
// spawned on first masked call, reused while healthy, stopped with the
// session); JPII_ANALYZER=fake selects the offline regex shapes.
// T1 fake: regex shapes where rizzo-pii detections flow in tests.
export const fakeAnalyzer: Analyzer = { analyze: async (text) => regexDetections(text) };

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "rizzo-pii", "src", "app");
let sidecar: ManagedSidecar | undefined;
let realAnalyzer: Analyzer | undefined;

async function getAnalyzer(cwd = "."): Promise<Analyzer> {
	const cfg = resolveConfig();
	if (cfg.analyzer === "fake") return fakeAnalyzer;
	if (!realAnalyzer) {
		// Relative interpreter paths resolve against the project dir:
		// the sidecar itself runs with cwd inside rizzo-pii.
		const python = isAbsolute(cfg.python) ? cfg.python : resolve(cwd, cfg.python);
		sidecar = await ensureSidecar({
			command: python,
			args: [join(APP_DIR, "app.py"), "--port", String(cfg.port)],
			cwd: APP_DIR,
			env: cfg.modelDir ? { PII_MODEL_DIR: cfg.modelDir } : {},
			healthUrl: `${cfg.sidecarUrl}/health`,
		});
		realAnalyzer = rizzoAnalyzer(cfg.sidecarUrl);
	}
	return realAnalyzer;
}

// Session-scoped mapping (T3): canonical store plus the cumulative
// placeholder→value map used for restore. Both reset on session
// boundaries; nothing is persisted.
let store: SessionStore = createSessionStore();
const sessionMapping = new Map<string, string>();
const forcedKeys = new Set<string>();
const clearedKeys = new Set<string>();

export const spanKey = (s: DoubtfulSpan): string => `${s.label} ${s.value}`;

/** Mask per l'hook ocr-pi: maschera + forza i doubtful (fail-safe, niente leak).
 *  Usa lo stesso store/mapping di sessione: il restore in message_end vale anche qui. */
export async function maskTextForOcr(
	text: string,
	cwd = ".",
): Promise<{ text: string; doubtfulForced: number }> {
	const { result, doubtful } = await maskStrings(text, cwd);
	let out = result as unknown as string;
	for (const d of doubtful) {
		const ph = store.forceMask(d.value, d.label);
		sessionMapping.set(ph, d.value);
		out = out.split(d.value).join(ph);
	}
	return { text: out, doubtfulForced: doubtful.length };
}

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

async function resetSession() {
	store = createSessionStore();
	sessionMapping.clear();
	forcedKeys.clear();
	clearedKeys.clear();
	if (sidecar) {
		await sidecar.stop();
		sidecar = undefined;
		realAnalyzer = undefined;
	}
}

export async function maskStrings<T>(value: T, cwd = "."): Promise<{ result: T; doubtful: DoubtfulSpan[] }> {
	const doubtful: DoubtfulSpan[] = [];
	const maskText = async (t: string): Promise<string> => {
		const analyzer = await getAnalyzer(cwd);
		const { excludeLabels } = resolveConfig();
		const r = await store.mask(t, analyzer, { excludeLabels });
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
								const mm = m as Record<string, unknown>;
								// PII enters through the user and tool outputs only.
								// System/developer prompts, tool schemas and the
								// assistant history are trusted and skipped.
								const role = mm.role;
								const kind = mm.type;
								const untrusted =
									role === "user" ||
									role === "tool" ||
									role === "toolResult" ||
									role === "toolresult" ||
									role === "custom" ||
									(typeof kind === "string" && kind.includes("output"));
								if (!untrusted) return m;
								const out: Record<string, unknown> = { ...mm };
								for (const field of ["content", "output", "text"] as const) {
									const f = mm[field];
									if (typeof f === "string" || Array.isArray(f)) {
										out[field] = await walkContent(f);
									}
								}
							return out;
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

/** Fresh-doubtful resolution shared by the interactive hook and headless callers.
 *  autoMask=true force-masks every fresh span (fail-safe: the dock has no TUI
 *  to answer the review prompt, so asking would always fail closed). Only
 *  labels and counts reach the log here, never values. */
export async function resolveFreshDoubtful(
	fresh: DoubtfulSpan[],
	opts: { autoMask: boolean; decide: (span: DoubtfulSpan) => Promise<ReviewDecision> },
): Promise<{ force: DoubtfulSpan[]; cleared: DoubtfulSpan[]; autoMasked: boolean }> {
	if (opts.autoMask && fresh.length > 0) {
		const byLabel = new Map<string, number>();
		for (const span of fresh) byLabel.set(span.label, (byLabel.get(span.label) ?? 0) + 1);
		const summary = [...byLabel].map(([k, n]) => `${k} x${n}`).join(", ");
		console.error(`[j-pii] doubtful auto-masked: ${fresh.length} span(s) (${summary})`);
		return { force: [...fresh], cleared: [], autoMasked: true };
	}
	const { force, cleared } = await reviewDoubtful(fresh, opts.decide);
	return { force, cleared, autoMasked: false };
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", () => {
		void resetSession();
	});

	pi.on("session_shutdown", () => {
		void resetSession();
	});

	pi.on("before_provider_request", async (event, ctx) => {
		try {
			const { result, doubtful } = await maskStrings(JSON.parse(JSON.stringify(event.payload)), ctx.cwd);
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
			const { autoMaskDoubtful } = resolveConfig();
			const { force, cleared } = await resolveFreshDoubtful(fresh, {
				autoMask: autoMaskDoubtful,
				decide: async (span) => {
					const choice = await ctx.ui.select(
						`j-pii doubtful ${span.label}: "${span.value}" — mask it?`,
						["Mask it", "Send in clear"],
					);
					if (choice === undefined) {
							throw new Error(
								"j-pii review dismissed, failing closed on: " +
									fresh.map((x) => `${x.label} "${x.value}"`).join(", "),
							);
						}
					return choice === "Mask it" ? "mask" : "clear";
				},
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
		const msg = err instanceof Error ? err.message : String(err);
			console.error(`[j-pii] blocked a request: ${msg}`);
			ctx.ui.notify(`j-pii blocked a request: ${msg}`, "error");
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
