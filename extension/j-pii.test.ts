// Regression: the deep payload walk must fully resolve (no nested
// Promises) with an async analyzer, and must leave non-PII strings
// such as model ids untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskStrings } from "./j-pii.ts";

const CF = "RSSMRA80A01H501U";

test("deep walk resolves everything and preserves structure", async () => {
	const payload = {
		model: "muse-spark-1.3-contributor-free",
		messages: [{ role: "user", content: `dato ${CF} fine` }],
		count: 3,
		flag: true,
		nothing: null,
	};
	const out = await maskStrings(payload);
	assert.equal(out.result.model, "muse-spark-1.3-contributor-free");
	assert.equal(out.result.messages[0].content, "dato [CF_1] fine");
	assert.equal(out.result.count, 3);
	assert.equal(out.result.flag, true);
	assert.equal(out.result.nothing, null);
	assert.equal(JSON.stringify(out.result).includes("RSSMRA"), false);
	assert.deepEqual(out.doubtful, []);
});
