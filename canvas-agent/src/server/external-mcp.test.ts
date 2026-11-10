import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, request, type ServerResponse } from "node:http";
import test from "node:test";
import express from "express";

import { CanvasSession } from "../canvas/session.js";
import { createExternalMcp } from "./external-mcp.js";

test("外部 MCP 默认关闭、管理鉴权、独立 Bearer 与本机保护", async (t) => {
    const fixture = await startFixture(t);
    const closed = { ok: true, enabled: false, url: `${fixture.mcpUrl}/mcp`, token: "" };
    assert.deepEqual(await (await fixture.settings()).json(), closed);
    assert.equal((await fixture.settings(undefined, "")).status, 401);
    await assert.rejects(() => fixture.rpc("initialize", {}, ""));
    assert.equal((await fixture.settings("true")).status, 400);
    const enabled = await (await fixture.settings(true)).json();
    assert.deepEqual(Object.keys(enabled).sort(), ["enabled", "ok", "token", "url"]);
    assert.equal(enabled.enabled, true);
    assert.ok(enabled.token);
    assert.notEqual(enabled.token, fixture.internalToken);
    assert.equal((await fixture.rpc("tools/list", {}, "")).status, 401);
    assert.equal((await fixture.rpc("tools/list", {}, fixture.internalToken)).status, 401);
    assert.equal((await fixture.settings(undefined, enabled.token)).status, 401);
    const hostileHost = await new Promise<number | undefined>((resolve, reject) => {
        const req = request(`${fixture.mcpUrl}/mcp`, { method: "POST", headers: { Host: "evil.example", Authorization: `Bearer ${enabled.token}` } }, (res) => {
            res.resume();
            resolve(res.statusCode);
        });
        req.on("error", reject);
        req.end();
    });
    assert.equal(hostileHost, 403);
    assert.equal((await fixture.rpc("tools/list", {}, enabled.token, { Origin: "https://evil.example" })).status, 403);
    assert.equal((await fixture.rpc("tools/list", {}, enabled.token, { Origin: "null" })).status, 403);
    const initialized = await fixture.rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } }, enabled.token);
    assert.equal(initialized.status, 200);
    assert.equal(initialized.headers.get("mcp-session-id"), null);
    const tools = await (await fixture.rpc("tools/list", {}, enabled.token)).json();
    assert.ok(tools.result.tools.some((tool: { name: string }) => tool.name === "canvas_get_state"));
    for (const name of ["canvas_import_media", "canvas_capture_video_frame", "comfyui_import_workflow", "comfyui_list_workflows", "comfyui_get_workflow", "comfyui_run_workflow"]) {
        assert.ok(tools.result.tools.some((tool: { name: string }) => tool.name === name));
    }
    assert.equal((await (await fixture.settings(true)).json()).token, enabled.token);
    assert.deepEqual(await (await fixture.settings(false)).json(), closed);
    await assert.rejects(() => fixture.rpc("tools/list", {}, enabled.token));
    const reopened = await (await fixture.settings(true)).json();
    assert.equal(reopened.token, enabled.token);
    assert.equal(reopened.url, enabled.url);
    assert.equal((await fixture.rpc("tools/list", {}, enabled.token)).status, 200);
    assert.equal((await fixture.reset(enabled.token)).status, 401);
    const reset = await (await fixture.reset()).json();
    assert.notEqual(reset.token, enabled.token);
    assert.equal((await fixture.rpc("tools/list", {}, enabled.token)).status, 401);
    assert.equal((await fixture.rpc("tools/list", {}, reset.token)).status, 200);
    const restarted = await startFixture(t);
    assert.equal((await (await restarted.settings()).json()).enabled, false);
});

test("外部 MCP 使用现有 CanvasSession 读取及写入当前画布，并保留工具参数校验", async (t) => {
    const session = new CanvasSession();
    const response = new EventEmitter() as EventEmitter & { writeHead: () => void; write: (chunk: string) => boolean };
    response.writeHead = () => {};
    const calls: Array<{ name: string; input: unknown }> = [];
    response.write = (chunk) => {
        if (chunk.startsWith("event: tool_call\n")) {
            const call = JSON.parse(chunk.split("\n").find((line) => line.startsWith("data: "))!.slice(6));
            calls.push(call);
            queueMicrotask(() => session.resolveResult("canvas", { requestId: call.requestId, result: { applied: true } }));
        }
        return true;
    };
    session.openEvents(new URL("http://127.0.0.1/events?clientId=canvas"), response as unknown as ServerResponse, "");
    t.after(() => response.emit("close"));
    session.updateState({ projectId: "project-test", title: "测试", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } }, "canvas");
    const fixture = await startFixture(t, session);
    const { token } = await (await fixture.settings(true)).json();
    const read = await (await fixture.rpc("tools/call", { name: "canvas_get_state", arguments: {} }, token)).json();
    assert.equal(JSON.parse(read.result.content[0].text).projectId, "project-test");
    const write = await (await fixture.rpc("tools/call", { name: "canvas_create_text_node", arguments: { text: "外部写入" } }, token)).json();
    assert.deepEqual(JSON.parse(write.result.content[0].text), { applied: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "canvas_apply_ops");
    const invalid = await (await fixture.rpc("tools/call", { name: "canvas_create_text_node", arguments: { text: 123 } }, token)).json();
    assert.ok(invalid.result?.isError || invalid.error);
    assert.equal(calls.length, 1);
    await fixture.settings(false);
    await assert.rejects(() => fixture.rpc("tools/call", { name: "canvas_create_text_node", arguments: { text: "禁用后写入" } }, token));
    assert.equal(calls.length, 1);
});

test("外部 MCP 可调用 ComfyUI 工具，并保留字段类型校验", async (t) => {
    const session = new CanvasSession();
    const calls: Array<{ name: unknown; input: unknown }> = [];
    session.callTool = async (name, input) => {
        calls.push({ name, input });
        return { ok: true };
    };
    const fixture = await startFixture(t, session);
    const { token } = await (await fixture.settings(true)).json();
    for (const [name, args] of [["comfyui_list_workflows", {}], ["comfyui_get_workflow", { workflowId: "saved" }], ["comfyui_run_workflow", { workflowId: "saved", run: false }]] as const) {
        const response = await (await fixture.rpc("tools/call", { name, arguments: args }, token)).json();
        assert.deepEqual(JSON.parse(response.result.content[0].text), { ok: true });
        assert.deepEqual(calls.at(-1), { name, input: args });
    }
    const imported = { name: "H3 草稿", workflowJson: "{}", executionBlockedReason: "尾帧门禁尚未接入" };
    const importResponse = await (await fixture.rpc("tools/call", { name: "comfyui_import_workflow", arguments: imported }, token)).json();
    assert.deepEqual(JSON.parse(importResponse.result.content[0].text), { ok: true });
    assert.deepEqual(calls.at(-1), { name: "comfyui_import_workflow", input: imported });
    const invalid = await (await fixture.rpc("tools/call", { name: "comfyui_run_workflow", arguments: { workflowId: "saved", values: { seed: [] } } }, token)).json();
    assert.ok(invalid.result?.isError || invalid.error);
    const missingProject = await (await fixture.rpc("tools/call", { name: "canvas_import_media", arguments: { nodeId: "audio", nodeType: "audio", title: "音色", dataUrl: "data:audio/wav;base64,YWJj", x: 0, y: 0 } }, token)).json();
    assert.ok(missingProject.result?.isError || missingProject.error);
    assert.equal(calls.length, 4);
});

test("重置令牌会关闭旧请求并撤销旧凭据", async (t) => {
    const session = new CanvasSession();
    let started!: () => void;
    let finish!: (result: unknown) => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    const result = new Promise<unknown>((resolve) => { finish = resolve; });
    let calls = 0;
    session.callTool = async () => {
        calls++;
        started();
        return result;
    };
    const fixture = await startFixture(t, session);
    const { token } = await (await fixture.settings(true)).json();
    const pending = fixture.rpc("tools/call", { name: "canvas_get_state", arguments: {} }, token)
        .then(async (response) => { await response.text(); return false; }, () => true)
        .catch(() => true);
    await running;
    const reopened = await (await fixture.reset()).json();
    assert.notEqual(reopened.token, token);
    assert.equal((await fixture.rpc("tools/call", { name: "canvas_get_state", arguments: {} }, token)).status, 401);
    assert.equal(calls, 1);
    finish({ projectId: "already-dispatched" });
    assert.equal(await pending, true);
});

test("固定端口不随内部地址变化，令牌保存后可在服务重建时复用", async (t) => {
    const saved: string[] = [];
    const fixture = await startFixture(t, undefined, { saveToken: (token) => { saved.push(token); } });
    const enabled = await (await fixture.settings(true)).json();
    assert.notEqual(fixture.url, fixture.mcpUrl);
    assert.equal(saved[0], enabled.token);
    await fixture.close();
    const restarted = await startFixture(t, undefined, { port: Number(new URL(fixture.mcpUrl).port), token: saved[0], saveToken: (token) => { saved.push(token); } });
    assert.equal((await (await restarted.settings()).json()).enabled, false);
    const reopened = await (await restarted.settings(true)).json();
    assert.equal(reopened.token, enabled.token);
    assert.equal(reopened.url, enabled.url);
    assert.equal(saved.length, 1);
    const reset = await (await restarted.reset()).json();
    assert.equal(saved[1], reset.token);
});

test("端口占用明确报错，释放后可重试且不更换端口或令牌", async (t) => {
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, "127.0.0.1", resolve));
    t.after(() => { occupied.close(); });
    const address = occupied.address();
    assert.ok(address && typeof address !== "string");
    const fixture = await startFixture(t, undefined, { port: address.port, token: "persistent-token" });
    const response = await fixture.settings(true);
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, new RegExp(`${address.port}.*已被占用`));
    assert.equal((await (await fixture.settings()).json()).enabled, false);
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    const enabled = await (await fixture.settings(true)).json();
    assert.equal(enabled.url, `${fixture.mcpUrl}/mcp`);
    assert.equal(enabled.token, "persistent-token");
});

test("令牌保存失败保留旧凭据，串行处理并发开启与重置", async (t) => {
    let fail = true;
    const fixture = await startFixture(t, undefined, { token: "persistent-token", saveToken: () => { if (fail) throw new Error("配置写入失败"); } });
    const results = await Promise.all([fixture.settings(true), fixture.settings(true)]);
    assert.deepEqual(results.map((response) => response.status), [200, 200]);
    assert.equal((await fixture.reset()).status, 500);
    assert.equal((await fixture.rpc("tools/list", {}, "persistent-token")).status, 200);
    fail = false;
    const reset = await (await fixture.reset()).json();
    assert.notEqual(reset.token, "persistent-token");
    assert.equal((await fixture.rpc("tools/list", {}, "persistent-token")).status, 401);
    assert.equal((await fixture.rpc("tools/list", {}, reset.token)).status, 200);
});

test("默认外部地址固定为 17372，未开启不占用端口", async (t) => {
    const app = express();
    const external = createExternalMcp(async () => ({}));
    t.after(() => external.close());
    app.use(external.settings);
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    t.after(() => { server.close(); server.closeAllConnections(); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const status = await (await fetch(`http://127.0.0.1:${address.port}/agent/api/external-mcp`)).json();
    assert.deepEqual(status, { ok: true, enabled: false, url: "http://127.0.0.1:17372/mcp", token: "" });
});

async function startFixture(t: test.TestContext, session = new CanvasSession(), options: Parameters<typeof createExternalMcp>[1] = {}) {
    const app = express();
    app.use(express.json());
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    t.after(() => new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
        server.closeAllConnections();
    }));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const internalToken = "test-internal-token";
    const reservation = createServer();
    await new Promise<void>((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const reserved = reservation.address();
    assert.ok(reserved && typeof reserved !== "string");
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const externalPort = options.port ?? reserved.port;
    const mcpUrl = `http://127.0.0.1:${externalPort}`;
    const external = createExternalMcp((name, input) => session.callTool(name, input), { ...options, port: externalPort });
    t.after(() => external.close());
    app.use((req, res, next) => {
        if (req.headers["x-canvas-agent-token"] === internalToken) next();
        else res.status(401).json({ ok: false });
    });
    app.use(external.settings);
    return {
        url,
        mcpUrl,
        close: external.close,
        internalToken,
        reset: (token = internalToken) => fetch(`${url}/agent/api/external-mcp/reset-token`, { method: "POST", headers: { "x-canvas-agent-token": token } }),
        settings: (enabled?: unknown, token = internalToken) => fetch(`${url}/agent/api/external-mcp`, {
            method: enabled === undefined ? "GET" : "PUT",
            headers: { "Content-Type": "application/json", "x-canvas-agent-token": token },
            ...(enabled === undefined ? {} : { body: JSON.stringify({ enabled }) }),
        }),
        rpc: (method: string, params: unknown, token: string, headers: Record<string, string> = {}) => fetch(`${mcpUrl}/mcp`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}`, ...headers },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }),
    };
}
