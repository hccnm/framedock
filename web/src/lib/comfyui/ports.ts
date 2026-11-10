import { getDirectUpstreamResources } from "@/lib/canvas/canvas-resource-references";
import { getComfyWorkflow } from "@/stores/use-comfyui-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import type { ComfyWorkflow, ComfyWorkflowField } from "@/types/comfyui";

export function comfyInputKind(field: ComfyWorkflowField) {
    if (field.type === "text" || field.type === "textarea") return "text";
    if (field.type === "image" || field.type === "video" || field.type === "audio") return field.type;
    return null;
}

export function getComfyInputPorts(node: CanvasNodeData, prepared?: Pick<ComfyWorkflow, "fields">) {
    if (node.type !== CanvasNodeType.ComfyUI) return [];
    return ((prepared || getComfyWorkflow(node.metadata?.comfyWorkflowId))?.fields || [])
        .filter((field) => field.enabled && comfyInputKind(field))
        .sort((a, b) => a.order - b.order)
        .map((field, index) => ({ field, kind: comfyInputKind(field)!, top: 104 + index * 28 }));
}

export function getNodeInputAnchor(node: CanvasNodeData, fieldId?: string) {
    const port = fieldId ? getComfyInputPorts(node).find((item) => item.field.id === fieldId) : undefined;
    return { x: node.position.x, y: node.position.y + (port?.top ?? node.height / 2) };
}

export function canConnectComfyField(source: CanvasNodeData, target: CanvasNodeData, fieldId: string | undefined, nodes: CanvasNodeData[]) {
    const port = getComfyInputPorts(target).find((item) => item.field.id === fieldId);
    if (!port) return false;
    const resources = getDirectUpstreamResources(target.id, nodes, [{ id: "check", fromNodeId: source.id, toNodeId: target.id }]);
    return resources.length > 0 && resources.every((resource) => resource.kind === port.kind) && (port.kind === "text" || resources.length === 1);
}
