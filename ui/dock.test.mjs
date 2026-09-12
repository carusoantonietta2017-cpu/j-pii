// Test tool dock (makeTools con stub, niente SDK/LLM).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTools } from "./dock.mjs";

const calls = [];
const stubCli = async (args, extra = {}) => {
	calls.push({ args, extra });
	if (args[0] === "search") return [{ wiki: "s", file: "doc/a.md", linea: 1, testo: "riga iva" }];
	if (args[0] === "list") return [{ slug: "s", voci: 1 }];
	if (args[0] === "add") return { name: "N", file: "doc/n.md", review: "draft" };
	if (args[0] === "review") return { name: "N", review: "reviewed" };
	throw new Error("comando stub sconosciuto: " + args[0]);
};
const stubDaemon = async ({ path }) => ({ markdown: "# " + path, assets: [], pages: 1, engine: "fake", seconds: 0.1 });

const tools = makeTools({ cli: stubCli, daemonConvert: stubDaemon });

test("wiki_search passa query e stato", async () => {
	const hits = await tools.wiki_search({ query: "iva", stato: "draft", wiki: "s" });
	assert.equal(hits.length, 1);
	assert.deepEqual(calls.at(-1).args, ["search", "iva", "--stato", "draft", "--wiki", "s"]);
});

test("wiki_add con markdown inline", async () => {
	const e = await tools.wiki_add({ wiki: "s", markdown: "# N\n", title: "N" });
	assert.equal(e.review, "draft");
	assert.deepEqual(calls.at(-1).extra, { markdown: "# N\n" });
});

test("wiki_add senza contenuto solleva", async () => {
	await assert.rejects(tools.wiki_add({ wiki: "s" }), /servono file o markdown/);
});

test("ocr_convert da base64", async () => {
	const r = await tools.ocr_convert({ dataBase64: "aGk=", name: "scontrino.png", engine: "fake" });
	assert.equal(r.engine, "fake");
	assert.ok(r.markdown.includes("#"));
});

test("ocr_convert senza input solleva", async () => {
	await assert.rejects(tools.ocr_convert({}), /servono path o dataBase64/);
});
