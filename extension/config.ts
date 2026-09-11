// v1 config surface (documented in /README.md):
// JPII_ANALYZER=fake selects the offline regex analyzer (default: real),
// JPII_SIDECAR_URL overrides the sidecar endpoint,
// JPII_PYTHON selects the interpreter running the sidecar,
// JPII_SIDECAR_PORT selects the sidecar port (default 5005),
// JPII_MODEL_DIR overrides the model directory for the sidecar,
// JPII_EXCLUDE_TAGS is the comma-separated per-project allowlist.
export interface JpiiConfig {
	analyzer: "real" | "fake";
	python: string;
	port: number;
	sidecarUrl: string;
	modelDir?: string;
	excludeLabels: string[];
}

export function resolveConfig(env: Record<string, string | undefined> = process.env): JpiiConfig {
	const port = Number.parseInt(env.JPII_SIDECAR_PORT ?? "5005", 10);
	return {
		analyzer: env.JPII_ANALYZER === "fake" ? "fake" : "real",
		python: env.JPII_PYTHON ?? "python3",
		port: Number.isFinite(port) ? port : 5005,
		sidecarUrl: env.JPII_SIDECAR_URL ?? `http://127.0.0.1:${Number.isFinite(port) ? port : 5005}`,
		modelDir: env.JPII_MODEL_DIR,
		excludeLabels: (env.JPII_EXCLUDE_TAGS ?? "")
			.split(",")
			.map((t) => t.trim())
			.filter((t) => t.length > 0),
	};
}
