// Client demone converter (protocollo JSON-lines di ocr-pi/daemon.py). Zero dipendenze.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export function findPython() {
	if (process.env.UI_PYTHON) return process.env.UI_PYTHON;
	const venv = join(HERE, "..", "ocr-pi", ".venv", "bin", "python");
	return venv;
}

export class Daemon {
	#proc;
	#nextId = 1;
	#pending = new Map();
	#buf = "";

	ensure(cwd) {
		if (this.#proc && this.#proc.exitCode === null) return;
		this.#pending.clear();
		this.#buf = "";
		this.#proc = spawn(findPython(), [join(HERE, "..", "ocr-pi", "daemon.py")], {
			cwd,
			stdio: ["pipe", "pipe", "ignore"],
		});
		this.#proc.stdout.on("data", (chunk) => this.#onData(chunk));
		this.#proc.on("exit", () => {
			for (const done of this.#pending.values()) done({ id: -1, ok: false, error: "demone terminato" });
			this.#pending.clear();
			this.#proc = undefined;
		});
	}

	#onData(chunk) {
		this.#buf += chunk.toString("utf-8");
		let nl;
		while ((nl = this.#buf.indexOf("\n")) >= 0) {
			const line = this.#buf.slice(0, nl).trim();
			this.#buf = this.#buf.slice(nl + 1);
			if (!line) continue;
			try {
				const msg = JSON.parse(line);
				this.#pending.get(msg.id)?.(msg);
				this.#pending.delete(msg.id);
			} catch {
				/* riga non JSON: ignora */
			}
		}
	}

	request(msg, cwd, timeoutMs = 900000) {
		this.ensure(cwd);
		const proc = this.#proc;
		if (!proc?.stdin?.writable) return Promise.reject(new Error("demone non raggiungibile"));
		const id = this.#nextId++;
		return new Promise((done) => {
			const timer = setTimeout(() => {
				if (this.#pending.delete(id)) done({ id, ok: false, error: "demone: timeout risposta" });
			}, timeoutMs);
			this.#pending.set(id, (m) => {
				clearTimeout(timer);
				done(m);
			});
			proc.stdin.write(JSON.stringify({ id, ...msg }) + "\n");
		});
	}

	convert({ path, engine = "docling", pages = null, workdir, deskew = false }, cwd) {
		return this.request({ op: "convert", source: path, engine, pages, workdir, deskew }, cwd).then((msg) => {
			if (!msg.ok) throw new Error(msg.error ?? "errore demone");
			return msg.result;
		});
	}

	stop() {
		try {
			this.#proc?.stdin?.end();
		} catch {
			/* best-effort */
		}
		this.#proc = undefined;
		this.#pending.clear();
	}
}
