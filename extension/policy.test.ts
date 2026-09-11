// Seam under test: policy layer in the mask path (T4).
// minLength drops detection noise, excludeLabels is the per-project
// allowlist, assertNoLeak fails closed on recall failures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mask, assertNoLeak, type Analyzer } from "./mask.ts";
import { createSessionStore } from "./store.ts";

const CF = "RSSMRA80A01H501U";
const MAIL = "mario.rossi@example.it";

function fakeFor(hits: Array<{ value: string; label: string; max?: number }>): Analyzer {
	return {
		analyze: async (text: string) => {
			const out: Array<{ start: number; end: number; label: string }> = [];
			for (const { value, label, max = Infinity } of hits) {
				let from = 0;
				let n = 0;
				for (;;) {
					const i = text.indexOf(value, from);
					if (i === -1 || n >= max) break;
					out.push({ start: i, end: i + value.length, label });
					from = i + value.length;
					n++;
				}
			}
			return out.sort((a, b) => a.start - b.start);
		},
	};
}

test("minLength drops single-char detection noise (spike: classe 3)", async () => {
	const fake = fakeFor([
		{ value: "3", label: "CATASTO" },
		{ value: CF, label: "CF" },
	]);
	const { masked, mapping } = await mask(`classe 3, cf ${CF}`, fake, { minLength: 2 });
	assert.equal(masked, `classe 3, cf [CF_1]`);
	assert.equal(mapping.size, 1);
});

test("excludeLabels leaves allowlisted categories in clear", async () => {
	const fake = fakeFor([
		{ value: MAIL, label: "EMAIL" },
		{ value: CF, label: "CF" },
	]);
	const { masked } = await mask(`${MAIL} ${CF}`, fake, { excludeLabels: ["EMAIL"] });
	assert.equal(masked, `${MAIL} [CF_1]`);
});

test("assertNoLeak reports mapped values left in clear text", () => {
	assert.deepEqual(assertNoLeak("a [CF_1] b", new Map([["[CF_1]", CF]])), []);
	assert.deepEqual(assertNoLeak(`a ${CF} b`, new Map([["[CF_1]", CF]])), [CF]);
});

test("mask fails closed when the analyzer misses a repeat (recall failure)", async () => {
	const partial = fakeFor([{ value: CF, label: "CF", max: 1 }]);
	await assert.rejects(() => mask(`${CF} ${CF}`, partial), /leak/i);
});

test("store applies the same policy", async () => {
	const store = createSessionStore();
	const fake = fakeFor([
		{ value: "3", label: "CATASTO" },
		{ value: CF, label: "CF" },
	]);
	const { masked } = await store.mask(`n 3 cf ${CF}`, fake, { minLength: 2 });
	assert.equal(masked, "n 3 cf [CF_1]");
});
