import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { readReleaseVersion } from "../../script/prepare-desktop.mjs";

const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
const source = await readFile(new URL("../src/paths.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;

function paths(packaged, env = {}) {
    const exports = {};
    vm.runInNewContext(compiled, {
        exports, __dirname: "/checkout/desktop/dist",
        process: { env, resourcesPath: "/Applications/FrameDock.app/Contents/Resources" },
        require: (id) => id === "electron" ? { app: { isPackaged: packaged } } : require(id),
    });
    return exports;
}

test("安装包从 Resources 读取前端、助手和图标，不受开发路径覆盖", () => {
    const runtime = paths(true, { FRAMEDOCK_WEB_DIST: "/wrong/web", FRAMEDOCK_AGENT_ENTRY: "/wrong/agent" });
    assert.equal(runtime.resolveWebDist(), "/Applications/FrameDock.app/Contents/Resources/web/dist");
    assert.equal(runtime.resolveAgentEntry(), "/Applications/FrameDock.app/Contents/Resources/canvas-agent/dist/index.js");
    assert.equal(runtime.resolveAppIcon(), "/Applications/FrameDock.app/Contents/Resources/framedock-icon.png");
});

test("源码运行沿用仓库资源路径，允许显式开发覆盖", () => {
    const runtime = paths(false);
    assert.equal(runtime.resolveWebDist(), "/checkout/web/dist");
    assert.equal(runtime.resolveAgentEntry(), "/checkout/canvas-agent/dist/index.js");
    assert.equal(runtime.resolveAppIcon(), "/checkout/web/public/framedock-icon.png");
    const custom = paths(false, { FRAMEDOCK_WEB_DIST: "/custom/web", FRAMEDOCK_AGENT_ENTRY: "/custom/agent.js" });
    assert.equal(custom.resolveWebDist(), "/custom/web");
    assert.equal(custom.resolveAgentEntry(), "/custom/agent.js");
});

test("安装包版本读取 VERSION，拒绝与推送 tag 不一致的版本", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "framedock-version-"));
    const previousType = process.env.GITHUB_REF_TYPE;
    const previousName = process.env.GITHUB_REF_NAME;
    try {
        await writeFile(path.join(directory, "VERSION"), "v1.2.3-beta.1\n");
        process.env.GITHUB_REF_TYPE = "tag";
        process.env.GITHUB_REF_NAME = "v1.2.3-beta.1";
        assert.equal(await readReleaseVersion(directory), "1.2.3-beta.1");
        process.env.GITHUB_REF_NAME = "v1.2.3";
        await assert.rejects(readReleaseVersion(directory), /不一致/);
        process.env.GITHUB_REF_TYPE = "branch";
        assert.equal(await readReleaseVersion(directory), "1.2.3-beta.1");
    } finally {
        for (const [key, value] of [["GITHUB_REF_TYPE", previousType], ["GITHUB_REF_NAME", previousName]]) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
        await rm(directory, { recursive: true, force: true });
    }
});
