// Seam under test: rizzo-pii bridge adapts the HTTP contract to Analyzer.
// Vocabulary from CONTEXT.md: placeholder, mapping, mask.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { rizzoAnalyzer } from "./rizzo.ts";

const CF = "RSSMRA80A01H501U";
const TEXT = `Mario Rossi, codice fiscale ${CF}`;

const CANNED = {
	mapping: { "[CF_1]": CF, "[FULLNAME_1]": "Mario Rossi" },
	anonymized_text: "[FULLNAME_1], codice fiscale [CF_1]",
	segments: [
		{ label: "FULLNAME", ph: "[FULLNAME_1]", src: "modello", validated: false, t: "Mario Rossi" },
		{ t: ", codice fiscale " },
		{ label: "CF", ph: "[CF_1]", src: "regex", validated: true, t: CF },
	],
};

function cannedServer(body: unknown): Promise<{ server: Server; url: string }> {
	return new Promise((resolve) => {
		const server = createServer((req, res) => {
			let raw = "";
			req.on("data", (c) => (raw += c));
			req.on("end", () => {
				const seen = JSON.parse(raw);
				assert.equal(seen.text, TEXT);
				assert.equal(seen.include_mapping, true);
				res.setHeader("content-type", "application/json");
				res.end(JSON.stringify(body));
			});
		});
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address() as { port: number };
			resolve({ server, url: `http://127.0.0.1:${port}` });
		});
	});
}

test("bridge maps rizzo-pii mapping entries to detections with source offsets", async () => {
	const { server, url } = await cannedServer(CANNED);
	try {
		const detections = await rizzoAnalyzer(url).analyze(TEXT);
		assert.deepEqual(detections, [
			{ start: 0, end: 11, label: "FULLNAME", validated: false },
			{ start: TEXT.indexOf(CF), end: TEXT.indexOf(CF) + CF.length, label: "CF", validated: true },
		]);
	} finally {
		server.close();
	}
});

test("bridge rejects a response that breaks the mapping contract", async () => {
	const { server, url } = await cannedServer({ anonymized_text: "x" });
	try {
		await assert.rejects(() => rizzoAnalyzer(url).analyze(TEXT), /mapping/);
	} finally {
		server.close();
	}
});
