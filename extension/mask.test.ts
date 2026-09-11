// Seam under test: mask()/restore() pure core (spec #6, T1).
// Vocabulary from CONTEXT.md: placeholder, mapping, mask, restore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mask, restore, restoreDeep, type Analyzer } from "./mask.ts";

const CF = "RSSMRA80A01H501U";

const fakeAnalyzer: Analyzer = {
	analyze: async (text: string) => {
		const i = text.indexOf(CF);
		return i === -1 ? [] : [{ start: i, end: i + CF.length, label: "CF" }];
	},
};

test("mask replaces a detected span with its placeholder", async () => {
	const { masked, mapping } = await mask(`codice ${CF} fine`, fakeAnalyzer);
	assert.equal(masked, "codice [CF_1] fine");
	assert.equal(mapping.get("[CF_1]"), CF);
});

test("mask reuses the placeholder for a repeated value", async () => {
	const repeating: Analyzer = {
		analyze: async (text: string) => {
			const out = [];
			let from = 0;
			for (;;) {
				const i = text.indexOf(CF, from);
				if (i === -1) break;
				out.push({ start: i, end: i + CF.length, label: "CF" });
				from = i + CF.length;
			}
			return out;
		},
	};
	const { masked, mapping } = await mask(`${CF} e ${CF}`, repeating);
	assert.equal(masked, "[CF_1] e [CF_1]");
	assert.equal(mapping.size, 1);
});

test("restore swaps placeholders back, leaving unknown ones untouched", () => {
	const mapping = new Map([
		["[CF_1]", CF],
		["[EMAIL_1]", "mario.rossi@example.it"],
	]);
	assert.equal(
		restore("codice [CF_1], mail [EMAIL_1], ignoto [CF_9]", mapping),
		`codice ${CF}, mail mario.rossi@example.it, ignoto [CF_9]`,
	);
});

test("restoreDeep swaps placeholders in nested tool args", () => {
	const mapping = new Map([["[CF_1]", CF]]);
	const args = {
		path: "/tmp/x.txt",
		content: `cf [CF_1] ok [CF_9]`,
		edits: [{ old: "a [CF_1] b" }],
		n: 3,
		ok: true,
		nil: null,
	};
	assert.deepEqual(restoreDeep(args, mapping), {
		path: "/tmp/x.txt",
		content: `cf ${CF} ok [CF_9]`,
		edits: [{ old: `a ${CF} b` }],
		n: 3,
		ok: true,
		nil: null,
	});
});
