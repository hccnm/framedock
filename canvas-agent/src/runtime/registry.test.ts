import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { bindRuntimeConfig, CliRuntimeError, normalizeExplicitCliPath, selectLocalRuntime, testLocalRuntime } from "./registry.js";

test("normalizeExplicitCliPath accepts absolute paths and resolves them", () => {
    const absolute = path.join(os.tmpdir(), "codex");
    assert.equal(normalizeExplicitCliPath(absolute), path.resolve(absolute));
    assert.equal(normalizeExplicitCliPath(`  ${absolute}  `), path.resolve(absolute));
});

test("normalizeExplicitCliPath rejects relative paths with a 400 error", () => {
    assert.throws(() => normalizeExplicitCliPath("./codex"), (error: unknown) => error instanceof CliRuntimeError && error.statusCode === 400 && error.message.includes("绝对路径"));
    assert.throws(() => normalizeExplicitCliPath(`bin${path.sep}codex`), (error: unknown) => error instanceof CliRuntimeError && error.statusCode === 400);
});

test("normalizeExplicitCliPath treats empty input as no explicit path", () => {
    assert.equal(normalizeExplicitCliPath(undefined), undefined);
    assert.equal(normalizeExplicitCliPath("   "), undefined);
});

test("selectLocalRuntime rejects relative explicit paths before probing", async () => {
    bindRuntimeConfig({ url: "http://127.0.0.1:17371", token: "test-token" });
    await assert.rejects(selectLocalRuntime("codex", "./codex"), (error: unknown) => error instanceof CliRuntimeError && error.statusCode === 400 && error.message.includes("绝对路径"));
});

test("testLocalRuntime reports relative explicit paths as failed diagnostics without probing", async () => {
    bindRuntimeConfig({ url: "http://127.0.0.1:17371", token: "test-token" });
    const result = await testLocalRuntime("codex", "./codex");
    assert.equal(result.available, false);
    assert.equal(result.executablePath, "./codex");
    assert.equal(result.diagnostics?.[0]?.code, "invalid-explicit-path");
    assert.ok(result.diagnostics?.[0]?.message.includes("绝对路径"));
});
