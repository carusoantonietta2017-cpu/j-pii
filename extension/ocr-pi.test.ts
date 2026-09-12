// Test hook ocr-pi (b6): domande una tantum, remember, mask, fail-closed.
// Runner finto iniettato; analyzer fake (niente modello).
import { test } from "node:test";
import assert from "node:assert/strict";
import ocrPi, { __resetSession, __setRunner, imagePathsFromPrompt } from "./ocr-pi.ts";

process.env.JPII_ANALYZER = "fake";

const CF = "RSSMRA80A01H501U";
const IMG = { type: "image", data: Buffer.from("finto").toString("base64"), mimeType: "image/png" };

function fakePi() {
	const handlers: Record<string, any> = {};
	return {
		handlers,
		on: (event: string, h: any) => {
			handlers[event] = h;
		},
	};
}

function fakeCtx(answers: Array<string | undefined>, opts: { hasUI?: boolean } = {}) {
	const asked: string[] = [];
	const notices: string[] = [];
	return {
		ctx: {
			cwd: ".",
			hasUI: opts.hasUI ?? true,
			ui: {
				select: async (title: string) => {
					asked.push(title);
					return answers.shift();
				},
				notify: (msg: string) => {
					notices.push(msg);
				},
			},
		},
		asked,
		notices,
	};
}

function setup(answers: Array<string | undefined>, md = `dato ${CF} fine`, opts = {}) {
	__resetSession();
	__setRunner(async () => ({ markdown: md, assets: [], pages: 1, engine: "fake", seconds: 0.1 }));
	const pi = fakePi();
	ocrPi(pi as any);
	const { ctx, asked, notices } = fakeCtx(answers, opts);
	return { pi, ctx: ctx as any, asked, notices };
}

test("Si/Si: inietta md mascherato, chiede due volte", async () => {
	const { pi, ctx, asked } = setup(["Sì, converti in locale", "Sì, maschera con j-pii"]);
	const out = (await pi.handlers["before_agent_start"]({ prompt: "x", images: [IMG] }, ctx)) as {
		message: { content: string };
	};
	assert.equal(asked.length, 2);
	assert.ok(out.message.content.includes("[CF_1]"));
	assert.equal(out.message.content.includes(CF), false);
});

test("Si/No: inietta md in chiaro", async () => {
	const { pi, ctx } = setup(["Sì, converti in locale", "No"]);
	const out = (await pi.handlers["before_agent_start"]({ prompt: "x", images: [IMG] }, ctx)) as {
		message: { content: string };
	};
	assert.ok(out.message.content.includes(CF));
});

test("No: nessun OCR, warning, niente messaggio", async () => {
	let ran = false;
	__setRunner(async () => {
		ran = true;
		return { markdown: "", assets: [], pages: 0, engine: "fake", seconds: 0 };
	});
	const { pi, ctx, notices } = setup(["No, invia immagini originali", "No"]);
	const out = await pi.handlers["before_agent_start"]({ prompt: "x", images: [IMG] }, ctx);
	assert.equal(out, undefined);
	assert.equal(ran, false);
	assert.ok(notices.some((n) => n.includes("originali")));
});

test("dismiss -> fail-closed (throw)", async () => {
	const { pi, ctx } = setup([undefined]);
	await assert.rejects(pi.handlers["before_agent_start"]({ prompt: "x", images: [IMG] }, ctx), /fail-closed/);
});

test("senza UI -> fail-closed (throw)", async () => {
	const { pi, ctx } = setup(["Sì, converti in locale"], undefined, { hasUI: false });
	await assert.rejects(pi.handlers["before_agent_start"]({ prompt: "x", images: [IMG] }, ctx), /fail-closed/);
});

test("remember: seconda chiamata non richiede", async () => {
	const { pi, ctx, asked } = setup(["Sì, converti in locale", "Sì, maschera con j-pii"]);
	await pi.handlers["before_agent_start"]({ prompt: "x", images: [IMG] }, ctx);
	const out = await pi.handlers["before_agent_start"]({ prompt: "y", images: [IMG] }, ctx);
	assert.equal(asked.length, 2);
	assert.ok((out as { message: { content: string } }).message.content.includes("[CF_1]"));
});

test("senza immagini: niente domande", async () => {
	const { pi, ctx, asked } = setup(["Sì, converti in locale", "No"]);
	const out = await pi.handlers["before_agent_start"]({ prompt: "x", images: [] }, ctx);
	assert.equal(out, undefined);
	assert.equal(asked.length, 0);
});

test("session_start azzera il remember", async () => {
	const { pi, ctx, asked } = setup(["No, invia immagini originali", "No", "No, invia immagini originali", "No"]);
	await pi.handlers["before_agent_start"]({ prompt: "x", images: [IMG] }, ctx);
	await pi.handlers["session_start"]();
	const out = await pi.handlers["before_agent_start"]({ prompt: "y", images: [IMG] }, ctx);
	assert.equal(asked.length, 4);
	assert.equal(out, undefined);
});

test("percorsi immagine nel testo: tag <file>, @path, scarta inesistenti", () => {
	const got = imagePathsFromPrompt(
		'<file name="/tmp/fattura-demo.png"></file> vedi @/tmp/fattura-demo.png e /tmp/inesistente.png e nota.txt',
	);
	assert.deepEqual(got, ["/tmp/fattura-demo.png"]);
});

test("path citato senza allegati: chiede e converte il file vero", async () => {
	let converted = "";
	const { pi, ctx, asked } = setup(["Sì, converti in locale", "No"]);
	__setRunner(async (p: string) => {
		converted = p;
		return { markdown: "tabella vera", assets: [], pages: 1, engine: "fake", seconds: 0.1 };
	});
	const out = (await pi.handlers["before_agent_start"](
		{ prompt: '<file name="/tmp/fattura-demo.png"></file> cosa contiene?', images: [] },
		ctx,
	)) as { message: { content: string } };
	assert.equal(asked.length, 2);
	assert.equal(converted, "/tmp/fattura-demo.png");
	assert.ok(out.message.content.includes("tabella vera"));
});
