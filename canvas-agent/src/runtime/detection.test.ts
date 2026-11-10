import assert from "node:assert/strict";
import test from "node:test";

import { interpretVersionProbe } from "./detection.js";
import { isUnsafeWindowsCmdTarget } from "./process.js";

test("interpretVersionProbe accepts a real codex version output", () => {
    const verdict = interpretVersionProbe("codex", "/opt/homebrew/bin/codex", 0, "codex-cli 0.146.0\n");
    assert.equal(verdict.version, "0.146.0");
    assert.equal(verdict.diagnostic, undefined);
});

test("interpretVersionProbe rejects non-zero exits", () => {
    const verdict = interpretVersionProbe("codex", "/bin/codex", 1, "codex-cli 0.146.0\n");
    assert.equal(verdict.version, undefined);
    assert.equal(verdict.diagnostic?.code, "probe-exit");
});

test("interpretVersionProbe rejects failed spawns", () => {
    const verdict = interpretVersionProbe("codex", "/bin/codex", null, "");
    assert.equal(verdict.version, undefined);
    assert.equal(verdict.diagnostic?.code, "probe-failed");
});

test("interpretVersionProbe rejects outputs that do not confirm the CLI identity", () => {
    const verdict = interpretVersionProbe("codex", "/bin/imposter", 0, "9.9.9\n");
    assert.equal(verdict.version, undefined);
    assert.equal(verdict.diagnostic?.code, "identity-unconfirmed");
});

test("interpretVersionProbe rejects readable versions without identity even with noise", () => {
    const verdict = interpretVersionProbe("codex", "/bin/imposter", 0, "version: 1.2.3\n");
    assert.equal(verdict.diagnostic?.code, "identity-unconfirmed");
});

test("interpretVersionProbe rejects identity without a parseable version", () => {
    const verdict = interpretVersionProbe("codex", "/bin/codex", 0, "codex ready\n");
    assert.equal(verdict.version, undefined);
    assert.equal(verdict.diagnostic?.code, "version-unreadable");
});

test("isUnsafeWindowsCmdTarget only guards cmd.exe interpreted scripts", () => {
    assert.equal(isUnsafeWindowsCmdTarget('C:\\tools\\evil" & calc.cmd', "win32"), true);
    assert.equal(isUnsafeWindowsCmdTarget("C:\\tools\\100%test.cmd", "win32"), true);
    assert.equal(isUnsafeWindowsCmdTarget("C:\\tools\\a|b.cmd", "win32"), true);
    assert.equal(isUnsafeWindowsCmdTarget("C:\\tools\\codex.cmd", "win32"), false);
    assert.equal(isUnsafeWindowsCmdTarget("C:\\tools\\codex.exe", "win32"), false);
    assert.equal(isUnsafeWindowsCmdTarget("/opt/homebrew/bin/100%codex", "darwin"), false);
});
