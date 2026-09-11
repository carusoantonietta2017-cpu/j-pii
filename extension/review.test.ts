// Seam under test: doubtful-span review (T5). Unvalidated detections
// are held out as doubtful instead of masked; the human decides per
// span (force-mask or explicit send-in-clear).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionStore } from "./store.ts";
import { reviewDoubtful, type DoubtfulSpan } from "./review.ts";
import { partitionDecided } from "./j-pii.ts";
import type { Analyzer } from "./mask.ts";

const CF = "RSSMRA80A01H501U";
const NAME = "Mario Rossi";

const fake: Analyzer = {
	analyze: async (text: string) => {
		const out: Array<{ start: number; end: number; label: string; validated?: boolean }> = [];
		const at = (v: string, label: string, validated?: boolean) => {
			const i = text.indexOf(v);
			if (i !== -1) out.push({ start: i, end: i + v.length, label, validated });
		};
		at(CF, "CF", true);
		at(NAME, "FULLNAME", false);
		return out.sort((a, b) => a.start - b.start);
	},
};

test("unvalidated detections come back as doubtful, validated get masked", async () => {
	const store = createSessionStore();
	const { masked, mapping, doubtful } = await store.mask(`${NAME} ${CF}`, fake);
	assert.equal(masked, `${NAME} [CF_1]`);
	assert.equal(mapping.size, 1);
	assert.deepEqual(doubtful, [{ value: NAME, label: "FULLNAME" }]);
});

test("reviewUnvalidated:false masks everything (escape hatch)", async () => {
	const store = createSessionStore();
	const { masked, doubtful } = await store.mask(`${NAME} ${CF}`, fake, { reviewUnvalidated: false });
	assert.equal(masked, "[FULLNAME_1] [CF_1]");
	assert.deepEqual(doubtful, []);
});

test("forceMask assigns canonically and reuses", async () => {
	const store = createSessionStore();
	const ph1 = store.forceMask(NAME, "FULLNAME");
	const ph2 = store.forceMask(NAME, "FULLNAME");
	const ph3 = store.forceMask(CF, "CF");
	assert.equal(ph1, ph2);
	assert.equal(ph1, "[FULLNAME_1]");
	assert.equal(ph3, "[CF_1]");
});

test("reviewDoubtful routes spans by human decision", async () => {
	const spans: DoubtfulSpan[] = [{ value: NAME, label: "FULLNAME" }];
	const masked = await reviewDoubtful(spans, async () => "mask");
	assert.deepEqual(masked, { force: spans, cleared: [] });
	const cleared = await reviewDoubtful(spans, async () => "clear");
	assert.deepEqual(cleared, { force: [], cleared: spans });
});

test("partitionDecided remembers past choices", () => {
	const a = { value: "x", label: "L" };
	const b = { value: "y", label: "L" };
	const c = { value: "z", label: "L" };
	const forced = new Set(["L x"]);
	const cleared = new Set(["L y"]);
	assert.deepEqual(partitionDecided([a, b, c], forced, cleared), {
		autoForce: [a],
		autoClear: [b],
		fresh: [c],
	});
});
