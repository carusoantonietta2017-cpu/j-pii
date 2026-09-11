// rizzo-pii bridge: adapts the local sidecar HTTP contract
// (POST /analyze → {mapping: {placeholder: value}, ...}) to the Analyzer
// seam. Same value reuses the same placeholder because mapping keys are
// unique per value; offsets are located in the source text.
import type { Analyzer, Detection } from "./mask.ts";

interface AnalyzeResponse {
	mapping?: Record<string, string>;
	anonymized_text?: string;
}

const PLACEHOLDER = /^\[([A-Z_]+)_\d+\]$/;

export function rizzoAnalyzer(baseUrl: string): Analyzer {
	return {
		analyze: async (text: string) => {
			const res = await fetch(`${baseUrl}/analyze`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ text, include_mapping: true }),
			});
			if (!res.ok) throw new Error(`rizzo-pii /analyze failed: HTTP ${res.status}`);
			const data = (await res.json()) as AnalyzeResponse;
			if (!data || typeof data.mapping !== "object" || data.mapping === null) {
				throw new Error("rizzo-pii contract broken: response has no mapping object");
			}
			const detections: Detection[] = [];
			for (const [ph, value] of Object.entries(data.mapping)) {
				const m = PLACEHOLDER.exec(ph);
				if (!m || typeof value !== "string" || value.length === 0) continue;
				let from = 0;
				for (;;) {
					const i = text.indexOf(value, from);
					if (i === -1) break;
					detections.push({ start: i, end: i + value.length, label: m[1] });
					from = i + value.length;
				}
			}
			return detections.sort((a, b) => a.start - b.start);
		},
	};
}
