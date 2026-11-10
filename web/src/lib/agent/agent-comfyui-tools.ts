import { nanoid } from "nanoid";

import { createCanvasNode } from "@/lib/canvas/canvas-node-factory";
import { readCanvasProject, updateCanvasProject } from "@/lib/canvas/canvas-project-bridge";
import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { buildComfyNodeMapping, isComfyRunActive, runComfyNode, updateComfyNode } from "@/lib/comfyui/run";
import { coerceFieldValue } from "@/lib/comfyui/mapping";
import { analyzeWorkflow, buildRunWorkflow, isMediaFieldType, parseWorkflowFile, workflowOutputKinds } from "@/lib/comfyui/workflow";
import { workbenchPromptField } from "@/lib/comfyui/workbench";
import { comfyInputKind } from "@/lib/comfyui/ports";
import { fetchComfyObjectInfo, describeComfyError } from "@/services/api/comfyui";
import { getComfyWorkflow, useComfyUiStore } from "@/stores/use-comfyui-store";
import { CanvasNodeType } from "@/types/canvas";
import type { ComfyWorkflow } from "@/types/comfyui";

type Input = Record<string, unknown>;
const busyStatuses = new Set(["uploading", "queued", "running", "processing"]);

function readyStore() {
    const state = useComfyUiStore.getState();
    if (!state.hydrated) throw new Error("工作流配置还在加载，请稍后重试");
    return state;
}

function requireWorkflow(id: unknown) {
    readyStore();
    const workflow = typeof id === "string" ? getComfyWorkflow(id) : undefined;
    if (!workflow) throw new Error("工作流不存在，请先调用 comfyui_list_workflows 获取真实 ID");
    return workflow;
}

function summary(workflow: ComfyWorkflow) {
    return { id: workflow.id, name: workflow.name, description: workflow.description, outputKinds: workflowOutputKinds(workflow), ...(workflow.executionBlockedReason ? { executionBlockedReason: workflow.executionBlockedReason } : {}) };
}

function workflowSearchText(value: string) {
    return value
        .normalize("NFKC")
        .toLowerCase()
        .replace(/[\s\p{Pd}_]+/gu, "");
}

export function listAgentComfyWorkflows(input: Input) {
    const state = readyStore();
    const keyword = workflowSearchText(String(input.keyword || ""));
    const workflows = state.workflows.filter(
        (workflow) => (!keyword || workflowSearchText(`${workflow.id} ${workflow.name} ${workflow.description}`).includes(keyword)) && (!input.outputKind || workflowOutputKinds(workflow).some((kind) => kind === input.outputKind)),
    );
    return { configured: Boolean(state.baseUrl), total: workflows.length, workflows: workflows.map(summary) };
}

export function getAgentComfyWorkflow(input: Input) {
    const workflow = requireWorkflow(input.workflowId);
    const fields = workflow.fields.filter((field) => field.enabled).sort((a, b) => a.order - b.order);
    return {
        ...summary(workflow),
        promptFieldId: workbenchPromptField(fields)?.id,
        fields,
        diagnostics: workflow.diagnostics || [],
        outputNodeIds: workflow.outputNodeIds,
        referenceGroups: workflow.referenceGroups || [],
        inputPorts: fields.filter((field) => comfyInputKind(field)).map((field) => ({ fieldId: field.id, label: field.label, kind: comfyInputKind(field) })),
        note: "values 使用字段 ID；inputs 用 [{fieldId,nodeId}] 将素材接到指定入口。",
    };
}

/** Register an API-format template without submitting it or changing existing workflows. */
export async function importAgentComfyWorkflow(input: Input) {
    const state = readyStore();
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || typeof input.workflowJson !== "string") throw new Error("请提供工作流名称及 API Format JSON");
    const workflow = parseWorkflowFile(input.workflowJson);
    const info = state.baseUrl
        ? await fetchComfyObjectInfo(
              state.baseUrl,
              Object.values(workflow).map((node) => node.class_type),
          ).catch(() => undefined)
        : undefined;
    const now = new Date().toISOString();
    const executionBlockedReason = typeof input.executionBlockedReason === "string" ? input.executionBlockedReason.trim() : "";
    const imported: ComfyWorkflow = { id: nanoid(), name, description: "", workflow, ...analyzeWorkflow(workflow, info), createdAt: now, updatedAt: now, ...(executionBlockedReason ? { executionBlockedReason } : {}) };
    state.addWorkflow(imported);
    return getAgentComfyWorkflow({ workflowId: imported.id });
}

/** Validate before changing the canvas, then use the same execution path as the ComfyUI panel. */
export function runAgentComfyWorkflow(input: Input, snapshot?: CanvasAgentSnapshot | null) {
    const workflow = requireWorkflow(input.workflowId);
    if (input.run !== false && workflow.executionBlockedReason) throw new Error(workflow.executionBlockedReason);
    const projectId = snapshot?.projectId;
    if (!projectId) throw new Error("请先打开目标画布");
    const project = readCanvasProject(projectId);
    if (!project) throw new Error("目标画布不存在");
    if (input.run !== false && !useComfyUiStore.getState().baseUrl) throw new Error("请先配置 ComfyUI 服务地址");
    const existing = input.nodeId ? project.nodes.find((node) => node.id === input.nodeId) : undefined;
    if (input.nodeId && existing?.type !== CanvasNodeType.ComfyUI) throw new Error("nodeId 必须是当前画布的 ComfyUI 节点");
    if (existing && (isComfyRunActive(existing.id) || busyStatuses.has(existing.metadata?.comfyRunStatus || ""))) throw new Error("工作流节点正在运行，请等待完成");

    const sameWorkflow = existing && getComfyWorkflow(existing.metadata?.comfyWorkflowId)?.id === workflow.id;
    const values = { ...(sameWorkflow ? existing.metadata?.comfyValues : {}), ...(input.values as Record<string, unknown>) };
    const randomEnabled = { ...(sameWorkflow ? existing.metadata?.comfyRandomEnabled : {}), ...(input.randomEnabled as Record<string, boolean>) };
    if (input.prompt !== undefined) {
        const field = workbenchPromptField(workflow.fields);
        if (!field) throw new Error("该工作流没有启用的提示词字段，请使用 values 指定参数");
        values[field.id] = input.prompt;
    }
    for (const [id, raw] of Object.entries(values)) {
        const field = workflow.fields.find((item) => item.enabled && item.id === id);
        if (!field || isMediaFieldType(field.type)) throw new Error(`不可设置的字段：${id}，媒体请使用 inputs`);
        const value = coerceFieldValue(field, raw);
        const numeric = field.type === "number" || field.type === "slider";
        const invalidNumber = numeric && (typeof value !== "number" || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max));
        const invalidBoolean = field.type === "boolean" && typeof raw !== "boolean";
        const invalidOption = field.type === "dropdown" && field.options?.length && !field.options.some((option) => option === value);
        if (invalidNumber || invalidBoolean || invalidOption) throw new Error(`无效参数：${field.label || id}`);
    }
    for (const id of Object.keys(randomEnabled)) {
        if (!workflow.fields.some((field) => field.enabled && field.id === id && (field.randomize !== undefined || field.presetRole === "seed"))) throw new Error(`字段不支持随机种子：${id}`);
    }

    const right = project.nodes.length ? Math.max(...project.nodes.map((node) => node.position.x + node.width)) + 80 : 0;
    const node = existing ? { ...existing, metadata: { ...existing.metadata } } : createCanvasNode(CanvasNodeType.ComfyUI, { x: right + 170, y: 120 });
    node.title = typeof input.title === "string" ? input.title : workflow.name;
    node.position = { x: typeof input.x === "number" ? input.x : node.position.x, y: typeof input.y === "number" ? input.y : node.position.y };
    node.metadata = { ...node.metadata, comfyMode: "custom", comfyWorkflowId: workflow.id, comfyValues: values, comfyRandomEnabled: randomEnabled, comfyRunStatus: "idle", comfyPromptId: "", comfyError: "", comfyOutputNodeIds: [] };
    const inputs = input.inputs as Array<{ nodeId: string; fieldId: string }> | undefined;
    for (const item of inputs || []) {
        const reference = project.nodes.find((node) => node.id === item.nodeId);
        if (!reference || item.nodeId === node.id || !["image", "video", "audio", "text", "group"].includes(reference.type)) throw new Error(`无效的画布参考素材：${item.nodeId}`);
    }
    const connections =
        inputs === undefined
            ? project.connections
            : [
                  ...project.connections.filter((connection) => connection.toNodeId !== node.id),
                  ...[...new Map(inputs.map((item) => [JSON.stringify([item.fieldId, item.nodeId]), item])).values()].map((item) => ({ id: nanoid(), fromNodeId: item.nodeId, toNodeId: node.id, targetFieldId: item.fieldId })),
              ];
    const nodes = [...project.nodes.filter((item) => item.id !== node.id), node];
    const { mapping, missing, errors } = buildComfyNodeMapping(node, nodes, connections);
    if (errors.length) throw new Error(errors.join("\n"));
    if (input.prompt !== undefined && mapping.some((item) => item.field.id === workbenchPromptField(workflow.fields)?.id && item.source === "upstream")) throw new Error("提示词被上游文本连接覆盖，请移除文本参考或省略 prompt 使用上游文本");
    if (input.run !== false) {
        if (missing.length) throw new Error(`缺少参考素材：${missing.map((item) => item.field.label || item.field.id).join("、")}`);
        // Validate variable reference graphs without uploading media or touching the saved template.
        buildRunWorkflow(workflow.workflow, workflow.fields, Object.fromEntries(mapping.filter((item) => item.source !== "missing").map((item) => [item.field.id, item.media ? "reference" : item.value])), workflow);
    }
    updateCanvasProject(projectId, () => ({ nodes, connections }));
    if (input.run !== false) {
        void runComfyNode(projectId, node.id).catch((error) => {
            updateComfyNode(projectId, node.id, { comfyRunStatus: "error", comfyError: describeComfyError(error) });
        });
    }
    return {
        ok: true,
        projectId,
        nodeId: node.id,
        workflowId: workflow.id,
        workflowName: workflow.name,
        run: input.run !== false,
        status: readCanvasProject(projectId)?.nodes.find((item) => item.id === node.id)?.metadata?.comfyRunStatus,
        note: input.run === false ? "已配置 ComfyUI 节点，尚未运行。" : "已启动工作流准备；尚未确认服务入队或生成成功，请用 generation_get_status 查询此 nodeId。",
    };
}
