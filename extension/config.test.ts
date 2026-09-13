// Config surface v1: documented env vars, pure and testable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "./config.ts";

test("defaults: real analyzer, python3, port 5005, no exclusions", () => {
	const c = resolveConfig({});
	assert.equal(c.analyzer, "real");
	assert.equal(c.python, "python3");
	assert.equal(c.port, 5005);
	assert.deepEqual(c.excludeLabels, []);
	assert.equal(c.sidecarUrl, "http://127.0.0.1:5005");
	assert.equal(c.autoMaskDoubtful, false);
});

test("auto-mask doubtful opt-in for headless dock", () => {
	assert.equal(resolveConfig({}).autoMaskDoubtful, false);
	assert.equal(resolveConfig({ JPII_AUTO_MASK_DOUBTFUL: "1" }).autoMaskDoubtful, true);
	assert.equal(resolveConfig({ JPII_AUTO_MASK_DOUBTFUL: "0" }).autoMaskDoubtful, false);
});

test("explicit fake analyzer for offline/tests", () => {
	assert.equal(resolveConfig({ JPII_ANALYZER: "fake" }).analyzer, "fake");
});

test("overrides: url, python, port, model dir, exclude tags", () => {
	const c = resolveConfig({
		JPII_SIDECAR_URL: "http://localhost:5999",
		JPII_PYTHON: "/opt/venv/bin/python",
		JPII_SIDECAR_PORT: "5999",
		JPII_MODEL_DIR: "/data/model",
		JPII_EXCLUDE_TAGS: "EMAIL, CITY",
	});
	assert.equal(c.sidecarUrl, "http://localhost:5999");
	assert.equal(c.python, "/opt/venv/bin/python");
	assert.equal(c.port, 5999);
	assert.equal(c.modelDir, "/data/model");
	assert.deepEqual(c.excludeLabels, ["EMAIL", "CITY"]);
});
