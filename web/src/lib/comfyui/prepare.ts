import { fetchComfyObjectInfo } from "@/services/api/comfyui";
import type { ComfyWorkflow } from "@/types/comfyui";
import { analyzeWorkflow, buildRunWorkflow, isMediaFieldType } from "./workflow";

/** Refresh protocol metadata, without replacing saved roles, values, IDs, or the source graph. */
export async function prepareComfyWorkflow(workflow: ComfyWorkflow, baseUrl: string): Promise<ComfyWorkflow> {
    let info;
    try {
        info = await fetchComfyObjectInfo(
            baseUrl,
            Object.values(workflow.workflow).map((node) => node.class_type),
        );
    } catch {
        const analyzed = analyzeWorkflow(workflow.workflow, undefined, workflow);
        return { ...workflow, ...analyzed, diagnostics: [...analyzed.diagnostics, { code: "metadata-unavailable", severity: "warning", message: "节点信息读取失败，使用已保存的工作流配置" }] };
    }
    return { ...workflow, ...analyzeWorkflow(workflow.workflow, info, workflow) };
}

/** Called before any upload; placeholder names here represent already selected local media only. */
export function preflightComfyRun(workflow: ComfyWorkflow, values: Record<string, unknown>, mediaFieldIds: string[] = []) {
    if (workflow.executionBlockedReason) throw new Error(workflow.executionBlockedReason);
    const selected = new Set([...mediaFieldIds, ...Object.keys(values).filter((id) => values[id] !== undefined && values[id] !== "")]);
    const missing = workflow.fields.filter((field) => field.enabled && isMediaFieldType(field.type) && !field.referenceInput && !selected.has(field.id));
    if (missing.length) throw new Error(`缺少媒体输入：${missing.map((field) => field.label || field.id).join("、")}`);
    const run = buildRunWorkflow(workflow.workflow, workflow.fields, { ...values, ...Object.fromEntries(mediaFieldIds.map((id) => [id, "selected-local-media"])) }, workflow);
    const missingNodes = workflow.diagnostics?.filter((issue) => issue.code === "missing-node" && issue.nodeId && run[issue.nodeId]);
    if (missingNodes?.length) throw new Error(missingNodes.map((issue) => issue.message).join("\n"));
    return run;
}
