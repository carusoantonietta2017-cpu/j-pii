// Session mapping store (domain vocabulary: see /CONTEXT.md).
// Canonicalizes analyzer numbering across calls: the same (label, value)
// always yields the same session placeholder. In-memory only; clear()
// wipes everything (session isolation — nothing is persisted).
import type { Analyzer } from "./mask.ts";
import { assertNoLeak, filterDetections, type MaskPolicy } from "./mask.ts";

export interface SessionStore {
	mask(text: string, analyzer: Analyzer, policy?: MaskPolicy): Promise<{ masked: string; mapping: Map<string, string> }>;
	clear(): void;
	readonly size: number;
}

export function createSessionStore(): SessionStore {
	const canonical = new Map<string, string>();
	const values = new Map<string, string>();
	const counters = new Map<string, number>();

	return {
		async mask(text: string, analyzer: Analyzer, policy: MaskPolicy = {}) {
			const mapping = new Map<string, string>();
			const spans = filterDetections(
				text,
			[...(await analyzer.analyze(text))].sort((a, b) => a.start - b.start),
				policy,
			);
			let out = "";
			let pos = 0;
			for (const s of spans) {
				const value = text.slice(s.start, s.end);
				const key = `${s.label} ${value}`;
				let ph = canonical.get(key);
				if (!ph) {
					const n = (counters.get(s.label) ?? 0) + 1;
					counters.set(s.label, n);
					ph = `[${s.label}_${n}]`;
					canonical.set(key, ph);
					values.set(ph, value);
				}
				mapping.set(ph, value);
				out += text.slice(pos, s.start) + ph;
				pos = s.end;
			}
			const masked = out + text.slice(pos);
			const leaked = assertNoLeak(masked, mapping);
			if (leaked.length > 0) {
				throw new Error(`j-pii leak detected, failing closed: masked output still contains ${leaked.length} value(s)`);
			}
			return { masked, mapping };
		},
		clear() {
			canonical.clear();
			values.clear();
			counters.clear();
		},
		get size() {
			return canonical.size;
		},
	};
}
