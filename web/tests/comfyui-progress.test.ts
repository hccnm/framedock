import "./browser-globals";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { cancelComfyRun, resumeComfyNode, updateComfyNode } from "../src/lib/comfyui/run";
import { readCanvasProject, setCanvasProjectBridge } from "../src/lib/canvas/canvas-project-bridge";
import { useCanvasStore } from "../src/stores/canvas/use-canvas-store";
import { useComfyUiStore } from "../src/stores/use-comfyui-store";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";

const originalFetch = globalThis.fetch;
const originalCanvas = useCanvasStore.getState();
const originalComfy = useComfyUiStore.getState();
const projectId = "progress-project", nodeId = "progress-node", promptId = "progress-prompt";
let canvas: { nodes: CanvasNodeData[]; connections: [] };
let writes: string[];
beforeEach(() => {
    writes = [];
    canvas = { nodes: [{ id: nodeId, type: CanvasNodeType.ComfyUI, title: "运行中", position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { comfyRunStatus: "running", comfyPromptId: promptId } }, { id: "reference", type: CanvasNodeType.Image, title: "参考图", position: { x: -400, y: 0 }, width: 100, height: 100 }], connections: [] };
    setCanvasProjectBridge({ projectId, read: () => canvas, write: (update) => { canvas = update(canvas) as typeof canvas; writes.push(canvas.nodes[0].metadata!.comfyRunStatus!); } });
    useComfyUiStore.setState({ baseUrl: "http://comfy.test", pollIntervalSeconds: 1 });
});
afterEach(() => {
    cancelComfyRun(nodeId);
    setCanvasProjectBridge(null);
    globalThis.fetch = originalFetch;
    useCanvasStore.setState(originalCanvas);
    useComfyUiStore.setState(originalComfy);
});

test("相同状态不写入画布；真实状态变化仅替换目标节点", () => {
    const previous = canvas;
    updateComfyNode(projectId, nodeId, { comfyRunStatus: "running" });
    expect(writes).toHaveLength(0);
    expect(canvas).toBe(previous);
    updateComfyNode(projectId, nodeId, { comfyRunStatus: "queued" });
    expect(writes).toEqual(["queued"]);
    expect(canvas.nodes[0]).not.toBe(previous.nodes[0]);
    expect(canvas.nodes[1]).toBe(previous.nodes[1]);
    expect(canvas.connections).toBe(previous.connections);
});

test("后台项目的相同状态不触发持久化 store 更新", () => {
    setCanvasProjectBridge(null);
    useCanvasStore.setState({ projects: [{ id: projectId, ...canvas } as never] });
    const before = useCanvasStore.getState().projects;
    updateComfyNode(projectId, nodeId, { comfyRunStatus: "running" });
    expect(useCanvasStore.getState().projects).toBe(before);
});

test("真实轮询链路中重复 running 与队列查询失败都不改变节点", async () => {
    const previous = canvas;
    let queues = 0;
    globalThis.fetch = (async (url) => {
        if (String(url).includes("/history/")) return Response.json({});
        if (String(url).endsWith("/queue")) {
            queues += 1;
            if (queues === 3) return Response.json({ error: "临时不可用" }, { status: 503 });
            if (queues === 4) cancelComfyRun(nodeId);
            return Response.json({ queue_running: [[0, promptId]] });
        }
        throw new Error(`意外请求：${url}`);
    }) as typeof fetch;
    await resumeComfyNode(projectId, nodeId);
    expect(queues).toBe(4);
    expect(writes).toEqual([]);
    expect(readCanvasProject(projectId)).toBe(previous);
});
