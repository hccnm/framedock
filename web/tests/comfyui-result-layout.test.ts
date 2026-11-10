import "./browser-globals";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { queryComfyPrompt } from "../src/lib/comfyui/run";
import { setCanvasProjectBridge } from "../src/lib/canvas/canvas-project-bridge";
import { useComfyUiStore } from "../src/stores/use-comfyui-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const originalFetch = globalThis.fetch, originalComfy = useComfyUiStore.getState();
const source: CanvasNodeData = { id: "source", type: CanvasNodeType.ComfyUI, title: "本次生成", position: { x: 100, y: 200 }, width: 340, height: 384, metadata: { comfyMode: "custom", comfyWorkflowId: "layout", comfyPromptId: "layout-prompt" } };
let canvas: { nodes: CanvasNodeData[]; connections: any[] };
const obstacle = (id: string, x: number, y: number, width = 340, height = 240): CanvasNodeData => ({ ...source, id, type: CanvasNodeType.Text, position: { x, y }, width, height, metadata: {} });
beforeEach(() => {
    canvas = { nodes: [structuredClone(source)], connections: [] };
    setCanvasProjectBridge({ projectId: "layout-project", read: () => canvas, write: (update) => { canvas = update(canvas); } });
    useComfyUiStore.setState({ baseUrl: "http://comfy.test", workflows: [{ id: "layout", name: "布局验证", description: "", workflow: { out: { class_type: "SaveText", inputs: {} } }, fields: [], createdAt: "", updatedAt: "" }] });
    globalThis.fetch = (async () => Response.json({ "layout-prompt": { status: { status_str: "success" }, outputs: { out: { text: ["实际执行器输出"] } } } })) as typeof fetch;
});
afterEach(() => { setCanvasProjectBridge(null); globalThis.fetch = originalFetch; useComfyUiStore.setState(originalComfy); });
const generate = async () => {
    const result = await queryComfyPrompt("layout-project", source.id);
    return canvas.nodes.find((node) => node.id === result.nodeIds[0])!;
};

test("无关上下分镜和分组不把本次结果挤到整列最底部", async () => {
    canvas.nodes.push(obstacle("above", 480, -200), obstacle("below", 480, 18000), { ...obstacle("group", 0, 0, 3000, 20000), type: CanvasNodeType.Group });
    const result = await generate();
    expect(result.position).toEqual({ x: 480, y: 200 });
    expect(result.title).toContain(source.title);
});

test("后续生成版本沿源节点右侧水平排列", async () => {
    const first = await generate(), second = await generate();
    expect(second.position.y).toBe(source.position.y);
    expect(second.position.x).toBe(first.position.x + first.width + 40);
    expect(canvas.nodes[0].metadata?.comfyOutputNodeIds).toEqual([second.id]);
});

test("只避让实际矩形碰撞，并保留已有节点位置", async () => {
    const blocked = [obstacle("near", 480, 210, 200), obstacle("next", 730, 200, 100)];
    canvas.nodes.push(...blocked);
    const result = await generate();
    expect(result.position).toEqual({ x: 870, y: 200 });
    expect(canvas.nodes.slice(1, 3)).toEqual(blocked);
});
