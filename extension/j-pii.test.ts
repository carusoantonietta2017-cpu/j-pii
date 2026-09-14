// Regression: the deep payload walk must fully resolve (no nested
// Promises) with an async analyzer, and must leave non-PII strings
// such as model ids untouched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskStrings, rebaseHistory, resolveFreshDoubtful } from "./j-pii.ts";

process.env.JPII_ANALYZER = "fake";

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

test("resolveFreshDoubtful auto-mask forces without prompting", async () => {
	let calls = 0;
	const fresh = [
		{ value: "Rossi", label: "FULLNAME" },
		{ value: "+39 333 1234567", label: "TELEPHONENUM" },
	];
	const out = await resolveFreshDoubtful(fresh, {
		autoMask: true,
		decide: async () => {
			calls++;
			return "mask";
		},
	});
	assert.deepEqual(out.force, fresh);
	assert.deepEqual(out.cleared, []);
	assert.equal(out.autoMasked, true);
	assert.equal(calls, 0);
});

test("resolveFreshDoubtful interactive delegates to the human", async () => {
	const fresh = [{ value: "Rossi", label: "FULLNAME" }];
	const out = await resolveFreshDoubtful(fresh, { autoMask: false, decide: async () => "clear" });
	assert.deepEqual(out.force, []);
	assert.deepEqual(out.cleared, fresh);
	assert.equal(out.autoMasked, false);
});

test("resolveFreshDoubtful auto-mask with nothing fresh never prompts", async () => {
	let calls = 0;
	const out = await resolveFreshDoubtful([], {
		autoMask: true,
		decide: async () => {
			calls++;
			return "mask";
		},
	});
	assert.deepEqual(out.force, []);
	assert.deepEqual(out.cleared, []);
	assert.equal(out.autoMasked, false);
	assert.equal(calls, 0);
});

test("walk scopes to message content, infrastructure strings untouched", async () => {
	const payload = {
		model: "muse-spark-1.3-contributor-free",
		messages: [
			{ role: "system", content: `sistema ${CF} ignorato` },
			{ role: "user", content: `dato ${CF} fine` },
			{ role: "assistant", content: [{ type: "text", text: `ripeti ${CF}` }] },
		],
	};
	const out = await maskStrings(payload);
	assert.equal(out.result.model, "muse-spark-1.3-contributor-free");
	assert.equal(out.result.messages[0].content, `sistema ${CF} ignorato`);
	assert.equal(out.result.messages[1].content, "dato [CF_1] fine");
	const blocks = out.result.messages[2].content;
	assert.ok(Array.isArray(blocks));
	assert.equal((blocks[0] as { text: string }).text, `ripeti ${CF}`);
});

// Regression (issue #52): restored assistant history must not replay real
// values outbound. After a user turn populates the session mapping, history
// carrying the restored value rebases to the same placeholder.
test("rebaseHistory puts restored assistant values back to placeholders", async () => {
	const EMAIL = "mario.rossi@example.it";
	await maskStrings({ messages: [{ role: "user", content: `scrivi a ${EMAIL} grazie` }] });
	const replay = {
		messages: [
			{ role: "user", content: "scrivi a [EMAIL_1] grazie" },
			{
				role: "assistant",
				content: [{ type: "text", text: `Ho scritto a ${EMAIL}, fatto` }],
			},
		],
	};
	const out = rebaseHistory(replay);
	assert.equal(JSON.stringify(out).includes(EMAIL), false);
	const blocks = out.messages[1].content as Array<{ text: string }>;
	assert.match(blocks[0].text, /Ho scritto a \[EMAIL_\d+\], fatto/);
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
