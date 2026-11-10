import { useEffect, useMemo } from "react";
import { App, Button, Input, Select, Slider, Switch } from "antd";
import { Copy, ExternalLink, Loader2, LocateFixed, Play, RefreshCw, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { useCopyText } from "@/hooks/use-copy-text";
import { canvasThemes } from "@/lib/canvas-theme";
import type { ComfyFieldMapping } from "@/lib/comfyui/mapping";
import { buildComfyNodeMapping, cancelComfyRun, queryComfyPrompt, runComfyNode, updateComfyNode } from "@/lib/comfyui/run";
import { describeComfyError } from "@/services/api/comfyui";
import { coerceFieldValue } from "@/lib/comfyui/mapping";
import { COMFY_OUTPUT_LABELS, defaultFieldValue, isMediaFieldType, workflowOutputKinds } from "@/lib/comfyui/workflow";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useComfyUiStore } from "@/stores/use-comfyui-store";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { ComfyMode, ComfyWorkflowField } from "@/types/comfyui";

const EMPTY_LIST: never[] = [];
const MODES: ComfyMode[] = ["text", "enhance", "edit", "custom"];
const BUSY_STATUSES = ["uploading", "queued", "running", "processing"];

const stopPointer = (event: { stopPropagation: () => void }) => event.stopPropagation();

/** Lower panel for a ComfyUI node: mode, workflow, the effective input mapping, parameters and run state. */
export function CanvasComfyPanel({ node, projectId, onClose }: { node: CanvasNodeData; projectId: string; onClose: () => void }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const copyText = useCopyText();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const baseUrl = useComfyUiStore((state) => state.baseUrl);
    const presetWorkflowIds = useComfyUiStore((state) => state.presetWorkflowIds);
    const workflows = useComfyUiStore((state) => state.workflows);
    // Live canvas data keeps the mapping preview correct while connections change.
    const nodes = useCanvasStore((state) => state.projects.find((project) => project.id === projectId)?.nodes || EMPTY_LIST);
    const connections = useCanvasStore((state) => state.projects.find((project) => project.id === projectId)?.connections || EMPTY_LIST);

    const mode = node.metadata?.comfyMode || "text";
    const status = node.metadata?.comfyRunStatus || "idle";
    const busy = BUSY_STATUSES.includes(status);
    const resultNode = nodes.find((item) => node.metadata?.comfyOutputNodeIds?.includes(item.id));
    const values = node.metadata?.comfyValues || {};
    const boundWorkflowId = mode === "custom" ? node.metadata?.comfyWorkflowId : presetWorkflowIds[mode] || node.metadata?.comfyWorkflowId;
    const { workflow, mapping, missing, errors } = useMemo(() => buildComfyNodeMapping(node, nodes, connections), [node, nodes, connections, workflows]);

    // Preset modes keep the node pointed at their bound workflow, so runs and recovery resolve the same template.
    useEffect(() => {
        if (mode === "custom" || !presetWorkflowIds[mode] || node.metadata?.comfyWorkflowId === presetWorkflowIds[mode]) return;
        updateComfyNode(projectId, node.id, { comfyWorkflowId: presetWorkflowIds[mode] });
    }, [mode, node.id, node.metadata?.comfyWorkflowId, presetWorkflowIds, projectId]);

    const roleError = useMemo(() => {
        if (!workflow || mode === "custom") return "";
        const roles = new Set(workflow.fields.filter((field) => field.enabled && field.presetRole).map((field) => field.presetRole));
        if (mode === "text" && !roles.has("prompt")) return t("canvas.comfyNode.roleMissing.prompt");
        if (mode === "enhance" && !roles.has("image")) return t("canvas.comfyNode.roleMissing.image");
        if (mode === "edit" && (!roles.has("prompt") || !roles.has("image"))) return t("canvas.comfyNode.roleMissing.edit");
        return "";
    }, [mode, t, workflow]);

    const patch = (next: Partial<CanvasNodeMetadata>) => updateComfyNode(projectId, node.id, next);
    const setValue = (fieldId: string, value: unknown) => patch({ comfyValues: { ...values, [fieldId]: value } });
    const run = async () => {
        message.loading({ content: t("canvas.comfyNode.running"), key: node.id, duration: 0 });
        try {
            // The node prop is a snapshot from this render, so the count comes from the run itself.
            const summary = await runComfyNode(projectId, node.id);
            message.success({ content: t("canvas.comfyNode.outputs", { count: summary.nodeIds.length }), key: node.id });
        } catch (error) {
            message.error({ content: describeComfyError(error), key: node.id });
        }
    };
    const query = async () => {
        try {
            await queryComfyPrompt(projectId, node.id);
            message.success(t("comfyui.status.success"));
        } catch (error) {
            message.error(describeComfyError(error));
        }
    };

    const blockedReason = !workflow ? t("canvas.comfyNode.noWorkflow") : workflow.executionBlockedReason || errors.join("\n") || (!baseUrl ? t("canvas.comfyNode.notConfigured") : roleError || (missing.length ? t("canvas.comfyNode.missingInputs", { fields: missing.map((item) => fieldLabel(item.field)).join("、") }) : ""));

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                data-canvas-no-zoom
                className="space-y-3 rounded-2xl border p-3 shadow-2xl backdrop-blur"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onMouseDown={stopPointer}
                onPointerDown={stopPointer}
                onWheel={stopPointer}
            >
                <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-semibold">ComfyUI</div>
                    <Button type="text" size="small" icon={<X className="size-4" />} onClick={onClose} />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                    {MODES.map((item) => (
                        <button
                            key={item}
                            type="button"
                            disabled={busy}
                            aria-pressed={mode === item}
                            className="h-7 cursor-pointer rounded-full border px-2.5 text-xs transition hover:opacity-80"
                            style={{ background: "transparent", borderColor: mode === item ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                            onClick={() => patch({ comfyMode: item })}
                        >
                            {t(`canvas.comfyNode.presets.${item}`)}
                        </button>
                    ))}
                    <span className="ml-auto flex items-center gap-1.5 text-xs" style={{ color: theme.node.muted }}>
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                        {t(`comfyui.status.${status}`)}
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-xs" style={{ color: theme.node.muted }}>
                        {t("canvas.comfyNode.workflow")}
                    </span>
                    <Select
                        aria-label={t("canvas.comfyNode.workflow")}
                        size="small"
                        className="min-w-0 flex-1"
                        value={workflows.find((item) => item.id === boundWorkflowId || item.aliasIds?.includes(boundWorkflowId || ""))?.id || boundWorkflowId || undefined}
                        placeholder={t("canvas.comfyNode.pickWorkflow")}
                        options={workflows.map((item) => ({ value: item.id, label: `${item.name} · ${workflowOutputKinds(item).map((kind) => COMFY_OUTPUT_LABELS[kind]).join(" / ") || "未指定输出"}` }))}
                        onChange={(value) => patch({ comfyMode: "custom", comfyWorkflowId: value })}
                        disabled={busy}
                    />
                </div>

                <ComfyMappingList mapping={mapping} theme={theme} />
                <ComfyParameters fields={mapping.filter((item) => !isMediaFieldType(item.field.type))} values={values} theme={theme} onChange={setValue} />

                {blockedReason ? (
                    <div className="text-xs" style={{ color: theme.node.muted }}>
                        {blockedReason}
                    </div>
                ) : null}

                {status === "error" && node.metadata?.comfyError ? (
                    <div className="space-y-1.5 rounded-xl p-2 text-xs" style={{ background: theme.node.fill }}>
                        <div className="max-h-28 overflow-auto whitespace-pre-wrap break-words">{node.metadata.comfyError}</div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <Button type="text" size="small" icon={<Copy className="size-3.5" />} onClick={() => copyText(node.metadata?.comfyError || "")}>
                                {t("canvas.comfyNode.copyError")}
                            </Button>
                            {node.metadata?.comfyPromptId ? (
                                <Button type="text" size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => void query()}>
                                    {t("canvas.comfyNode.query")}
                                </Button>
                            ) : null}
                            <Button type="text" size="small" icon={<ExternalLink className="size-3.5" />} onClick={() => openConfigDialog(false, "comfyui")}>
                                {t("canvas.comfyNode.openSettings")}
                            </Button>
                        </div>
                    </div>
                ) : null}

                <div className="flex items-center gap-2">
                    {status === "success" && resultNode && <Button type="text" size="small" icon={<LocateFixed className="size-3.5" />} onClick={() => { onClose(); navigate(`/canvas/${encodeURIComponent(projectId)}?node=${encodeURIComponent(resultNode.id)}`); }}>查看本次结果</Button>}
                    {busy ? (
                        <Button danger size="small" icon={<Square className="size-3.5" />} onClick={() => cancelComfyRun(node.id)}>
                            {t("canvas.comfyNode.stop")}
                        </Button>
                    ) : (
                        <Button type="primary" size="small" icon={<Play className="size-3.5" />} disabled={Boolean(blockedReason)} onClick={() => void run()}>
                            {status === "error" ? t("canvas.comfyNode.retry") : t("canvas.comfyNode.run")}
                        </Button>
                    )}
                    {!baseUrl ? (
                        <Button type="text" size="small" icon={<ExternalLink className="size-3.5" />} onClick={() => openConfigDialog(false, "comfyui")}>
                            {t("canvas.comfyNode.openConfig")}
                        </Button>
                    ) : null}
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

/** Shows where every enabled field gets its value, so the mapping is visible before running. */
function ComfyMappingList({ mapping, theme }: { mapping: ComfyFieldMapping[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    if (!mapping.length) {
        return (
            <div className="text-xs" style={{ color: theme.node.muted }}>
                {t("canvas.comfyNode.noInputs")}
            </div>
        );
    }
    return (
        <div className="space-y-1">
            <div className="text-xs" style={{ color: theme.node.muted }}>
                {t("canvas.comfyNode.inputs")}
            </div>
            <div className="space-y-0.5 text-xs">
                {mapping.map((item) => (
                    <div key={item.field.id} className="flex items-center gap-1.5">
                        <span className="shrink-0" style={{ color: theme.node.muted }}>
                            {fieldLabel(item.field)}
                        </span>
                        <span className="truncate" style={{ color: item.source === "missing" ? theme.node.text : theme.node.muted }}>
                            {item.source === "upstream"
                                ? `← ${item.resources.map((reference) => reference.title || reference.label).join(" + ")}`
                                : item.source === "node"
                                  ? isMediaFieldType(item.field.type)
                                      ? `← ${item.media?.name || ""}`
                                      : `← ${t("canvas.comfyNode.params")}`
                                  : `← ${t("canvas.comfyNode.missingField", { field: fieldLabel(item.field) })}`}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function ComfyParameters({ fields, values, theme, onChange }: { fields: ComfyFieldMapping[]; values: Record<string, unknown>; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onChange: (fieldId: string, value: unknown) => void }) {
    const { t } = useTranslation();
    if (!fields.length) return null;
    return (
        <div className="space-y-1.5">
            <div className="text-xs" style={{ color: theme.node.muted }}>
                {t("canvas.comfyNode.params")}
            </div>
            {fields.map(({ field, source, value }) => (
                <label key={field.id} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-xs" style={{ color: theme.node.muted }} title={`${field.nodeTitle} · ${field.inputKey}`}>
                        {fieldLabel(field)}
                    </span>
                    <span className="min-w-0 flex-1">
                        {source === "upstream" ? <div className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words py-1 text-xs" style={{ color: theme.node.text }}>{String(value ?? "")}</div> : <ComfyFieldInput field={field} value={values[field.id] ?? defaultFieldValue(field)} onChange={(value) => onChange(field.id, value)} />}
                    </span>
                </label>
            ))}
        </div>
    );
}

function ComfyFieldInput({ field, value, onChange }: { field: ComfyWorkflowField; value: unknown; onChange: (value: unknown) => void }) {
    if (field.type === "boolean") return <Switch size="small" checked={Boolean(value)} onChange={(checked) => onChange(checked)} />;
    if (field.type === "dropdown") {
        return <Select size="small" className="w-full" value={value === "" ? undefined : (value as string)} options={(field.options || []).map((option) => ({ value: option, label: String(option) }))} onChange={(next) => onChange(coerceFieldValue(field, next))} />;
    }
    if (field.type === "slider") {
        const current = Number(value);
        const min = field.min ?? 0;
        const max = field.max ?? Math.max(min + 100, current || 100);
        return <Slider className="!mx-1" min={min} max={max} step={field.step || 1} value={Number.isFinite(current) ? current : min} onChange={(next) => onChange(next)} tooltip={{ open: false }} />;
    }
    if (field.type === "number") {
        return (
            <Input
                size="small"
                type="number"
                defaultValue={value === undefined || value === null ? "" : String(value)}
                key={`${field.id}-${String(value)}`}
                onBlur={(event) => onChange(coerceFieldValue(field, event.target.value))}
                onPressEnter={(event) => (event.target as HTMLInputElement).blur()}
            />
        );
    }
    if (field.type === "textarea") {
        return <Input.TextArea size="small" autoSize={{ minRows: 2, maxRows: 6 }} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
    }
    return <Input size="small" value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
}

function fieldLabel(field: ComfyWorkflowField) {
    return field.label || field.inputKey;
}
