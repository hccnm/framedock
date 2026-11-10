import "./browser-globals";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { normalizeConnection } from "../src/lib/canvas/canvas-node-geometry";
import { applyCanvasAgentOps } from "../src/lib/canvas/canvas-agent-ops";
import { buildComfyNodeMapping } from "../src/lib/comfyui/run";
import { getComfyInputPorts, getNodeInputAnchor } from "../src/lib/comfyui/ports";
import { useComfyUiStore } from "../src/stores/use-comfyui-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";
import type { ComfyWorkflow } from "../src/types/comfyui";

const original = useComfyUiStore.getState();
const workflow: ComfyWorkflow = {
    id: "ports", name: "具名输入", description: "", createdAt: "", updatedAt: "",
    workflow: { "1": { class_type: "CR Text", inputs: { text: "默认正向" } }, "2": { class_type: "CR Text", inputs: { text: "默认负向" } } },
    fields: [
        { id: "1:text", nodeId: "1", inputKey: "text", nodeTitle: "正向", label: "正向提示词", type: "textarea", enabled: true, order: 0, defaultValue: "默认正向" },
        { id: "2:text", nodeId: "2", inputKey: "text", nodeTitle: "负向", label: "负向提示词", type: "textarea", enabled: true, order: 1, defaultValue: "默认负向" },
        { id: "3:image", nodeId: "3", inputKey: "image", nodeTitle: "参考图", label: "参考图 1", type: "image", enabled: true, order: 2 },
        { id: "4:image", nodeId: "4", inputKey: "image", nodeTitle: "参考图", label: "参考图 2", type: "image", enabled: true, order: 3 },
        { id: "5:seed", nodeId: "5", inputKey: "seed", nodeTitle: "种子", label: "种子", type: "number", enabled: true, order: 4, defaultValue: 42 },
    ],
};
const node = (id: string, type: CanvasNodeType, content = id): CanvasNodeData => ({ id, type, width: 340, height: 240, position: { x: 200, y: 50 }, metadata: { content } });
const target: CanvasNodeData = { ...node("comfy", CanvasNodeType.ComfyUI), metadata: { comfyMode: "custom", comfyWorkflowId: workflow.id } };
const nodes = [node("positive", CanvasNodeType.Text), node("negative", CanvasNodeType.Text), node("image-1", CanvasNodeType.Image), node("image-2", CanvasNodeType.Image), target];
const edge = (fromNodeId: string, targetFieldId?: string): CanvasConnection => ({ id: `${fromNodeId}:${targetFieldId}`, fromNodeId, toNodeId: target.id, targetFieldId });
beforeEach(() => useComfyUiStore.setState({ hydrated: true, workflows: [structuredClone(workflow)] }));
afterEach(() => useComfyUiStore.setState(original));

test("正负提示词与多图按字段 ID 取值，重排字段或连线都不串位", () => {
    const edges = [edge("negative", "2:text"), edge("image-2", "4:image"), edge("positive", "1:text"), edge("image-1", "3:image")];
    for (const connections of [edges, [...edges].reverse()]) {
        const mapped = buildComfyNodeMapping(target, nodes, connections);
        expect(mapped.errors).toEqual([]);
        expect(mapped.mapping.find((item) => item.field.id === "1:text")?.value).toBe("positive");
        expect(mapped.mapping.find((item) => item.field.id === "2:text")?.value).toBe("negative");
        expect(mapped.mapping.find((item) => item.field.id === "3:image")?.resources[0].nodeId).toBe("image-1");
        expect(mapped.mapping.find((item) => item.field.id === "4:image")?.resources[0].nodeId).toBe("image-2");
        useComfyUiStore.setState({ workflows: [{ ...workflow, fields: workflow.fields.map((field) => ({ ...field, order: 10 - field.order })) }] });
    }
});

test("输入连接点类型、位置和反向拖线使用同一字段", () => {
    expect(getComfyInputPorts(target).map((port) => port.field.id)).toEqual(["1:text", "2:text", "3:image", "4:image"]);
    expect(getNodeInputAnchor(target, "2:text")).toEqual({ x: 200, y: 182 });
    const forward = normalizeConnection("negative", target.id, nodes, "source", "2:text");
    const reverse = normalizeConnection(target.id, "negative", nodes, "target", "2:text");
    expect(forward).toEqual({ fromNodeId: "negative", toNodeId: target.id, targetFieldId: "2:text" });
    expect(reverse).toEqual(forward);
    expect(normalizeConnection("positive", target.id, nodes, "source", "3:image")).toBeNull();
    expect(normalizeConnection("positive", target.id, nodes, "source")).toBeNull();
    expect(normalizeConnection("positive", target.id, nodes, "source", "5:seed")).toBeNull();
});

test("助手连线允许同一文本连接不同字段，去重按字段区分", () => {
    const snapshot = { projectId: "test", title: "test", nodes, connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
    const operations = ["1:text", "2:text", "1:text"].map((targetFieldId) => ({ type: "connect_nodes" as const, fromNodeId: "positive", toNodeId: target.id, targetFieldId }));
    const result = applyCanvasAgentOps(snapshot, operations);
    expect(result.connections).toHaveLength(2);
    expect(JSON.parse(JSON.stringify(result.connections)).map((item: CanvasConnection) => item.targetFieldId)).toEqual(["1:text", "2:text"]);
    expect(() => applyCanvasAgentOps(snapshot, [{ type: "connect_nodes", fromNodeId: "positive", toNodeId: target.id }])).toThrow("targetFieldId");
});

test("失效字段、错类型、未指定字段和媒体多源返回错误，不自动换到其他槽位", () => {
    for (const connections of [[edge("positive")], [edge("positive", "missing")], [edge("positive", "3:image")], [edge("image-1", "3:image"), edge("image-2", "3:image")]]) {
        expect(buildComfyNodeMapping(target, nodes, connections).errors.length).toBeGreaterThan(0);
    }
    useComfyUiStore.setState({ workflows: [{ ...workflow, fields: workflow.fields.map((field) => field.id === "2:text" ? { ...field, enabled: false } : field) }] });
    const result = buildComfyNodeMapping(target, nodes, [edge("negative", "2:text")]);
    expect(result.errors).toHaveLength(1);
    expect(result.mapping.find((item) => item.field.id === "1:text")?.value).toBe("默认正向");
});

test("多个文本只合并到指定入口，未连接字段保留参数", () => {
    const result = buildComfyNodeMapping(target, nodes, [edge("positive", "1:text"), edge("negative", "1:text")]);
    expect(result.errors).toEqual([]);
    expect(result.mapping.find((item) => item.field.id === "1:text")?.value).toBe("positive\n\nnegative");
    expect(result.mapping.find((item) => item.field.id === "2:text")?.value).toBe("默认负向");
});
