import { AlertCircle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useComfyUiStore } from "@/stores/use-comfyui-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { ComfyRunStatus } from "@/types/comfyui";

/** The node body stays a summary: mode, workflow, input count and run status. Controls live in the lower panel. */
export function ComfyNodeContent({ node, theme }: { node: CanvasNodeData; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    // Subscribing keeps the body correct when the workflow is renamed or deleted elsewhere.
    const workflow = useComfyUiStore((state) => state.workflows.find((item) => item.id === node.metadata?.comfyWorkflowId || item.aliasIds?.includes(node.metadata?.comfyWorkflowId || "")));
    const status: ComfyRunStatus = node.metadata?.comfyRunStatus || "idle";
    const mode = node.metadata?.comfyMode || "text";
    const outputCount = node.metadata?.comfyOutputNodeIds?.length || 0;

    return (
        <div className="pointer-events-none flex h-full w-full flex-col gap-1.5 p-3">
            <div className="flex items-center gap-1.5">
                <Sparkles className="size-3.5 shrink-0" style={{ color: theme.node.muted }} />
                <span className="truncate text-xs font-medium" style={{ color: theme.node.text }}>
                    {t(`canvas.comfyNode.presets.${mode}`)}
                </span>
                <span className="shrink-0 rounded-full px-1.5 py-px text-[10px]" style={{ border: `1px solid ${theme.node.stroke}`, color: theme.node.muted }}>
                    ComfyUI
                </span>
            </div>
            <div className="truncate text-[11px]" style={{ color: theme.node.muted }}>
                {workflow?.name || t("canvas.comfyNode.noWorkflow")}
            </div>
            <div className="flex items-center gap-1.5 text-[11px]" style={{ color: status === "error" ? theme.node.text : theme.node.muted }}>
                <StatusIcon status={status} color={theme.node.muted} />
                <span className="truncate">
                    {status === "success" && outputCount ? t("canvas.comfyNode.outputs", { count: outputCount }) : t(`comfyui.status.${status}`)}
                </span>
            </div>
        </div>
    );
}

function StatusIcon({ status, color }: { status: ComfyRunStatus; color: string }) {
    if (status === "uploading" || status === "queued" || status === "running" || status === "processing") return <Loader2 className="size-3 shrink-0 animate-spin" style={{ color }} />;
    if (status === "success") return <CheckCircle2 className="size-3 shrink-0" style={{ color }} />;
    if (status === "error") return <AlertCircle className="size-3 shrink-0" style={{ color }} />;
    return <span className="size-3 shrink-0 rounded-full border" style={{ borderColor: color }} />;
}
