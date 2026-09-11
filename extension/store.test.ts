// Seam under test: session mapping store (T3). Canonicalizes server
// per-call numbering: same (label, value) always yields the same session
// placeholder; clear() wipes everything (session isolation).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionStore } from "./store.ts";
import type { Analyzer } from "./mask.ts";

const CF = "RSSMRA80A01H501U";
const CF2 = "VRDLRA75P57L219Q";

const fake: Analyzer = {
	analyze: async (text: string) => {
		const out: Array<{ start: number; end: number; label: string }> = [];
		for (const [v, label] of [
			[CF, "CF"],
			[CF2, "CF"],
		] as const) {
			let from = 0;
			for (;;) {
				const i = text.indexOf(v, from);
				if (i === -1) break;
				out.push({ start: i, end: i + v.length, label });
				from = i + v.length;
			}
		}
		return out.sort((a, b) => a.start - b.start);
	},
};

test("same value across calls reuses the session placeholder", async () => {
	const store = createSessionStore();
	const first = await store.mask(`a ${CF} b`, fake);
	const second = await store.mask(`c ${CF} d`, fake);
	assert.equal(first.masked, "a [CF_1] b");
	assert.equal(second.masked, "c [CF_1] d");
	assert.equal(second.mapping.get("[CF_1]"), CF);
	assert.equal(store.size, 1);
});

test("new values take the next session number", async () => {
	const store = createSessionStore();
	await store.mask(CF, fake);
	const second = await store.mask(CF2, fake);
	assert.equal(second.masked, "[CF_2]");
	assert.equal(store.size, 2);
});

test("a fresh store starts empty (no cross-session leakage)", async () => {
	const a = createSessionStore();
	await a.mask(CF, fake);
	const b = createSessionStore();
	assert.equal(b.size, 0);
	const { masked } = await b.mask(CF, fake);
	assert.equal(masked, "[CF_1]");
});

test("clear wipes the store", async () => {
	const store = createSessionStore();
	await store.mask(CF, fake);
	store.clear();
	assert.equal(store.size, 0);
	const { masked } = await store.mask(CF, fake);
	assert.equal(masked, "[CF_1]");
});
