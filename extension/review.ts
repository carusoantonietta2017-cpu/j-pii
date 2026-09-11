// Doubtful-span review (domain vocabulary: see /CONTEXT.md).
// Pure decision routing: the hook supplies the human via ctx.ui,
// tests supply a fake decide function.
import type { DoubtfulSpan } from "./mask.ts";

export type { DoubtfulSpan };

export type ReviewDecision = "mask" | "clear";

export async function reviewDoubtful(
	spans: DoubtfulSpan[],
	decide: (span: DoubtfulSpan) => Promise<ReviewDecision>,
): Promise<{ force: DoubtfulSpan[]; cleared: DoubtfulSpan[] }> {
	const force: DoubtfulSpan[] = [];
	const cleared: DoubtfulSpan[] = [];
	for (const span of spans) {
		if ((await decide(span)) === "mask") force.push(span);
		else cleared.push(span);
	}
	return { force, cleared };
}
