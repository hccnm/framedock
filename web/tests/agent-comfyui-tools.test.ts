import "./browser-globals";
import nodeInfo from "./fixtures/comfy-node-info.json";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { getAgentComfyWorkflow, importAgentComfyWorkflow, listAgentComfyWorkflows, runAgentComfyWorkflow } from "../src/lib/agent/agent-comfyui-tools";
import { runComfyNode } from "../src/lib/comfyui/run";
import { runComfyTest } from "../src/lib/comfyui/test-run";
import { runSiteTool } from "../src/lib/agent/agent-site-tools";
import { isCanvasWriteTool, toolCallDetail } from "../src/components/agent/agent-event-formatters";
import { readCanvasProject, setCanvasProjectBridge, updateCanvasProject } from "../src/lib/canvas/canvas-project-bridge";
import type { CanvasAgentSnapshot } from "../src/lib/canvas/canvas-agent-ops";
import { isComfyRunActive } from "../src/lib/comfyui/run";
import { useCanvasStore } from "../src/stores/canvas/use-canvas-store";
import { useComfyUiStore } from "../src/stores/use-comfyui-store";
import { CanvasNodeType } from "../src/types/canvas";
import type { ComfyWorkflow } from "../src/types/comfyui";

const originalFetch = globalThis.fetch;
const originalCanvas = useCanvasStore.getState();
const originalComfy = useComfyUiStore.getState();
const workflow: ComfyWorkflow = {
    id: "custom-zimage",
    name: "图片生成-zimage",
    description: "自定义工作流",
    outputKinds: ["text"],
    createdAt: "",
    updatedAt: "",
    workflow: { "1": { class_type: "SaveText", inputs: { text: "默认提示词", seed: 42 } } },
    fields: [
        { id: "1:text", nodeId: "1", inputKey: "text", nodeTitle: "提示词", label: "提示词", type: "textarea", enabled: true, order: 0, defaultValue: "默认提示词", presetRole: "prompt" },
        { id: "1:seed", nodeId: "1", inputKey: "seed", nodeTitle: "种子", label: "种子", type: "number", enabled: true, order: 1, defaultValue: 42, randomize: true, min: 0, max: 1000 },
    ],
};
let snapshot: CanvasAgentSnapshot;
async function until(check: () => boolean) {
    const deadline = Date.now() + 1000;
    while (!check() && Date.now() < deadline) await Bun.sleep(1);
    expect(check()).toBe(true);
}
beforeEach(() => {
    setCanvasProjectBridge(null);
    useCanvasStore.setState({ hydrated: true, projects: [] });
    const projectId = useCanvasStore.getState().createProject("测试画布");
    snapshot = { projectId, title: "测试画布", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } };
    useComfyUiStore.setState({ hydrated: true, baseUrl: "http://comfy.test", workflows: [structuredClone(workflow)] });
});
afterEach(() => {
    globalThis.fetch = originalFetch;
    setCanvasProjectBridge(null);
    useCanvasStore.setState(originalCanvas);
    useComfyUiStore.setState(originalComfy);
});

test("发现真实工作流和启用字段，不暴露服务地址或原始图", async () => {
    const listed = await runSiteTool("comfyui_list_workflows", { keyword: "ZIMAGE", outputKind: "text" }, () => {});
    expect(listed).toEqual({ configured: true, total: 1, workflows: [{ id: workflow.id, name: workflow.name, description: workflow.description, outputKinds: ["text"] }] });
    expect(listAgentComfyWorkflows({ outputKind: "video" }).total).toBe(0);
    const details = getAgentComfyWorkflow({ workflowId: workflow.id });
    expect(details.promptFieldId).toBe("1:text");
    expect(details.fields).toHaveLength(2);
    expect(details).not.toHaveProperty("workflow");
    useComfyUiStore.setState({ hydrated: false });
    expect(() => listAgentComfyWorkflows({})).toThrow("加载");
});

test("追加导入 API 图并阻止草稿从各入口上传或运行", async () => {
    const graph = {
        "137": { class_type: "LoadImage", inputs: { image: "__REQUIRED_IMAGE__" } },
        "900": { class_type: "LoadAudio", inputs: { audio: "__REQUIRED_AUDIO__" } },
        "136": { class_type: "MiniMaxH3ReferenceToVideo", inputs: { "ref_images.ref_image_0": ["137", 0], "ref_audios.ref_audio_0": ["900", 0] } },
    };
    const reason = "项目尾帧门禁未接入";
    globalThis.fetch = (async () => Response.json(nodeInfo)) as typeof fetch;
    const imported = await importAgentComfyWorkflow({ name: "H3 参考草稿", workflowJson: JSON.stringify(graph), executionBlockedReason: reason });
    expect(imported.executionBlockedReason).toBe(reason);
    expect(imported.inputPorts.map((item) => item.fieldId)).toEqual(["137:image", "900:audio"]);
    expect(useComfyUiStore.getState().workflows).toHaveLength(2);
    expect(useComfyUiStore.getState().workflows.find((item) => item.id === workflow.id)).toEqual(workflow);
    const node = runAgentComfyWorkflow({ workflowId: imported.id, run: false }, snapshot);
    expect(() => runAgentComfyWorkflow({ workflowId: imported.id }, snapshot)).toThrow(reason);
    let requests = 0;
    globalThis.fetch = (async () => {
        requests += 1;
        throw new Error("不应请求网络");
    }) as typeof fetch;
    await expect(runComfyNode(snapshot.projectId, node.nodeId)).rejects.toThrow(reason);
    const saved = useComfyUiStore.getState().workflows.find((item) => item.id === imported.id)!;
    await expect(runComfyTest({ baseUrl: "http://comfy.test", workflow: saved, values: {}, media: {}, signal: new AbortController().signal, onProgress: () => {} })).rejects.toThrow(reason);
    expect(requests).toBe(0);
    expect(isCanvasWriteTool("comfyui_import_workflow")).toBe(true);
});

test("仅配置自定义节点，固定种子与提示词独立保存，允许复用节点", () => {
    const first = runAgentComfyWorkflow({ workflowId: workflow.id, prompt: "天宫", values: { "1:seed": 99 }, randomEnabled: { "1:seed": false }, run: false }, snapshot);
    expect(first.status).toBe("idle");
    const node = readCanvasProject(snapshot.projectId)!.nodes[0];
    expect(node.type).toBe("comfyui");
    expect(node.metadata).toMatchObject({ comfyMode: "custom", comfyWorkflowId: workflow.id, comfyValues: { "1:text": "天宫", "1:seed": 99 }, comfyRandomEnabled: { "1:seed": false } });
    const second = runAgentComfyWorkflow({ workflowId: workflow.id, nodeId: first.nodeId, prompt: "云海", run: false }, snapshot);
    expect(second.nodeId).toBe(first.nodeId);
    expect(readCanvasProject(snapshot.projectId)!.nodes).toHaveLength(1);
    expect(useComfyUiStore.getState().workflows[0]).toEqual(workflow);
    expect(isCanvasWriteTool("comfyui_run_workflow")).toBe(true);
    expect(isCanvasWriteTool("comfyui_list_workflows")).toBe(false);
    expect(JSON.stringify(toolCallDetail("comfyui_run_workflow", { workflowId: workflow.id, run: false }, "pending"))).toContain(workflow.id);
});

test("无效工作流、参数、种子与参考节点拒绝执行，不创建普通模型节点", () => {
    for (const input of [{ workflowId: "zimage" }, { values: { unknown: "x" } }, { values: { "1:seed": 1001 } }, { randomEnabled: { "1:text": true } }, { inputs: [{ nodeId: "missing", fieldId: "1:text" }] }]) {
        expect(() => runAgentComfyWorkflow({ workflowId: workflow.id, run: false, ...input }, snapshot)).toThrow();
        expect(readCanvasProject(snapshot.projectId)!.nodes).toHaveLength(0);
    }
    expect(() => runAgentComfyWorkflow({ workflowId: workflow.id })).toThrow("打开目标画布");
    useComfyUiStore.setState({ baseUrl: "" });
    expect(() => runAgentComfyWorkflow({ workflowId: workflow.id }, snapshot)).toThrow("服务地址");
});

test("校验媒体需求并按具名入口连接，拒绝上游文本覆盖显式提示词", () => {
    const media = { id: "2:image", nodeId: "2", inputKey: "image", nodeTitle: "图片", label: "参考图", type: "image" as const, enabled: true, order: 2 };
    useComfyUiStore.setState({ workflows: [{ ...workflow, fields: [...workflow.fields, media], workflow: { ...workflow.workflow, "2": { class_type: "LoadImage", inputs: { image: "default.png" } } } }] });
    expect(() => runAgentComfyWorkflow({ workflowId: workflow.id }, snapshot)).toThrow("缺少参考素材");
    const reference = { id: "ref", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "data:image/png;base64,AA==" } };
    updateCanvasProject(snapshot.projectId, () => ({ nodes: [reference], connections: [] }));
    const result = runAgentComfyWorkflow(
        {
            workflowId: workflow.id,
            inputs: [
                { nodeId: reference.id, fieldId: "2:image" },
                { nodeId: reference.id, fieldId: "2:image" },
            ],
            run: false,
        },
        snapshot,
    );
    expect(readCanvasProject(snapshot.projectId)!.connections).toMatchObject([{ fromNodeId: "ref", toNodeId: result.nodeId }]);
    updateCanvasProject(snapshot.projectId, (current) => ({ ...current, nodes: [...current.nodes, { ...reference, id: "text-ref", type: CanvasNodeType.Text, metadata: { content: "上游" } }] }));
    expect(() => runAgentComfyWorkflow({ workflowId: workflow.id, prompt: "新提示词", inputs: [{ nodeId: "text-ref", fieldId: "1:text" }], run: false }, snapshot)).toThrow("覆盖");
});

test("走真实执行器提交工作流并保存文本结果，任务状态可查询", async () => {
    let submitted: Record<string, any> | undefined;
    globalThis.fetch = (async (url, init) => {
        if (String(url).endsWith("/prompt")) {
            submitted = JSON.parse(String(init?.body)).prompt;
            return Response.json({ prompt_id: "prompt-123" });
        }
        if (String(url).endsWith("/history/prompt-123")) return Response.json({ "prompt-123": { status: { status_str: "success", completed: true }, outputs: { "1": { text: ["生成结果"] } } } });
        throw new Error(`意外请求：${url}`);
    }) as typeof fetch;
    const result = (await runSiteTool("comfyui_run_workflow", { workflowId: workflow.id, prompt: "天宫", values: { "1:seed": 99 }, randomEnabled: { "1:seed": false } }, () => {}, { canvasSnapshot: snapshot })) as ReturnType<typeof runAgentComfyWorkflow>;
    expect(result.status).toBe("uploading");
    expect(result.note).toContain("尚未确认");
    await until(() => !isComfyRunActive(result.nodeId));
    expect(submitted?.["1"].inputs).toEqual({ text: "天宫", seed: 99 });
    const project = readCanvasProject(snapshot.projectId)!;
    expect(project.nodes.find((node) => node.id === result.nodeId)?.metadata).toMatchObject({ comfyRunStatus: "success", comfyPromptId: "prompt-123" });
    expect(project.nodes.find((node) => node.type === "text")?.metadata?.content).toBe("生成结果");
    const status = await runSiteTool("generation_get_status", { scope: "canvas", nodeIds: [result.nodeId] }, () => {}, { canvasSnapshot: snapshot });
    expect(status).toMatchObject({ summary: { succeeded: 1 }, tasks: [{ id: result.nodeId, workflowId: workflow.id, promptId: "prompt-123", status: "succeeded", outputNodeIds: [expect.any(String)] }] });
});

test("助手按字段连接的正负提示词写入实际提交图，不受输入顺序影响", async () => {
    const negative = { ...workflow.fields[0], id: "2:text", nodeId: "2", label: "负向提示词", order: 1, presetRole: undefined };
    const configured = { ...workflow, fields: [...workflow.fields, negative], workflow: { ...workflow.workflow, "2": { class_type: "CR Text", inputs: { text: "默认负向" } } } };
    useComfyUiStore.setState({ workflows: [configured] });
    updateCanvasProject(snapshot.projectId, () => ({
        nodes: [
            { id: "pos", type: CanvasNodeType.Text, width: 100, height: 100, position: { x: 0, y: 0 }, metadata: { content: "上游正向" } },
            { id: "neg", type: CanvasNodeType.Text, width: 100, height: 100, position: { x: 0, y: 200 }, metadata: { content: "上游负向" } },
        ],
        connections: [],
    }));
    let graph: Record<string, any> = {};
    globalThis.fetch = (async (url, init) => {
        if (String(url).endsWith("/prompt")) {
            graph = JSON.parse(String(init?.body)).prompt;
            return Response.json({ prompt_id: "named-fields" });
        }
        if (String(url).endsWith("/history/named-fields")) return Response.json({ "named-fields": { status: { status_str: "success" }, outputs: { "1": { text: ["输出"] } } } });
        throw new Error(`意外请求：${url}`);
    }) as typeof fetch;
    const result = runAgentComfyWorkflow(
        {
            workflowId: workflow.id,
            inputs: [
                { nodeId: "neg", fieldId: "2:text" },
                { nodeId: "pos", fieldId: "1:text" },
            ],
        },
        snapshot,
    );
    await until(() => !isComfyRunActive(result.nodeId));
    expect(graph["1"].inputs.text).toBe("上游正向");
    expect(graph["2"].inputs.text).toBe("上游负向");
    expect(useComfyUiStore.getState().workflows[0]).toEqual(configured);
});

test("服务拒绝提交时记录错误，重入运行被拒绝", async () => {
    let rejectRequest: (value: Response) => void = () => {};
    globalThis.fetch = ((input: RequestInfo | URL) => {
        if (String(input).includes("/object_info/")) return Promise.reject(new Error("metadata unavailable"));
        return new Promise<Response>((resolve) => {
            rejectRequest = resolve;
        });
    }) as typeof fetch;
    const result = runAgentComfyWorkflow({ workflowId: workflow.id }, snapshot);
    expect(() => runAgentComfyWorkflow({ workflowId: workflow.id, nodeId: result.nodeId }, snapshot)).toThrow("正在运行");
    await until(() => readCanvasProject(snapshot.projectId)!.nodes[0].metadata?.comfyRunStatus === "queued");
    rejectRequest(Response.json({ error: { message: "invalid workflow" } }, { status: 400 }));
    await until(() => !isComfyRunActive(result.nodeId));
    const status = await runSiteTool("generation_get_status", { scope: "canvas", nodeIds: [result.nodeId] }, () => {}, { canvasSnapshot: snapshot });
    expect(status).toMatchObject({ summary: { failed: 1 }, tasks: [{ status: "failed", error: expect.stringContaining("invalid workflow") }] });
});

test("媒体参考经执行器上传后填入运行图，不改动原模板", async () => {
    const mediaWorkflow: ComfyWorkflow = {
        ...structuredClone(workflow),
        workflow: { ...workflow.workflow, "2": { class_type: "LoadImage", inputs: { image: "original.png" } } },
        fields: [...workflow.fields, { id: "2:image", nodeId: "2", inputKey: "image", nodeTitle: "参考图", label: "参考图", type: "image", enabled: true, order: 2 }],
    };
    useComfyUiStore.setState({ workflows: [mediaWorkflow] });
    updateCanvasProject(snapshot.projectId, () => ({ nodes: [{ id: "ref", type: CanvasNodeType.Image, title: "参考图", width: 100, height: 100, position: { x: 0, y: 0 }, metadata: { content: "data:image/png;base64,AA==" } }], connections: [] }));
    const requests: string[] = [];
    let uploadedName = "";
    globalThis.fetch = (async (url, init) => {
        const address = String(url);
        if (address.startsWith("data:")) return originalFetch(url, init);
        requests.push(address);
        if (address.endsWith("/upload/image")) {
            expect((init?.body as FormData).get("image")).toBeInstanceOf(File);
            return Response.json({ name: "uploaded.png", subfolder: "inputs" });
        }
        if (address.endsWith("/prompt")) {
            uploadedName = JSON.parse(String(init?.body)).prompt["2"].inputs.image;
            return Response.json({ prompt_id: "with-media" });
        }
        if (address.endsWith("/history/with-media")) return Response.json({ "with-media": { status: { status_str: "success" }, outputs: { "1": { text: ["输出"] } } } });
        throw new Error(`意外请求：${address}`);
    }) as typeof fetch;
    const result = runAgentComfyWorkflow({ workflowId: workflow.id, inputs: [{ nodeId: "ref", fieldId: "2:image" }] }, snapshot);
    await until(() => !isComfyRunActive(result.nodeId));
    expect(uploadedName).toBe("inputs/uploaded.png");
    expect(requests).toEqual(["http://comfy.test/object_info/SaveText", "http://comfy.test/object_info/LoadImage", "http://comfy.test/upload/image", "http://comfy.test/prompt", "http://comfy.test/history/with-media"]);
    expect(useComfyUiStore.getState().workflows[0].workflow["2"].inputs.image).toBe("original.png");
});

test("工作流生命周期统一映射为可查询状态", async () => {
    const result = runAgentComfyWorkflow({ workflowId: workflow.id, run: false }, snapshot);
    for (const [comfyRunStatus, status] of [
        ["idle", "idle"],
        ["uploading", "running"],
        ["queued", "queued"],
        ["running", "running"],
        ["processing", "running"],
        ["success", "succeeded"],
        ["error", "failed"],
    ] as const) {
        updateCanvasProject(snapshot.projectId, (current) => ({ ...current, nodes: current.nodes.map((node) => ({ ...node, metadata: { ...node.metadata, comfyRunStatus } })) }));
        const data = await runSiteTool("generation_get_status", { scope: "canvas", nodeIds: [result.nodeId] }, () => {}, { canvasSnapshot: snapshot });
        expect(data).toMatchObject({ total: 1, tasks: [{ id: result.nodeId, status }] });
    }
});

test("切换画布后后台写入仍属于原项目，不修改当前编辑器", () => {
    const secondId = useCanvasStore.getState().createProject("另一个画布");
    let writes = 0;
    setCanvasProjectBridge({
        projectId: secondId,
        read: () => ({ nodes: [], connections: [] }),
        write: () => {
            writes++;
        },
    });
    runAgentComfyWorkflow({ workflowId: workflow.id, run: false }, snapshot);
    expect(writes).toBe(0);
    expect(readCanvasProject(snapshot.projectId)!.nodes).toHaveLength(1);
    expect(readCanvasProject(secondId)!.nodes).toHaveLength(0);
});

test("工作流检索统一大小写、空白及连字符，仍按输出类型过滤", () => {
    useComfyUiStore.setState({ workflows: [{ ...workflow, id: "real-id", name: "角色生成-Z-Image", description: "" }] });
    for (const keyword of ["zimage", "Z Image", "Z_Image", "Ｚ－Ｉｍａｇｅ", "Z–Image"]) {
        expect(listAgentComfyWorkflows({ keyword }).workflows.map((item) => item.id)).toEqual(["real-id"]);
    }
    expect(listAgentComfyWorkflows({ keyword: "zimage", outputKind: "video" }).total).toBe(0);
    expect(listAgentComfyWorkflows({ keyword: "qwen" }).total).toBe(0);
});
