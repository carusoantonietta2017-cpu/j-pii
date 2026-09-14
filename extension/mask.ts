// Pure mask/restore core (domain vocabulary: see /CONTEXT.md).
// No pi runtime, no model: the analyzer is injected (fake in tests,
// rizzo-pii bridge from T2).
export interface Detection {
	start: number;
	end: number;
	label: string;
	/** Checksum- or rule-verified. Undefined = unknown provenance, auto-masked. */
	validated?: boolean;
}

export interface Analyzer {
	analyze(text: string): Promise<Detection[]>;
}

export interface DoubtfulSpan {
	value: string;
	label: string;
}

export interface MaskPolicy {
	/** Labels that stay in clear text (per-project allowlist). */
	excludeLabels?: readonly string[];
	/** Detections shorter than this are dropped as noise. */
	minLength?: number;
	/** Hold unvalidated detections out for human review instead of masking. */
	reviewUnvalidated?: boolean;
}

const DEFAULT_POLICY: Required<MaskPolicy> = { excludeLabels: [], minLength: 2, reviewUnvalidated: true };

export function filterDetections(
	text: string,
	detections: Detection[],
	policy: MaskPolicy = {},
): Detection[] {
	const p = { ...DEFAULT_POLICY, ...policy };
	const excluded = new Set(p.excludeLabels);
	return detections.filter((d) => {
		if (excluded.has(d.label)) return false;
		if (text.slice(d.start, d.end).length < p.minLength) return false;
		return true;
	});
}

/** Values from the mapping still present in clear text. Empty = clean. */
export function assertNoLeak(masked: string, mapping: Map<string, string>): string[] {
	const leaked: string[] = [];
	for (const v of mapping.values()) {
		if (v.length > 0 && masked.includes(v) && !leaked.includes(v)) leaked.push(v);
	}
	return leaked;
}

export interface MaskResult {
	masked: string;
	mapping: Map<string, string>;
}

export function restore(text: string, mapping: Map<string, string>): string {
	let out = text;
	for (const [ph, value] of mapping) out = out.split(ph).join(value);
	return out;
}

/** Minimum value length for reverse-mapping (history replay guard, issue #52).
 *  Shorter values stay in clear in replayed history: blind replacement of
 *  e.g. "MI" would corrupt innocent substrings ("FAMIGLIA"). Residual risk
 *  on 1-3 char values (province abbreviations, ages, house numbers). */
export const REMASK_MIN_LENGTH = 4;

/** Reverse-restore: map known values back to their placeholders.
 *  The restore pass persists real values into stored assistant messages;
 *  before re-sending history, this puts back exactly what the model saw.
 *  Longest values first so overlapping spans ("Rossi Mario" vs "Mario")
 *  resolve to the widest placeholder. Unknown strings pass through. */
export function remask(text: string, mapping: Map<string, string>): string {
	const pairs = [...mapping].filter(([, v]) => v.length >= REMASK_MIN_LENGTH);
	pairs.sort((a, b) => b[1].length - a[1].length);
	let out = text;
	for (const [ph, value] of pairs) {
		if (out.includes(value)) out = out.split(value).join(ph);
	}
	return out;
}

/** remask() over nested structures (whole provider payload): strings are
 *  rebased, keys and non-strings pass through untouched. */
export function remaskDeep<T>(value: T, mapping: Map<string, string>): T {
	if (typeof value === "string") return remask(value, mapping) as T;
	if (Array.isArray(value)) return value.map((v) => remaskDeep(v, mapping)) as T;
	if (value && typeof value === "object") {
		const o: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) o[k] = remaskDeep(v, mapping);
		return o as T;
	}
	return value;
}

/** Restore placeholders in nested structures (tool args): strings are
restored, unknown placeholders and non-strings pass through untouched. */
export function restoreDeep<T>(value: T, mapping: Map<string, string>): T {
	if (typeof value === "string") return restore(value, mapping) as T;
	if (Array.isArray(value)) return value.map((v) => restoreDeep(v, mapping)) as T;
	if (value && typeof value === "object") {
		const o: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) o[k] = restoreDeep(v, mapping);
		return o as T;
	}
	return value;
}

export async function mask(
	text: string,
	analyzer: Analyzer,
	policy: MaskPolicy = {},
): Promise<MaskResult & { doubtful: DoubtfulSpan[] }> {
	const mapping = new Map<string, string>();
	const counters = new Map<string, number>();
	const seen = new Map<string, string>();
	const spans = filterDetections(
		text,
		[...(await analyzer.analyze(text))].sort((a, b) => a.start - b.start),
		policy,
	);
	let out = "";
	let pos = 0;
	const p = { ...DEFAULT_POLICY, ...policy };
	const doubtful: DoubtfulSpan[] = [];
	for (const s of spans) {
		const value = text.slice(s.start, s.end);
		if (p.reviewUnvalidated && s.validated === false) {
			doubtful.push({ value, label: s.label });
			out += text.slice(pos, s.end);
			pos = s.end;
			continue;
		}
		const key = `${s.label} ${value}`;
		let ph = seen.get(key);
		if (!ph) {
			const n = (counters.get(s.label) ?? 0) + 1;
			counters.set(s.label, n);
			ph = `[${s.label}_${n}]`;
			seen.set(key, ph);
			mapping.set(ph, value);
		}
		out += text.slice(pos, s.start) + ph;
		pos = s.end;
	}
	const masked = out + text.slice(pos);
	const leaked = assertNoLeak(masked, mapping);
	if (leaked.length > 0) {
		throw new Error(`j-pii leak detected, failing closed: masked output still contains ${leaked.length} value(s)`);
	}
	return { masked, mapping, doubtful };
}
