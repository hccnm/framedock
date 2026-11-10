import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

if (process.env.FRAMEDOCK_ENGINE_FIXTURE) {
    os.homedir = () => process.env.FRAMEDOCK_ENGINE_FIXTURE!;
    const { startHttpServer } = await import("./http.js");
    startHttpServer();
} else {
    test("Agent 引擎切换、历史恢复、运行互斥、失败保护与鉴权", async (t) => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "framedock-engine-"));
        const listener = net.createServer();
        await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
        const port = (listener.address() as net.AddressInfo).port;
        await new Promise<void>((resolve) => listener.close(() => resolve()));
        const token = "isolated-engine-test";
        const configDirectory = path.join(directory, ".framedock");
        await fs.mkdir(configDirectory);
        await fs.writeFile(path.join(configDirectory, "canvas-agent.json"), JSON.stringify({ url: `http://127.0.0.1:${port}`, token, runtime: { selectedId: "codex", executablePath: path.join(directory, "missing-codex") } }));
        const child = spawn(process.execPath, ["--import", "tsx", import.meta.filename], { env: { ...process.env, FRAMEDOCK_ENGINE_FIXTURE: directory, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
        t.after(async () => { child.kill(); await new Promise<void>((resolve) => child.exitCode !== null ? resolve() : child.once("exit", () => resolve())); await fs.rm(directory, { recursive: true, force: true }); });
        await new Promise<void>((resolve, reject) => {
            child.stdout.on("data", (chunk) => { if (String(chunk).includes("Local URL:")) resolve(); });
            child.once("exit", (code) => reject(new Error(`fixture exited: ${code}`)));
            child.once("error", reject);
        });
        const request = (route: string, body?: unknown, auth = token) => fetch(`http://127.0.0.1:${port}${route}`, { method: body === undefined ? "GET" : "POST", headers: { "x-canvas-agent-token": auth, "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
        assert.equal((await request("/agent/engine", { engine: "api" }, "wrong")).status, 401);
        assert.equal((await request("/agent/engine", { engine: "unknown" })).status, 400);
        const first = await (await request("/agent/engine", { engine: "api" })).json();
        assert.ok(first.conversation.threadId);
        assert.equal(first.conversation.status, "ready");
        const resumed = await (await request("/agent/engine", { engine: "api" })).json();
        assert.equal(resumed.conversation.threadId, first.conversation.threadId);
        assert.equal(resumed.conversation.revision, first.conversation.revision);
        const failed = await request("/agent/engine", { engine: "codex" });
        assert.equal(failed.status, 500);
        assert.match((await failed.json()).error, /路径不可用/);
        const restored = await (await request("/agent/engine", { engine: "api" })).json();
        assert.equal(restored.conversation.threadId, first.conversation.threadId);
        assert.equal(restored.conversation.status, "ready");
        const history = await (await request("/agent/api/threads")).json();
        assert.deepEqual(history.data.map((thread: { id: string }) => thread.id), [first.conversation.threadId]);
        const executablePath = path.join(directory, "codex");
        await fs.copyFile(new URL("./fixtures/codex-cli.cjs", import.meta.url), executablePath);
        await fs.chmod(executablePath, 0o700);
        const selected = await fetch(`http://127.0.0.1:${port}/agent/runtime`, { method: "PUT", headers: { "x-canvas-agent-token": token, "content-type": "application/json" }, body: JSON.stringify({ id: "codex", executablePath }) });
        assert.equal(selected.status, 200);
        const stillApi = await (await request("/agent/engine", { engine: "api" })).json();
        assert.equal(stillApi.conversation.threadId, first.conversation.threadId);
        const cli = await (await request("/agent/engine", { engine: "codex" })).json();
        assert.equal(cli.conversation.threadId, "fixture-codex-thread");
        assert.equal(cli.conversation.status, "ready");
        const reconnect = await (await request("/agent/engine", { engine: "api", initialize: true })).json();
        assert.equal(reconnect.engine, "codex");
        assert.equal(reconnect.conversation.threadId, cli.conversation.threadId);
        const models = await (await request("/agent/codex/models")).json();
        assert.equal(models.data[0].model, "fixture-codex");
        const abort = new AbortController();
        const events = await fetch(`http://127.0.0.1:${port}/events?token=${token}&clientId=engine-test`, { signal: abort.signal });
        const reader = events.body!.getReader();
        t.after(() => abort.abort());
        await reader.read();
        const accepted = await request("/agent/codex/turn", { prompt: "hold", clientId: "engine-test", threadId: cli.conversation.threadId, conversationId: cli.conversation.conversationId, expectedRevision: cli.conversation.revision });
        assert.equal(accepted.status, 200);
        assert.equal((await request("/agent/engine", { engine: "api" })).status, 409);
        assert.equal((await request("/agent/codex/interrupt", { threadId: cli.conversation.threadId })).status, 200);
        let settled = false;
        while (!settled) {
            const { value, done } = await reader.read();
            assert.equal(done, false);
            const text = new TextDecoder().decode(value);
            settled = text.includes('"busy":false');
        }
        const back = await (await request("/agent/engine", { engine: "api" })).json();
        assert.equal(back.conversation.threadId, first.conversation.threadId);
        const cliResumed = await (await request("/agent/engine", { engine: "codex" })).json();
        assert.equal(cliResumed.conversation.threadId, cli.conversation.threadId);
        abort.abort();
    });
}
