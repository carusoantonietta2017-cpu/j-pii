// Seam under test: sidecar lifecycle. Reuses a healthy server when one
// is already up; otherwise spawns, waits for health, and owns it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createServer as netServer } from "node:net";
import type { AddressInfo } from "node:net";
import { ensureSidecar } from "./sidecar.ts";

async function freePort(): Promise<number> {
	return new Promise((resolve) => {
		const s = netServer();
		s.listen(0, "127.0.0.1", () => {
			const { port } = s.address() as AddressInfo;
			s.close(() => resolve(port));
		});
	});
}

const STUB = `require("http").createServer((q,r)=>{r.end("{}")}).listen(Number(process.argv[1]))`;

async function health(url: string): Promise<boolean> {
	try {
		const res = await fetch(url);
		return res.ok;
	} catch {
		return false;
	}
}

test("spawns a server when none is up, stop kills it", async () => {
	const port = await freePort();
	const url = `http://127.0.0.1:${port}/health`;
	const side = await ensureSidecar({
		command: process.execPath,
		args: ["-e", STUB, String(port)],
		healthUrl: url,
		readyTimeoutMs: 15000,
	});
	assert.equal(side.owned, true);
	assert.equal(await health(url), true);
	await side.stop();
	await new Promise((r) => setTimeout(r, 300));
	assert.equal(await health(url), false);
});

test("reuses a running server without owning it", async () => {
	const port = await freePort();
	const url = `http://127.0.0.1:${port}/health`;
	const server = createServer((_, res) => res.end("{}"));
	await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
	try {
		const side = await ensureSidecar({
			command: process.execPath,
			args: ["-e", STUB, String(port)],
			healthUrl: url,
			readyTimeoutMs: 5000,
		});
		assert.equal(side.owned, false);
		await side.stop();
		assert.equal(await health(url), true);
	} finally {
		server.close();
	}
});
