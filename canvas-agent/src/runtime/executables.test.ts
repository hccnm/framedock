import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { collectCliCandidates, commandFileNames, dedupeCandidates, MAX_PROBE_CANDIDATES, parseCliVersion } from "./executables.js";

test("parseCliVersion extracts semantic versions from probe output", () => {
    assert.equal(parseCliVersion("codex-cli 0.146.0"), "0.146.0");
    assert.equal(parseCliVersion("1.2.3 (build 42)\n"), "1.2.3");
    assert.equal(parseCliVersion("codex 2.0.1-beta.1"), "2.0.1-beta.1");
    assert.equal(parseCliVersion("no version here"), "");
});

test("commandFileNames expands Windows executables and keeps POSIX names", () => {
    assert.deepEqual(commandFileNames("codex", "darwin"), ["codex"]);
    assert.deepEqual(commandFileNames("codex", "linux"), ["codex"]);
    const names = commandFileNames("codex", "win32", ".COM;.EXE;.BAT;.CMD");
    assert.equal(names[0], "codex");
    assert.ok(names.includes("codex.exe"));
    assert.ok(names.includes("codex.cmd"));
    assert.ok(names.includes("codex.bat"));
    assert.equal(new Set(names).size, names.length);
});

test("dedupeCandidates removes duplicates and caps probe count", () => {
    assert.deepEqual(dedupeCandidates(["/a/codex", "/a/codex", "", "/b/codex"]), ["/a/codex", "/b/codex"]);
    const many = Array.from({ length: 20 }, (_, index) => `/dir-${index}/codex`);
    assert.equal(dedupeCandidates(many).length, MAX_PROBE_CANDIDATES);
});

/** 在临时目录里创建可执行文件，返回其绝对路径。 */
async function createExecutable(dir: string, name: string) {
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, name);
    await fs.writeFile(file, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    return file;
}

test("collectCliCandidates keeps explicit path first and real PATH matches without exceeding the cap", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-candidates-"));
    const explicit = await createExecutable(path.join(root, "custom"), "codex");
    const delimiter = process.platform === "win32" ? ";" : ":";
    const first = await createExecutable(path.join(root, "first"), "codex");
    const second = await createExecutable(path.join(root, "second"), "codex");
    const home = path.join(root, "home");
    const candidates = await collectCliCandidates("codex", {
        explicitPath: path.join(root, "custom", "codex"),
        env: { PATH: [path.dirname(first), path.dirname(second)].join(delimiter), PATHEXT: "" },
        home,
    });
    assert.equal(candidates[0], explicit);
    assert.ok(candidates.includes(first));
    assert.ok(candidates.includes(second));
    assert.ok(candidates.length <= MAX_PROBE_CANDIDATES);
    assert.equal(new Set(candidates).size, candidates.length);
});

test("collectCliCandidates normalizes relative PATH directories to absolute candidates", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-candidates-"));
    const tools = await createExecutable(path.join(root, "relative-tools"), "codex");
    const relativeDir = path.relative(process.cwd(), path.dirname(tools));
    const delimiter = process.platform === "win32" ? ";" : ":";
    const candidates = await collectCliCandidates("codex", { env: { PATH: `.${delimiter}${relativeDir}`, PATHEXT: "" }, home: path.join(root, "home") });
    assert.ok(candidates.includes(tools));
    assert.ok(candidates.every((item) => path.isAbsolute(item)));
});

test("collectCliCandidates validates existence before capping so toolchain paths survive noisy PATH entries", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-candidates-"));
    const home = path.join(root, "home");
    const toolchainCodex = await createExecutable(path.join(home, ".local", "bin"), "codex");
    // 生成 MAX_PROBE_CANDIDATES 个真实存在但不含 codex 的 PATH 目录，模拟图形环境继承的无效 PATH 项。
    const delimiter = process.platform === "win32" ? ";" : ":";
    const emptyDirs = Array.from({ length: MAX_PROBE_CANDIDATES + 2 }, (_, index) => path.join(root, `empty-${index}`));
    await Promise.all(emptyDirs.map((dir) => fs.mkdir(dir, { recursive: true })));
    const emptyPaths = emptyDirs.join(delimiter);
    const candidates = await collectCliCandidates("codex", { env: { PATH: emptyPaths, PATHEXT: "" }, home });
    assert.ok(candidates.includes(toolchainCodex));
    assert.ok(candidates.every((item) => path.isAbsolute(item)));
});

test("collectCliCandidates keeps a missing explicit path so probing can report it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-candidates-"));
    const home = path.join(root, "home");
    const toolchainCodex = await createExecutable(path.join(home, ".local", "bin"), "codex");
    const missing = path.join(root, "missing", "codex");
    const candidates = await collectCliCandidates("codex", { explicitPath: missing, env: { PATH: "", PATHEXT: "" }, home });
    assert.equal(candidates[0], missing);
    assert.ok(candidates.includes(toolchainCodex));
});
