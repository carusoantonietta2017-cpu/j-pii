// PROTOTYPE — THROWAWAY, DO NOT PRODUCTIONIZE (issue #5).
// Fake regex masker proving the pi hook plumbing:
//   mask in before_provider_request, restore in message_end.
// Real rizzo-pii replaces fakeMask()/fakeRestore() if the verdict is go.
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LOG = "/tmp/spike-mask-state.log";
const mapping = new Map<string, string>();
const counters: Record<string, number> = {};

function log(line: string) {
	appendFileSync(LOG, line + "\n", "utf8");
	console.log(`[spike] ${line}`);
}

const PATTERNS: Array<[RegExp, string]> = [
	[/[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]/g, "CF"],
	[/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "EMAIL"],
];

function fakeMask(text: string): string {
	let out = text;
	for (const [re, label] of PATTERNS) {
		out = out.replace(re, (m) => {
			const key = `${label}_${(counters[label] = (counters[label] ?? 0) + 1)}`;
			const ph = `[${key}]`;
			mapping.set(ph, m);
			return ph;
		});
	}
	return out;
}

function fakeRestore(text: string): string {
	let out = text;
	for (const [ph, val] of mapping) out = out.split(ph).join(val);
	return out;
}

function deepMask(value: unknown): unknown {
	if (typeof value === "string") return fakeMask(value);
	if (Array.isArray(value)) return value.map(deepMask);
	if (value && typeof value === "object") {
		const o: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) o[k] = deepMask(v);
		return o;
	}
	return value;
}

function deepRestore(value: unknown): unknown {
	if (typeof value === "string") return fakeRestore(value);
	if (Array.isArray(value)) return value.map(deepRestore);
	if (value && typeof value === "object") {
		const o: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value)) o[k] = deepRestore(v);
		return o;
	}
	return value;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", () => {
		mapping.clear();
		log("session_start: mapping cleared");
	});

	pi.on("before_provider_request", (event) => {
		const raw = JSON.stringify(event.payload);
		const masked = deepMask(JSON.parse(raw));
		log(`mask: mapping=${JSON.stringify([...mapping])}`);
		const check = JSON.stringify(masked);
		log(`mask: leak-check(real values in payload)=${[...mapping.values()].some((v) => check.includes(v))}`);
		return masked;
	});

	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;
		const restored = deepRestore(event.message.content);
		log(`restore: placeholders left=${JSON.stringify(restored).includes("[CF_") || JSON.stringify(restored).includes("[EMAIL_")}`);
		return { message: { ...event.message, content: restored as never } };
	});
}
