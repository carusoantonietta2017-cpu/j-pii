// Seam under test: mask()/restore() pure core (spec #6, T1).
// Vocabulary from CONTEXT.md: placeholder, mapping, mask, restore.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mask, restore, restoreDeep, remask, remaskDeep, type Analyzer } from "./mask.ts";

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

test("remask maps known values back, longest first", () => {
	const mapping = new Map([
		["[FULLNAME_1]", "Rossi Mario"],
		["[CF_1]", CF],
	]);
	assert.equal(
		remask(`sig. Rossi Mario ${CF} fine`, mapping),
		"sig. [FULLNAME_1] [CF_1] fine",
	);
	// overlapping spans resolve to the widest placeholder
	const overlap = new Map([
		["[FULLNAME_1]", "Rossi Mario"],
		["[FULLNAME_2]", "Mario"],
	]);
	assert.equal(remask("Rossi Mario", overlap), "[FULLNAME_1]");
	assert.equal(remask("niente da nascondere", mapping), "niente da nascondere");
});

test("remask skips 1-3 char values (no substring corruption)", () => {
	const mapping = new Map([["[PROVINCE_1]", "MI"]]);
	assert.equal(remask("FAMIGLIA MI", mapping), "FAMIGLIA MI");
});

test("remaskDeep rebases nested payloads, keys and non-strings untouched", () => {
	const mapping = new Map([["[CF_1]", CF]]);
	const payload = {
		[CF]: "key stays",
		messages: [
			{ role: "assistant", content: [{ type: "text", text: `ripeti ${CF}` }] },
			{ role: "user", content: `dato ${CF} fine` },
		],
		n: 3,
	};
	const out = remaskDeep(payload, mapping);
	assert.equal(out[CF], "key stays");
	assert.equal(
		(out.messages[0].content as Array<{ text: string }>)[0].text,
		"ripeti [CF_1]",
	);
	assert.equal(out.messages[1].content, "dato [CF_1] fine");
	assert.equal(out.n, 3);
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
