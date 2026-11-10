import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCanvasToolRequest } from "./operations.js";
import { parseToolInput } from "./tools.js";

function opsOf(name: Parameters<typeof buildCanvasToolRequest>[0], input: Record<string, unknown>) {
    const request = buildCanvasToolRequest(name, input, null);
    return (request.input as { ops: Array<Record<string, any>> }).ops;
}

test("named ComfyUI target fields survive tool validation and operation forwarding", () => {
    const connection = { fromNodeId: "negative", toNodeId: "comfy", targetFieldId: "228:text" };
    const input = parseToolInput("canvas_connect_nodes", { connections: [connection] });
    assert.deepEqual(opsOf("canvas_connect_nodes", input), [{ type: "connect_nodes", ...connection }]);
    assert.throws(() => parseToolInput("comfyui_run_workflow", { workflowId: "custom", inputs: [{ nodeId: "negative" }] }));
});

test("generation flow reuses referenced nodes when the prompt only mentions them", () => {
    const ops = opsOf("canvas_generate_image", { prompt: "@[node:text-1]", referenceNodeIds: ["text-1"], title: "Flow", autoRun: true });
    const addedTextNodes = ops.filter((op) => op.type === "add_node" && op.nodeType === "text");
    const config = ops.find((op) => op.type === "add_node" && op.nodeType === "config");
    const runs = ops.filter((op) => op.type === "run_generation");
    assert.equal(addedTextNodes.length, 0);
    assert.equal(ops.filter((op) => op.type === "connect_nodes" && op.fromNodeId === "text-1" && String(op.toNodeId).startsWith("config-")).length, 1);
    assert.match(String(config?.metadata?.prompt), /^@\[node:text-1\]$/);
    assert.equal(runs.length, 1);
});

test("generation flow still creates a prompt node for prose prompts", () => {
    const ops = opsOf("canvas_generate_image", { prompt: "a cat on a roof", referenceNodeIds: ["text-1"], autoRun: true });
    assert.equal(ops.filter((op) => op.type === "add_node" && op.nodeType === "text").length, 1);
    const config = ops.find((op) => op.type === "add_node" && op.nodeType === "config");
    assert.match(String(config?.metadata?.prompt), /@\[node:text-/);
});

test("Codex image channel survives MCP validation and forwarding", () => {
    const input = parseToolInput("canvas_create_node", { nodeType: "config", metadata: { generationMode: "image", imageChannel: "codex", prompt: "测试参考生图" } });
    const ops = opsOf("canvas_create_node", input);
    assert.equal(ops[0].nodeType, "config");
    assert.equal(ops[0].metadata.imageChannel, "codex");
    assert.equal(ops[0].metadata.prompt, "测试参考生图");
    assert.doesNotThrow(() => parseToolInput("canvas_apply_ops", { ops }));
});

test("image generation flow preserves Codex channel and supported image options", () => {
    const input = parseToolInput("canvas_generate_image", { prompt: "狐狸", imageChannel: "codex", background: "transparent", size: "1536x1024", quality: "high", count: 2 });
    const ops = opsOf("canvas_generate_image", input);
    const config = ops.find((op) => op.type === "add_node" && op.nodeType === "config");
    assert.equal(config?.metadata.imageChannel, "codex");
    assert.equal(config?.metadata.background, "transparent");
    assert.equal(config?.metadata.size, "1536x1024");
    assert.equal(config?.metadata.quality, "high");
    assert.equal(config?.metadata.count, 2);
    assert.ok(ops.some((op) => op.type === "run_generation" && op.nodeId === config?.id));
});
