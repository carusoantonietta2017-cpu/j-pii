// Local rizzo-pii sidecar lifecycle: reuse a healthy server when one is
// already up (idempotent across sessions); otherwise spawn the vendored
// Flask app, wait for /health, and own it until session shutdown.
import { spawn, type ChildProcess } from "node:child_process";

export interface SidecarOptions {
	command: string;
	args: string[];
	cwd?: string;
	env?: Record<string, string | undefined>;
	healthUrl: string;
	readyTimeoutMs?: number;
	pollMs?: number;
}

export interface ManagedSidecar {
	owned: boolean;
	stop(): Promise<void>;
}

async function healthy(url: string): Promise<boolean> {
	try {
		const res = await fetch(url);
		return res.ok;
	} catch {
		return false;
	}
}

function waitForSettled(child: ChildProcess, onError: (e: Error) => void): Promise<void> {
	return new Promise((resolve) => {
		// A failed spawn emits 'error' (and maybe never 'exit'): without
		// this listener node throws uncaught and takes pi down with it.
		child.once("error", (e) => {
			onError(e as Error);
			resolve();
		});
		if (child.exitCode !== null) resolve();
		else child.once("exit", () => resolve());
	});
}

export async function ensureSidecar(opts: SidecarOptions): Promise<ManagedSidecar> {
	if (await healthy(opts.healthUrl)) return { owned: false, stop: async () => {} };
	const child = spawn(opts.command, opts.args, {
		cwd: opts.cwd,
		env: { ...process.env, ...opts.env },
		stdio: "ignore",
		detached: false,
	});
	let spawnError: Error | undefined;
	const childGone = waitForSettled(child, (e) => {
		spawnError = e;
	});
	const deadline = Date.now() + (opts.readyTimeoutMs ?? 90000);
	const pollMs = opts.pollMs ?? 250;
	for (;;) {
		if (await healthy(opts.healthUrl)) {
			return {
				owned: true,
				stop: async () => {
					child.kill();
					await childGone;
				},
			};
		}
		if (spawnError) {
			throw new Error(`j-pii cannot start sidecar (check JPII_PYTHON): ${spawnError.message}`);
		}
		if (child.exitCode !== null) {
			throw new Error(`j-pii sidecar exited before becoming healthy (code ${child.exitCode})`);
		}
		if (Date.now() > deadline) {
			child.kill();
			throw new Error(`j-pii sidecar did not become healthy at ${opts.healthUrl} in time`);
		}
		await new Promise((r) => setTimeout(r, pollMs));
	}
}
