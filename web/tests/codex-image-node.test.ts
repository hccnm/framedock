import "./browser-globals";
import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
const png = "data:image/png;base64,aW1hZ2U=";
let resolveRequest: (value: any) => void;
let calls: any[] = [];
let deletes: string[][] = [];
let imports = 0;
mock.module("../src/services/api/codex-image", () => ({ generateCodexNodeImage: (input: any, signal: AbortSignal) => {
    calls.push(input);
    return new Promise((resolve, reject) => { resolveRequest = resolve; signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }); });
} }));
mock.module("../src/services/image-storage", () => ({
    ensureImagePreview: async () => undefined,
    resolveImageUrl: async (_key: string, url: string) => url,
    imageToDataUrl: async (image: any) => image.dataUrl,
    uploadImage: async () => ({ storageKey: `image:out-${++imports}`, url: png, width: 1200, height: 800, bytes: 5, mimeType: "image/png" }),
    deleteStoredImages: async (keys: string[]) => { deletes.push(keys); },
}));
const { runCodexImageNode, cancelCodexImageNode, isCodexImageRunning, isCodexImageNode } = await import("../src/stores/canvas/use-codex-image-store");
const { useCanvasStore } = await import("../src/stores/canvas/use-canvas-store");
const { setCanvasProjectBridge } = await import("../src/lib/canvas/canvas-project-bridge");
const { registerNodeDefinitions } = await import("../src/lib/canvas/node-registry");
registerNodeDefinitions(["image", "text"].map(type => ({ type, title: type, icon: null, defaultSize: { width: 1, height: 1 }, resource: (node: any) => type === "image" ? { kind: "image", url: node.metadata.content } : { kind: "text", text: node.metadata.content } })) as never);
const node = (id: string, type: string, metadata: any) => ({ id, type, title: id, position: { x: 10, y: 20 }, width: 340, height: 200, metadata });
let canvas: any;
beforeEach(() => {
    calls = []; imports = 0; deletes = [];
    canvas = { nodes: [node("generator", "config", { generationMode: "image", imageChannel: "codex", prompt: "两人合影" }), node("reference", "image", { content: png }), node("script", "text", { content: "清晨的公园" })], connections: [{ id: "c1", fromNodeId: "reference", toNodeId: "generator" }, { id: "c2", fromNodeId: "script", toNodeId: "generator" }] };
    useCanvasStore.setState({ projects: [{ id: "p1", ...canvas, projectFolderId: null, title: "P1" }, { id: "p2", nodes: [], connections: [], projectFolderId: null, title: "P2" }] as never });
    setCanvasProjectBridge({ projectId: "p1", read: () => canvas, write: (update) => { canvas = update(canvas); } });
});
afterEach(() => { setCanvasProjectBridge(null); });
const sent = async () => { for (let i = 0; i < 20 && !calls.length; i++) await Promise.resolve(); expect(calls).toHaveLength(1); };
const finish = () => resolveRequest({ ...calls[0], threadId: "thread", turnId: "turn", images: [1, 1].map(() => ({ itemId: "item", dataUrl: png, revisedPrompt: "输出" })) });

test("Codex 渠道自动输入连线原图和文本；重复完成结果只导入一次", async () => {
    const task = runCodexImageNode("p1", "generator"); await sent();
    expect(calls[0].references).toEqual([{ name: "reference.png", dataUrl: png }]);
    expect(calls[0].prompt).toContain("清晨的公园");
    await runCodexImageNode("p1", "generator"); expect(calls).toHaveLength(1);
    finish(); await task;
    expect(imports).toBe(1); expect(canvas.nodes).toHaveLength(4);
    expect(canvas.nodes[0].metadata.codexImageRun.status).toBe("success");
    expect(canvas.nodes[3].width / canvas.nodes[3].height).toBe(1.5);
    expect(canvas.nodes[3].metadata.imageChannel).toBe("codex");
    expect(canvas.nodes[3].metadata.size).toBe("1200x800");
    expect(isCodexImageRunning("p1", "generator")).toBe(false);
});

test("生成中切换画布仍写回原项目，下一版排列在上一版右侧", async () => {
    const task = runCodexImageNode("p1", "generator"); await sent();
    useCanvasStore.getState().updateProject("p1", canvas);
    setCanvasProjectBridge({ projectId: "p2", read: () => ({ nodes: [], connections: [] }), write: () => { throw new Error("不能写入另一画布"); } });
    finish(); await task;
    const first = useCanvasStore.getState().projects.find(x => x.id === "p1")!;
    expect(first.nodes).toHaveLength(4); expect(useCanvasStore.getState().projects.find(x => x.id === "p2")!.nodes).toHaveLength(0);
    calls = []; const secondTask = runCodexImageNode("p1", "generator"); await sent(); finish(); await secondTask;
    const second = useCanvasStore.getState().projects.find(x => x.id === "p1")!;
    expect(second.nodes[4].position.x).toBeGreaterThan(second.nodes[3].position.x + second.nodes[3].width);
});

test("取消或删除节点后，迟到结果不插入画布", async () => {
    const task = runCodexImageNode("p1", "generator"); await sent(); cancelCodexImageNode("p1", "generator"); await task;
    expect(canvas.nodes[0].metadata.codexImageRun.status).toBe("cancelled"); expect(imports).toBe(0);
    calls = []; const deleted = runCodexImageNode("p1", "generator"); await sent(); canvas.nodes = canvas.nodes.filter((x: any) => x.id !== "generator"); finish(); await deleted;
    expect(imports).toBe(0); expect(canvas.nodes).toHaveLength(2);
});

test("拒绝其他任务结果，失败保留重试入口", async () => {
    const task = runCodexImageNode("p1", "generator"); await sent(); resolveRequest({ ...calls[0], requestId: "wrong", threadId: "t", turnId: "v", images: [{ itemId: "i", dataUrl: png }] }); await task;
    expect(canvas.nodes[0].metadata.codexImageRun.status).toBe("error"); expect(imports).toBe(0);
    expect(isCodexImageRunning("p1", "generator")).toBe(false);
});

test("API 渠道和非生图模式不调用 Codex", async () => {
    canvas.nodes[0].metadata.imageChannel = "api";
    await runCodexImageNode("p1", "generator");
    expect(calls).toHaveLength(0);
    canvas.nodes[0].metadata = { imageChannel: "codex", generationMode: "text" };
    expect(isCodexImageNode(canvas.nodes[0])).toBe(false);
    await runCodexImageNode("p1", "generator");
    expect(calls).toHaveLength(0);
});

test("Codex 渠道复用配置节点编排，保留实际提交提示词", async () => {
    canvas.nodes[0].metadata.composerContent = "旧草稿";
    const task = runCodexImageNode("p1", "generator", "新提示词 @[node:reference] @[node:script]");
    await sent();
    expect(calls[0].prompt).toContain("新提示词");
    expect(calls[0].prompt).toContain("清晨的公园");
    expect(calls[0].prompt).not.toContain("旧草稿");
    expect(calls[0].references).toHaveLength(1);
    finish(); await task;
});

test("图片节点的 Codex 渠道把当前图片作为参考图", async () => {
    canvas.nodes[0] = node("generator", "image", { imageChannel: "codex", content: png, composerContent: "换成夜景", size: "1536x1024", quality: "high", background: "transparent", count: 2 });
    const task = runCodexImageNode("p1", "generator"); await sent();
    expect(calls[0].references.map((image: any) => image.name)).toEqual(["generator.png", "reference.png"]);
    expect(calls[0].prompt).toContain("换成夜景");
    expect(calls[0].options).toEqual({ size: "1536x1024", quality: "high", background: "transparent", count: 2 });
    finish(); await task;
    expect(canvas.nodes[0].metadata.content).toBe(png);
});

test("运行中渠道被外部修改后不插入迟到结果", async () => {
    const task = runCodexImageNode("p1", "generator"); await sent();
    canvas.nodes[0].metadata.imageChannel = "api";
    finish(); await task;
    expect(imports).toBe(0);
    expect(canvas.nodes).toHaveLength(3);
});

afterAll(() => mock.restore());
