// rizzo-pii bridge: adapts the local sidecar HTTP contract
// (POST /analyze → segments with {label, ph, src, validated, t})
// to the Analyzer seam. Entity segments arrive in document order, so a
// cursor locates each original value exactly once — repeats resolve in
// order and validated flags ride along for the review policy.
import type { Analyzer, Detection } from "./mask.ts";

interface EntitySegment {
	label?: string;
	ph?: string;
	validated?: boolean;
	t?: string;
}

interface AnalyzeResponse {
	mapping?: Record<string, string>;
	segments?: EntitySegment[];
}

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
			if (!Array.isArray(data.segments)) {
				throw new Error("rizzo-pii contract broken: response has no segments array");
			}
			const detections: Detection[] = [];
			let cursor = 0;
			for (const seg of data.segments) {
				if (typeof seg.label !== "string" || typeof seg.t !== "string" || seg.t.length === 0) continue;
				const i = text.indexOf(seg.t, cursor);
				if (i === -1) continue;
				detections.push({ start: i, end: i + seg.t.length, label: seg.label, validated: seg.validated });
				cursor = i + seg.t.length;
			}
			return detections;
		},
	};
}
