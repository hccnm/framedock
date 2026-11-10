import assert from "node:assert/strict";
import fs from "node:fs/promises";

let requestId = 0;
async function rpc(method, params = {}) {
    const response = await fetch("http://127.0.0.1:17392/mcp", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: "Bearer video-frame-external-test" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }) });
    assert.equal(response.status, 200);
    return response.json();
}
async function tool(name, input = {}) {
    const response = await rpc("tools/call", { name, arguments: input });
    if (response.error || response.result?.isError) throw new Error(JSON.stringify(response.error || response.result));
    return JSON.parse(response.result.content[0].text);
}
await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "video-frame-check", version: "1" } });
const tools = await rpc("tools/list");
assert.ok(tools.result.tools.some((item) => item.name === "canvas_capture_video_frame"));
const initial = await tool("canvas_get_state");
assert.equal(initial.title, "MCP 视频截帧验收");
const input = { projectId: initial.projectId, nodeId: "video-frame-test" };
const frames = [];
for (const selection of [{ position: "first" }, { position: "last" }, { position: "current" }, { position: "time", time: 2.5 }, { position: "time", time: 0 }]) {
    const frame = await tool("canvas_capture_video_frame", { ...input, ...selection });
    assert.equal(frame.sourceNodeId, input.nodeId);
    assert.equal(frame.projectId, input.projectId);
    assert.equal(frame.width, 640);
    assert.equal(frame.height, 360);
    assert.ok(frame.storageKey.startsWith("image:"));
    if (selection.position === "time") assert.equal(frame.time, selection.time);
    if (selection.position === "first") assert.equal(frame.time, 0);
    if (selection.position === "last") assert.ok(frame.time > 5 && frame.time < 5.166667);
    if (selection.position === "current") assert.equal(frame.time, 1.5);
    frames.push({ ...selection, ...frame });
}
const after = await tool("canvas_get_state");
assert.equal(after.nodes.length, initial.nodes.length + frames.length);
for (const frame of frames) {
    const image = after.nodes.find((node) => node.id === frame.nodeId);
    assert.equal(image.type, "image");
    assert.equal(image.metadata.mimeType, "image/png");
    assert.equal(image.metadata.storageKey, frame.storageKey);
    assert.ok(after.connections.some((connection) => connection.fromNodeId === input.nodeId && connection.toNodeId === frame.nodeId));
}
for (const invalid of [{ projectId: "wrong-page", position: "first" }, { position: "time" }, { position: "time", time: -1 }, { position: "time", time: 100 }, { nodeId: frames[0].nodeId, position: "first" }]) {
    await assert.rejects(tool("canvas_capture_video_frame", { ...input, ...invalid }));
}
assert.equal((await tool("canvas_get_state")).nodes.length, after.nodes.length);
const configured = await tool("canvas_create_config_node", { title: "截帧引用测试", mode: "image", x: 950, y: 80 });
const config = configured.nodes.find((node) => node.title === "截帧引用测试");
assert.ok(config);
await tool("canvas_connect_nodes", { connections: [{ fromNodeId: frames[3].nodeId, toNodeId: config.id }] });
const connected = await tool("canvas_get_state");
assert.ok(connected.connections.some((connection) => connection.fromNodeId === frames[3].nodeId && connection.toNodeId === config.id));
const report = { projectId: input.projectId, frames, referenceTarget: config.id, invalidRequestsRejected: 5, nodeCount: connected.nodes.length, connectionCount: connected.connections.length };
await fs.writeFile(new URL("./results.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
