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

test("walk scopes to message content, infrastructure strings untouched", async () => {
	const payload = {
		model: "muse-spark-1.3-contributor-free",
		messages: [
			{ role: "user", content: `dato ${CF} fine` },
			{ role: "assistant", content: [{ type: "text", text: `ripeti ${CF}` }] },
		],
	};
	const out = await maskStrings(payload);
	assert.equal(out.result.model, "muse-spark-1.3-contributor-free");
	assert.equal(out.result.messages[0].content, "dato [CF_1] fine");
	const blocks = out.result.messages[1].content;
	assert.ok(Array.isArray(blocks));
	assert.equal((blocks[0] as { text: string }).text, "ripeti [CF_1]");
});

test("walk scopes Responses-API input, masking content and outputs only", async () => {
	const payload = {
		model: "muse-spark-1.3-contributor-free",
		tools: [{ name: "bash", description: "run a command" }],
		input: [
			{ role: "user", content: `dato ${CF} fine` },
			{ type: "function_call_output", call_id: "abc123", output: `letto ${CF}` },
		],
	};
	const out = await maskStrings(payload);
	assert.equal(out.result.model, "muse-spark-1.3-contributor-free");
	assert.deepEqual(out.result.tools, [{ name: "bash", description: "run a command" }]);
	assert.equal((out.result.input[0] as { content: string }).content, "dato [CF_1] fine");
	assert.equal((out.result.input[1] as { output: string }).output, "letto [CF_1]");
});
