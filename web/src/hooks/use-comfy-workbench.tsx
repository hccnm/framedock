import { useEffect, useState } from "react";
import { Button, Input, InputNumber, Select, Slider, Switch } from "antd";
import { Link } from "react-router";

import { ComfyWorkflowEditor } from "@/components/layout/comfy-workflow-editor";
import { runComfyTest } from "@/lib/comfyui/test-run";
import type { ComfyMediaValue } from "@/lib/comfyui/mapping";
import { prepareWorkbenchRun, workbenchPromptField } from "@/lib/comfyui/workbench";
import { configuredReferenceGroups } from "@/lib/comfyui/references";
import { defaultFieldValue, isMediaFieldType, analyzeWorkflow, workflowOutputKinds } from "@/lib/comfyui/workflow";
import { useComfyUiStore } from "@/stores/use-comfyui-store";
import { useWorkbenchDraftField } from "@/stores/use-workbench-draft-store";
import { describeComfyError, fetchComfyObjectInfo } from "@/services/api/comfyui";
import type { ReferenceImage } from "@/types/image";
import type { ComfyWorkflowField } from "@/types/comfyui";

export type ComfyWorkbenchSnapshot = {
    workflowId: string;
    values: Record<string, unknown>;
    promptFieldId: string;
    referenceCount?: number;
    randomEnabled?: Record<string, boolean>;
    referenceIds?: Record<string, string>;
    media?: Record<string, ComfyMediaValue>;
};

const fieldSource = (field: ComfyWorkflowField) => `${field.nodeTitle} · ${field.inputKey} · #${field.nodeId}`;

export function useComfyWorkbench(references: ReferenceImage[], prompt: string, setPrompt: (value: string) => void, outputKind: "image" | "video") {
    const allWorkflows = useComfyUiStore((state) => state.workflows);
    const workflows = allWorkflows.filter((workflow) => workflowOutputKinds(workflow).includes(outputKind));
    const baseUrl = useComfyUiStore((state) => state.baseUrl);
    const updateWorkflow = useComfyUiStore((state) => state.updateWorkflow);
    const [method, setMethod] = useWorkbenchDraftField(outputKind, "method");
    const [progress, setProgress] = useState("");
    const [editing, setEditing] = useState(false);
    const [selection, setSelection] = useWorkbenchDraftField(outputKind, "selection");
    const [uploadedMedia, setMedia] = useWorkbenchDraftField(outputKind, "uploadedMedia");
    const workflow = workflows.find((item) => item.id === selection.workflowId || item.aliasIds?.includes(selection.workflowId));
    const [definitionStatus, setDefinitionStatus] = useState("");
    const [refreshDefinitions, setRefreshDefinitions] = useState(0);
    const workflowId = workflow?.id;
    useEffect(() => {
        if (method !== "comfyui" || !workflowId || !baseUrl.trim()) return;
        let cancelled = false;
        const current = useComfyUiStore.getState().workflows.find((item) => item.id === workflowId)!;
        setDefinitionStatus("正在读取 ComfyUI 参数选项…");
        void fetchComfyObjectInfo(
            baseUrl,
            Object.values(current.workflow).map((node) => node.class_type),
        )
            .then((info) => {
                if (cancelled) return;
                const latest = useComfyUiStore.getState().workflows.find((item) => item.id === workflowId);
                if (latest) updateWorkflow(workflowId, analyzeWorkflow(latest.workflow, info, latest));
                setDefinitionStatus("");
            })
            .catch((error) => {
                if (!cancelled) setDefinitionStatus(`参数选项读取失败：${describeComfyError(error)} 暂用已保存的参数，可点击刷新重试。`);
            });
        return () => {
            cancelled = true;
        };
    }, [method, workflowId, baseUrl, refreshDefinitions, updateWorkflow]);
    const fields = workflow?.fields.filter((field) => field.enabled).sort((a, b) => a.order - b.order) || [];
    const imageFields = fields.filter((field) => field.type === "image");
    const groups = workflow?.referenceGroups ?? configuredReferenceGroups(workflow?.fields || []);
    const imageGroups = groups.filter((group) => group.kind === "dynamic" && group.bindings.some((binding) => binding.fieldIds.some((id) => imageFields.some((field) => field.id === id))));
    // A single count selector is only meaningful for one homogeneous dynamic input group.
    const countedIds = imageGroups.length === 1 ? new Set(imageGroups[0].bindings.flatMap((binding) => binding.fieldIds)) : new Set<string>();
    const dynamicImages = imageFields.filter((field) => countedIds.has(field.id));
    const minimumReferences = imageGroups.length === 1 ? imageGroups[0].min : 0;
    const referenceCount = Math.max(minimumReferences, Math.min(selection.referenceCount ?? Math.max(minimumReferences, references.length), dynamicImages.length));
    const activeDynamicImages = dynamicImages.slice(0, referenceCount);
    const media = Object.fromEntries(Object.entries(uploadedMedia).filter(([id]) => !dynamicImages.some((field) => field.id === id) || activeDynamicImages.some((field) => field.id === id)));
    if (dynamicImages.length)
        activeDynamicImages.forEach((field, index) => {
            const reference = references[index];
            if (!media[field.id] && reference) media[field.id] = { name: reference.name, url: reference.dataUrl, storageKey: reference.storageKey };
        });
    if (imageFields.length === 1 && references.length === 1 && !media[imageFields[0].id]) media[imageFields[0].id] = { name: references[0].name, url: references[0].dataUrl };
    const promptField = workbenchPromptField(fields, selection.promptFieldId);
    const promptFieldId = promptField?.id || "";
    const usesTemplatePrompt = !promptField;
    const reset = () => {
        setSelection((current) => ({ ...current, values: {}, randomEnabled: undefined }));
        setPrompt(promptField ? String(defaultFieldValue(promptField)) : "");
    };
    const snapshot: ComfyWorkbenchSnapshot = {
        ...selection,
        promptFieldId,
        referenceCount: dynamicImages.length ? referenceCount : undefined,
        values: Object.fromEntries(fields.filter((field) => !isMediaFieldType(field.type)).map((field) => [field.id, field.id === promptFieldId ? prompt : (selection.values[field.id] ?? defaultFieldValue(field))])),
        randomEnabled: Object.fromEntries(fields.filter((field) => field.type === "number" || field.type === "slider").map((field) => [field.id, selection.randomEnabled?.[field.id] ?? Boolean(field.randomize)])),
        media: Object.fromEntries(Object.entries(media).filter(([, value]) => value.blob)),
        referenceIds: Object.fromEntries(
            fields.flatMap((field) => {
                const reference = references.find((item) => item.dataUrl === media[field.id]?.url);
                return reference ? [[field.id, reference.id]] : [];
            }),
        ),
    };
    const setValue = (id: string, value: unknown) => setSelection((current) => ({ ...current, values: { ...current.values, [id]: value } }));
    const restore = (saved?: ComfyWorkbenchSnapshot, savedReferences: ReferenceImage[] = []) => {
        setMethod(saved ? "comfyui" : "api");
        if (saved) {
            setSelection(saved);
            setMedia({
                ...saved.media,
                ...Object.fromEntries(
                    Object.entries(saved.referenceIds || {}).flatMap(([fieldId, id]) => {
                        const reference = savedReferences.find((item) => item.id === id);
                        return reference ? [[fieldId, { name: reference.name, url: reference.dataUrl, storageKey: reference.storageKey }]] : [];
                    }),
                ),
            });
        }
    };
    const validate = () => {
        if (!baseUrl.trim()) throw new Error("请先在工作流页配置 ComfyUI 服务地址");
        if (!workflow) throw new Error("请选择 ComfyUI 工作流；没有模板时请前往工作流页配置");
        if (fields.some((field) => field.type === "image" && media[field.id]?.url && !references.some((reference) => reference.dataUrl === media[field.id].url))) throw new Error("已选择的参考图已移除，请重新分配工作流输入");
        const unused = references.filter((reference) => !fields.some((field) => field.type === "image" && media[field.id]?.url === reference.dataUrl));
        if (unused.length) throw new Error(`有 ${unused.length} 张参考图未分配到工作流输入，请分配或移除后再生成`);
        const missing = fields.filter((field) => isMediaFieldType(field.type) && !field.referenceInput && !media[field.id]);
        if (minimumReferences && !dynamicImages.some((field) => media[field.id])) throw new Error("请至少选择一张参考图");
        if (missing.length) throw new Error(`请选择媒体输入：${missing.map((field) => field.label || field.inputKey).join("、")}`);
    };
    const run = async (text: string) => {
        validate();
        if (!usesTemplatePrompt && !text.trim()) throw new Error("请填写提示词");
        const prepared = prepareWorkbenchRun(workflow!, snapshot.values, snapshot.randomEnabled || {}, promptFieldId, text);
        try {
            return await runComfyTest({ baseUrl, ...prepared, media: { ...media }, signal: new AbortController().signal, onProgress: setProgress });
        } finally {
            setProgress("");
        }
    };
    const settings = (
        <div className="space-y-3">
            <label className="block space-y-1">
                <span className="text-sm font-semibold">生成方式</span>
                <Select
                    className="w-full"
                    aria-label="生成方式"
                    value={method}
                    onChange={setMethod}
                    options={[
                        { value: "api", label: "API 模型" },
                        { value: "comfyui", label: "ComfyUI" },
                    ]}
                />
            </label>
            {method === "comfyui" ? (
                <>
                    {progress ? (
                        <div role="status" className="text-sm text-stone-500">
                            {({ uploading: "上传输入中", queued: "排队中", running: "执行中", processing: "保存结果中" } as Record<string, string>)[progress]}
                        </div>
                    ) : null}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold">工作流</span>
                            <Button size="small" type="text" disabled={!workflow} onClick={() => setEditing(true)}>
                                配置参数
                            </Button>
                        </div>
                        <Select
                            className="w-full"
                            aria-label="工作流"
                            placeholder="选择已配置工作流"
                            value={workflow?.id || selection.workflowId || undefined}
                            onChange={(workflowId) => {
                                setSelection({ workflowId, values: {}, promptFieldId: "" });
                                setMedia({});
                                const next = workflows.find((item) => item.id === workflowId);
                                const field = workbenchPromptField(next?.fields || []);
                                setPrompt(field ? String(defaultFieldValue(field)) : "");
                            }}
                            options={workflows.map((item) => ({ value: item.id, label: item.name }))}
                        />
                        {workflow ? (
                            <div className="space-y-1 text-xs text-stone-500">
                                {workflow.description ? <p>{workflow.description}</p> : null}
                                <p>本次调整不修改模板；更多字段可在「配置参数」中启用。</p>
                            </div>
                        ) : null}
                    </div>
                    {workflow ? (
                        <div className="space-y-1">
                            <Button size="small" type="text" onClick={() => setRefreshDefinitions((value) => value + 1)}>
                                刷新参数选项
                            </Button>
                            {definitionStatus ? (
                                <p role="status" className="text-xs text-stone-500">
                                    {definitionStatus}
                                </p>
                            ) : null}
                        </div>
                    ) : null}
                    {!workflows.length || !baseUrl.trim() ? (
                        <div className="text-sm">
                            {!workflows.length ? "尚未配置匹配当前输出类型的工作流。" : "尚未配置 ComfyUI 服务地址。"}
                            <Link to="/workflows">前往工作流页配置</Link>
                        </div>
                    ) : null}
                    {promptField ? (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-sm font-semibold">提示词</span>
                                <Button size="small" type="text" aria-label="重置工作流参数" onClick={reset}>
                                    重置
                                </Button>
                            </div>
                            <Input.TextArea aria-label="工作流提示词" rows={7} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
                        </div>
                    ) : workflow ? (
                        <Button size="small" type="text" aria-label="重置工作流参数" onClick={reset}>
                            重置
                        </Button>
                    ) : null}
                    {dynamicImages.length ? (
                        <label className="block space-y-1">
                            <span className="text-sm font-semibold">参考图数量</span>
                            <Select
                                className="w-full"
                                aria-label="参考图数量"
                                value={referenceCount}
                                options={Array.from({ length: dynamicImages.length - minimumReferences + 1 }, (_, index) => ({ value: index + minimumReferences, label: `${index + minimumReferences} 张` }))}
                                onChange={(referenceCount) => setSelection((current) => ({ ...current, referenceCount }))}
                            />
                        </label>
                    ) : null}
                    {[true, false].map((mediaGroup) => {
                        const controls = fields
                            .filter((field) => field.id !== promptFieldId && isMediaFieldType(field.type) === mediaGroup && (!countedIds.has(field.id) || activeDynamicImages.some((active) => active.id === field.id)))
                            .map((field) => {
                                const value = selection.values[field.id] ?? defaultFieldValue(field);
                                const numeric = field.type === "number" || field.type === "slider";
                                const canRandomize = numeric && (field.randomize !== undefined || field.presetRole === "seed");
                                const randomized = snapshot.randomEnabled?.[field.id];
                                return (
                                    <div key={field.id} className="space-y-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="text-sm">{field.label || field.inputKey}</span>
                                            {canRandomize ? (
                                                <label className="flex items-center gap-2 text-xs">
                                                    <Switch
                                                        size="small"
                                                        aria-label={`${field.label || field.inputKey} 随机`}
                                                        checked={randomized}
                                                        onChange={(next) => setSelection((current) => ({ ...current, randomEnabled: { ...current.randomEnabled, [field.id]: next } }))}
                                                    />
                                                    每次随机
                                                </label>
                                            ) : null}
                                        </div>
                                        <div className="truncate text-xs text-stone-500" title={fieldSource(field)}>
                                            {fieldSource(field)}
                                        </div>
                                        {isMediaFieldType(field.type) ? (
                                            <div className="space-y-1">
                                                {field.type === "image" ? (
                                                    <Select
                                                        className="w-full"
                                                        aria-label={field.label || field.inputKey}
                                                        placeholder={field.referenceInput ? "可选；不选则不提交此参考图" : "选择参考图"}
                                                        value={references.find((item) => item.dataUrl === media[field.id]?.url)?.id}
                                                        options={references.map((item, index) => ({ value: item.id, label: `${index + 1}. ${item.name}` }))}
                                                        onChange={(id) => {
                                                            const item = references.find((ref) => ref.id === id)!;
                                                            setMedia((current) => ({ ...current, [field.id]: { name: item.name, url: item.dataUrl, storageKey: item.storageKey } }));
                                                        }}
                                                    />
                                                ) : null}
                                                <input
                                                    type="file"
                                                    aria-label={`上传${field.label || field.inputKey}`}
                                                    accept={`${field.type}/*`}
                                                    onChange={(event) => {
                                                        const file = event.target.files?.[0];
                                                        if (file) setMedia((current) => ({ ...current, [field.id]: { name: file.name, blob: file } }));
                                                        event.target.value = "";
                                                    }}
                                                />
                                                {media[field.id] ? (
                                                    <div className="text-xs text-stone-500">
                                                        已选择：{media[field.id].name}
                                                        {field.type !== "image" ? (
                                                            <Button
                                                                size="small"
                                                                type="text"
                                                                aria-label={`移除${field.label || field.inputKey}`}
                                                                onClick={() =>
                                                                    setMedia((current) => {
                                                                        const next = { ...current };
                                                                        delete next[field.id];
                                                                        return next;
                                                                    })
                                                                }
                                                            >
                                                                移除
                                                            </Button>
                                                        ) : null}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : field.type === "boolean" ? (
                                            <Switch aria-label={field.label || field.inputKey} className="block" checked={Boolean(value)} onChange={(next) => setValue(field.id, next)} />
                                        ) : numeric ? (
                                            <div>
                                                {field.type === "slider" && field.min !== undefined && field.max !== undefined ? (
                                                    <Slider aria-label={`${field.label || field.inputKey} 滑块`} min={field.min} max={field.max} step={field.step} value={Number(value)} onChange={(next) => setValue(field.id, next)} />
                                                ) : null}
                                                <InputNumber
                                                    aria-label={field.label || field.inputKey}
                                                    className="!w-full"
                                                    disabled={randomized}
                                                    placeholder={randomized ? "生成时自动随机" : undefined}
                                                    value={randomized || value === "" ? null : Number(value)}
                                                    min={field.min}
                                                    max={field.max}
                                                    step={field.step}
                                                    onChange={(next) => setValue(field.id, next ?? "")}
                                                />
                                            </div>
                                        ) : field.type === "dropdown" ? (
                                            <Select
                                                aria-label={field.label || field.inputKey}
                                                className="w-full"
                                                value={value as string | number}
                                                options={field.options?.map((option) => ({ value: option, label: String(option) }))}
                                                onChange={(next) => setValue(field.id, next)}
                                            />
                                        ) : (
                                            <Input.TextArea aria-label={field.label || field.inputKey} rows={field.type === "textarea" ? 3 : 1} value={String(value)} onChange={(event) => setValue(field.id, event.target.value)} />
                                        )}
                                    </div>
                                );
                            });
                        return controls.length ? (
                            mediaGroup ? (
                                <div key="media" className="space-y-3">
                                    {controls}
                                </div>
                            ) : (
                                <details key={workflow?.id} className="space-y-3">
                                    <summary className="cursor-pointer text-sm font-semibold">生成参数（可选）</summary>
                                    {controls}
                                </details>
                            )
                        ) : null;
                    })}
                </>
            ) : null}
        </div>
    );
    const editor =
        editing && workflow ? (
            <ComfyWorkflowEditor
                key={workflow.id}
                workflow={workflow}
                onClose={() => setEditing(false)}
                onSave={(saved) => {
                    updateWorkflow(saved.id, {
                        name: saved.name,
                        description: saved.description,
                        fields: saved.fields,
                        workflow: saved.workflow,
                        outputKinds: saved.outputKinds,
                        nodeInfo: saved.nodeInfo,
                        referenceGroups: saved.referenceGroups,
                        diagnostics: saved.diagnostics,
                        outputNodeIds: saved.outputNodeIds,
                    });
                    setEditing(false);
                }}
            />
        ) : null;
    return { enabled: method === "comfyui", usesTemplatePrompt, effectivePrompt: prompt, settings, editor, snapshot, restore, validate, run, name: workflow?.name || "ComfyUI" };
}
