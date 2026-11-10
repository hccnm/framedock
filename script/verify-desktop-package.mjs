import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const output = path.resolve(process.argv[2] || "desktop/release");
const applications = [];
for (const entry of await readdir(output, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(output, entry.name, "FrameDock.app");
    try { await access(candidate); applications.push(candidate); } catch { /* 其他构建产物 */ }
}
assert.ok(applications.length, "未找到打包后的 FrameDock.app");
const expectedVersion = (await readFile(new URL("../VERSION", import.meta.url), "utf8")).trim().replace(/^v/, "");
for (const application of applications) {
    const resources = path.join(application, "Contents/Resources");
    for (const relative of ["app.asar", "web/dist/index.html", "web/dist/plugins/index.json", "canvas-agent/dist/index.js", "canvas-agent/package.json", "canvas-agent/agent-instructions.md", "framedock-icon.png"]) {
        await access(path.join(resources, relative));
    }
    const plist = execFileSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", path.join(application, "Contents/Info.plist")], { encoding: "utf8" }).trim();
    assert.equal(plist, expectedVersion, "安装包版本必须与 VERSION 一致");
    const temporaryHome = await mkdtemp(path.join(os.tmpdir(), "framedock-package-"));
    try {
        // 用随包 Electron 的 Node 模式加载实际助手依赖图；不启动模型、CLI 或服务。
        execFileSync(path.join(application, "Contents/MacOS/FrameDock"), ["--input-type=module", "--eval", `
            import { pathToFileURL } from "node:url";
            import path from "node:path";
            const root = process.argv[1];
            await import(pathToFileURL(path.join(root, "canvas-agent/dist/server/http.js")));
            const { AGENT_PROMPT } = await import(pathToFileURL(path.join(root, "canvas-agent/dist/config.js")));
            if (!AGENT_PROMPT.trim()) throw new Error("助手指令为空");
            console.log("Packaged Agent dependencies loaded successfully");
        `, resources], {
            env: { ...process.env, HOME: temporaryHome, ELECTRON_RUN_AS_NODE: "1", NODE_OPTIONS: "", FRAMEDOCK_AGENT_LOG: "0" },
            cwd: temporaryHome, stdio: "inherit",
        });
    } finally {
        await rm(temporaryHome, { recursive: true, force: true });
    }
    console.log(`已检查安装包资源、版本和助手运行依赖：${application}`);
}
