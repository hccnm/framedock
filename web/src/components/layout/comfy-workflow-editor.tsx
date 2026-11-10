import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Drawer, Input, Select, Switch } from "antd";
import { ArrowDown, ArrowUp, FlaskConical, GripVertical, Play, Save, Square } from "lucide-react";
import { useTranslation } from "react-i18next";

import { COMFY_OUTPUT_LABELS, analyzeWorkflow, patchWorkflowField, workflowOutputKinds, defaultFieldValue, hasRoleConflict, isMediaFieldType, PRESET_ROLES, randomSeed } from "@/lib/comfyui/workflow";
import type { ComfyMediaValue } from "@/lib/comfyui/mapping";
import { runComfyTest, type ComfyTestResult } from "@/lib/comfyui/test-run";
import { describeComfyError, fetchComfyObjectInfo } from "@/services/api/comfyui";
import { useComfyUiStore } from "@/stores/use-comfyui-store";
import type { ComfyPresetRole, ComfyWorkflow, ComfyWorkflowField, ComfyWorkflowFieldType } from "@/types/comfyui";

const FIELD_TYPES: ComfyWorkflowFieldType[] = ["text", "textarea", "number", "slider", "dropdown", "boolean", "image", "video", "audio"];

/** Edits the exposed field configuration and runs the workflow through the production request path. */
export function ComfyWorkflowEditor({ workflow, onSave, onClose }: { workflow: ComfyWorkflow; onSave: (workflow: ComfyWorkflow) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const baseUrl = useComfyUiStore((state) => state.baseUrl);
    const [draft, setDraft] = useState(workflow);
    const [search, setSearch] = useState("");
    const [syncing, setSyncing] = useState(false);
    const syncDefinitions = async () => {
        setSyncing(true);
        try {
            const info = await fetchComfyObjectInfo(
                baseUrl,
                Object.values(draft.workflow).map((node) => node.class_type),
            );
            setDraft((current) => ({ ...current, ...analyzeWorkflow(current.workflow, info, current) }));
            message.success("已读取 ComfyUI 参数选项与范围，保存后生效");
        } catch (error) {
            message.error(describeComfyError(error));
        } finally {
            setSyncing(false);
        }
    };
    const [dragId, setDragId] = useState("");
    const [values, setValues] = useState<Record<string, unknown>>({});
    const [media, setMedia] = useState<Record<string, ComfyMediaValue>>({});
    const [progress, setProgress] = useState("");
    const [result, setResult] = useState<ComfyTestResult | null>(null);
    const [error, setError] = useState("");
    const runRef = useRef<AbortController | null>(null);

    useEffect(() => () => runRef.current?.abort(), []);

    const visible = useMemo(() => {
        const keyword = search.trim().toLowerCase();
        const ordered = [...draft.fields].sort((a, b) => a.order - b.order);
        if (!keyword) return ordered;
        return ordered.filter((field) => [field.id, field.nodeTitle, field.nodeId, field.inputKey, field.label, field.type].some((value) => value.toLowerCase().includes(keyword)));
    }, [draft.fields, search]);

    const patchField = (fieldId: string, patch: Partial<ComfyWorkflowField>) => setDraft((current) => patchWorkflowField(current, fieldId, patch));
    const analysis = useMemo(() => analyzeWorkflow(draft.workflow, undefined, draft), [draft]);
    const issues = [...(draft.diagnostics || []).filter((issue) => issue.code === "missing-node" || issue.code === "metadata-unavailable"), ...analysis.diagnostics];
    const moveField = (fieldId: string, delta: number) => {
        setDraft((current) => {
            const ordered = [...current.fields].sort((left, right) => left.order - right.order);
            const index = ordered.findIndex((field) => field.id === fieldId);
            const target = index + delta;
            if (index < 0 || target < 0 || target >= ordered.length) return current;
            [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
            return { ...current, fields: ordered.map((field, position) => ({ ...field, order: position })) };
        });
    };
    const dropOn = (fieldId: string) => {
        if (!dragId || dragId === fieldId) return;
        setDraft((current) => {
            const ordered = [...current.fields].sort((left, right) => left.order - right.order);
            const from = ordered.findIndex((field) => field.id === dragId);
            const to = ordered.findIndex((field) => field.id === fieldId);
            if (from < 0 || to < 0) return current;
            const [moved] = ordered.splice(from, 1);
            ordered.splice(to, 0, moved);
            return { ...current, fields: ordered.map((field, position) => ({ ...field, order: position })) };
        });
        setDragId("");
    };

    const changeRole = (field: ComfyWorkflowField, role: ComfyPresetRole | undefined) => {
        if (role && hasRoleConflict(draft.fields, field.id, role)) {
            message.warning(t("comfyui.editor.roleTaken", { role: t(`comfyui.roles.${role}`) }));
            return;
        }
        patchField(field.id, { presetRole: role });
    };

    const save = () => {
        if (!draft.name.trim()) {
            message.error(t("comfyui.editor.formErrors"));
            return;
        }
        onSave({ ...draft, ...analysis, name: draft.name.trim(), updatedAt: new Date().toISOString() });
    };

    const runTest = async () => {
        if (!baseUrl) {
            message.error(t("comfyui.error.missingUrl"));
            return;
        }
        setError("");
        setResult(null);
        const controller = new AbortController();
        runRef.current = controller;
        try {
            setProgress("uploading");
            setResult(
                await runComfyTest({
                    baseUrl,
                    workflow: draft,
                    values,
                    media,
                    signal: controller.signal,
                    onProgress: (next) => setProgress(next),
                }),
            );
        } catch (failure) {
            if (!(failure instanceof DOMException && failure.name === "AbortError")) setError(describeComfyError(failure));
        } finally {
            runRef.current = null;
            setProgress("");
        }
    };

    return (
        <Drawer
            width={980}
            open
            title={draft.name || t("comfyui.workflows.title")}
            onClose={onClose}
            extra={
                <Button type="primary" icon={<Save className="size-4" />} onClick={save}>
                    {t("common.save")}
                </Button>
            }
        >
            <div className="space-y-4">
                <section className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1">
                        <div className="text-xs text-stone-500">{t("comfyui.editor.name")}</div>
                        <Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
                    </label>
                    <label className="space-y-1">
                        <div className="text-xs text-stone-500">{t("comfyui.editor.description")}</div>
                        <Input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} />
                    </label>
                </section>

                <label className="block space-y-1">
                    <span className="text-sm">输出类型</span>
                    <Select
                        mode="multiple"
                        className="w-full"
                        aria-label="输出类型"
                        placeholder="选择工作流的输出类型"
                        value={workflowOutputKinds(draft)}
                        onChange={(outputKinds) => setDraft((current) => ({ ...current, outputKinds }))}
                        options={Object.entries(COMFY_OUTPUT_LABELS).map(([value, label]) => ({ value, label }))}
                    />
                    <span className="text-xs text-stone-500">按节点定义和工作流参数识别，可手动调整；用于区分生图和生视频工作台。</span>
                </label>

                <label className="block space-y-1">
                    <span className="text-sm">输出节点</span>
                    <Select
                        mode="multiple"
                        className="w-full"
                        aria-label="输出节点"
                        placeholder="自动收集输出；也可选择具体节点"
                        value={draft.outputNodeIds || []}
                        options={Object.entries(draft.workflow).map(([id, node]) => ({ value: id, label: `${node._meta?.title || draft.nodeInfo?.[node.class_type]?.display_name || node.class_type} · #${id}` }))}
                        onChange={(ids) => setDraft((current) => ({ ...current, outputNodeIds: ids.length ? ids : undefined }))}
                    />
                </label>
                {issues.length ? (
                    <section className="space-y-2" aria-label="工作流识别结果">
                        {issues.map((issue, index) => (
                            <div key={`${issue.code}-${issue.fieldId}-${index}`} className="text-sm">
                                <div>{issue.message}</div>
                                {issue.suggestions?.map((value) => (
                                    <Button key={String(value)} size="small" type="link" onClick={() => issue.fieldId && patchField(issue.fieldId, { defaultValue: value })}>
                                        采用：{String(value)}
                                    </Button>
                                ))}
                            </div>
                        ))}
                    </section>
                ) : null}
                {analysis.referenceGroups.length ? (
                    <section className="space-y-2" aria-label="参考输入规则">
                        <div className="text-sm font-semibold">参考输入规则</div>
                        {analysis.referenceGroups.map((group) => (
                            <div key={group.id} className="flex flex-wrap items-center gap-2 text-xs">
                                <span>
                                    {draft.workflow[group.nodeId]?._meta?.title || draft.workflow[group.nodeId]?.class_type} · {group.bindings.map((binding) => binding.inputKey).join("、")}
                                </span>
                                <NumberCell
                                    label="最少素材数"
                                    value={group.min}
                                    onChange={(min) => {
                                        if (min !== undefined && Number.isInteger(min) && min >= 0) setDraft((current) => ({ ...current, referenceGroups: analysis.referenceGroups.map((item) => (item.id === group.id ? { ...item, min } : item)) }));
                                    }}
                                />
                                <span>
                                    {group.kind === "dynamic" ? "动态插槽" : "固定插槽"}
                                    {group.max !== undefined ? `，最多 ${group.max} 个` : ""}
                                </span>
                            </div>
                        ))}
                    </section>
                ) : null}

                <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold">{t("comfyui.editor.fields")}</div>
                        <Button size="small" loading={syncing} disabled={!baseUrl} onClick={() => void syncDefinitions()}>
                            从 ComfyUI 刷新参数选项
                        </Button>
                        <Input allowClear className="max-w-xs" placeholder={t("comfyui.editor.search")} value={search} onChange={(event) => setSearch(event.target.value)} />
                    </div>
                    <div className="mt-3 space-y-1.5">
                        {visible.length ? (
                            visible.map((field) => (
                                <FieldRow
                                    key={field.id}
                                    field={field}
                                    dragging={dragId === field.id}
                                    onDragStart={() => setDragId(field.id)}
                                    onDrop={() => dropOn(field.id)}
                                    onPatch={(patch) => patchField(field.id, patch)}
                                    onRole={(role) => changeRole(field, role)}
                                    onMove={(delta) => moveField(field.id, delta)}
                                />
                            ))
                        ) : (
                            <div className="py-6 text-center text-xs text-stone-500">{draft.fields.length ? t("comfyui.editor.noMatch") : t("comfyui.editor.empty")}</div>
                        )}
                    </div>
                </section>

                <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <div className="flex items-center gap-2 text-sm font-semibold">
                                <FlaskConical className="size-4" />
                                {t("comfyui.test.title")}
                            </div>
                            <div className="mt-1 text-xs text-stone-500">{t("comfyui.test.description")}</div>
                        </div>
                        {progress ? (
                            <Button danger icon={<Square className="size-4" />} onClick={() => runRef.current?.abort()}>
                                {t("canvas.comfyNode.stop")}
                            </Button>
                        ) : (
                            <Button icon={<Play className="size-4" />} onClick={() => void runTest()}>
                                {t("comfyui.test.run")}
                            </Button>
                        )}
                    </div>

                    <div className="mt-3 space-y-2">
                        {draft.fields.filter((field) => field.enabled).length ? (
                            draft.fields
                                .filter((field) => field.enabled)
                                .map((field) => (
                                    <TestField
                                        key={field.id}
                                        field={field}
                                        value={values[field.id] ?? defaultFieldValue(field)}
                                        media={media[field.id]}
                                        onValue={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
                                        onMedia={(value) =>
                                            setMedia((current) => {
                                                const next = { ...current };
                                                if (value) next[field.id] = value;
                                                else delete next[field.id];
                                                return next;
                                            })
                                        }
                                    />
                                ))
                        ) : (
                            <div className="text-xs text-stone-500">{t("canvas.comfyNode.noInputs")}</div>
                        )}
                    </div>

                    {progress ? <div className="mt-3 text-xs text-stone-500">{t(`comfyui.status.${progress}`)}</div> : null}
                    {result ? (
                        <div className="mt-3 space-y-2">
                            <div className="text-xs text-stone-500">{t("comfyui.test.promptId", { id: result.promptId })}</div>
                            {result.texts.map((text, index) => (
                                <pre key={index} className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-stone-100 p-2 text-xs dark:bg-stone-900">
                                    {text}
                                </pre>
                            ))}
                            {result.images.length ? (
                                <div className="grid grid-cols-3 gap-2">
                                    {result.images.map((url) => (
                                        <img key={url} src={url} alt="" className="w-full rounded border border-stone-200 dark:border-stone-800" />
                                    ))}
                                </div>
                            ) : null}
                            {result.videos.map((url) => (
                                <video key={url} src={url} controls className="w-full rounded border border-stone-200 dark:border-stone-800" />
                            ))}
                            {result.audios.map((url) => (
                                <audio key={url} src={url} controls className="w-full" />
                            ))}
                        </div>
                    ) : null}
                    {error ? <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{error}</pre> : null}
                    {!result && !error && !progress ? <div className="mt-3 text-xs text-stone-500">{t("comfyui.test.empty")}</div> : null}
                </section>
            </div>
        </Drawer>
    );
}

function FieldRow({
    field,
    dragging,
    onDragStart,
    onDrop,
    onPatch,
    onRole,
    onMove,
}: {
    field: ComfyWorkflowField;
    dragging: boolean;
    onDragStart: () => void;
    onDrop: () => void;
    onPatch: (patch: Partial<ComfyWorkflowField>) => void;
    onRole: (role: ComfyPresetRole | undefined) => void;
    onMove: (delta: number) => void;
}) {
    const { t } = useTranslation();
    const media = isMediaFieldType(field.type);
    return (
        <div className={`rounded-md border px-2 py-2 ${dragging ? "border-blue-400" : "border-stone-200 dark:border-stone-800"}`} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
            <div className="flex flex-wrap items-center gap-2">
                <span className="cursor-grab text-stone-400" draggable onDragStart={onDragStart} onDragEnd={onDrop}>
                    <GripVertical className="size-4" />
                </span>
                <Switch size="small" aria-label={`公开 ${field.id}`} checked={field.enabled} onChange={(checked) => onPatch({ enabled: checked })} />
                <Input size="small" className="w-40" value={field.label} onChange={(event) => onPatch({ label: event.target.value })} />
                <Select size="small" className="w-28" value={field.type} options={FIELD_TYPES.map((type) => ({ value: type, label: t(`comfyui.fieldTypes.${type}`) }))} onChange={(type) => onPatch({ type, typeManuallySet: true })} />
                <Select
                    size="small"
                    className="w-28"
                    allowClear
                    aria-label={`${field.nodeTitle} · ${field.inputKey} 用途`}
                    value={field.presetRole}
                    placeholder={t("comfyui.roles.none")}
                    options={PRESET_ROLES.map((role) => ({ value: role, label: t(`comfyui.roles.${role}`) }))}
                    onChange={(role) => onRole(role as ComfyPresetRole | undefined)}
                />
                <span className="min-w-0 flex-1 truncate text-xs text-stone-500" title={`${field.nodeTitle} · ${field.inputKey}`}>
                    {field.nodeTitle} · {field.inputKey} · #{field.nodeId}
                </span>
                <Button size="small" type="text" icon={<ArrowUp className="size-3.5" />} onClick={() => onMove(-1)} />
                <Button size="small" type="text" icon={<ArrowDown className="size-3.5" />} onClick={() => onMove(1)} />
            </div>
            {!media ? (
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-6">
                    <span className="text-xs text-stone-500">{t("comfyui.editor.value")}</span>
                    {field.type === "textarea" ? (
                        <Input.TextArea aria-label={`${field.label} 默认值`} className="!w-full" autoSize={{ minRows: 3, maxRows: 10 }} value={String(field.defaultValue ?? "")} onChange={(event) => onPatch({ defaultValue: event.target.value })} />
                    ) : (
                        <Input size="small" aria-label={`${field.label} 默认值`} className="w-40" value={String(field.defaultValue ?? "")} onChange={(event) => onPatch({ defaultValue: event.target.value })} />
                    )}
                    {field.type === "dropdown" ? (
                        <Input
                            size="small"
                            className="w-64"
                            placeholder={t("comfyui.editor.options")}
                            value={(field.options || []).join(", ")}
                            onChange={(event) =>
                                onPatch({
                                    options: event.target.value
                                        .split(",")
                                        .map((item) => item.trim())
                                        .filter(Boolean),
                                })
                            }
                        />
                    ) : null}
                    {field.type === "number" || field.type === "slider" ? (
                        <>
                            <NumberCell label={t("comfyui.editor.min")} value={field.min} onChange={(min) => onPatch({ min })} />
                            <NumberCell label={t("comfyui.editor.max")} value={field.max} onChange={(max) => onPatch({ max })} />
                            <NumberCell label={t("comfyui.editor.step")} value={field.step} onChange={(step) => onPatch({ step })} />
                        </>
                    ) : null}
                    {field.type === "number" ? (
                        <label className="flex items-center gap-1 text-xs text-stone-500">
                            <Switch size="small" checked={Boolean(field.randomize)} onChange={(checked) => onPatch({ randomize: checked })} />
                            {t("comfyui.editor.randomize")}
                        </label>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}

function NumberCell({ label, value, onChange }: { label: string; value: number | undefined; onChange: (value: number | undefined) => void }) {
    return (
        <label className="flex items-center gap-1 text-xs text-stone-500">
            {label}
            <Input size="small" className="w-20" value={value === undefined ? "" : String(value)} onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))} />
        </label>
    );
}

function TestField({ field, value, media, onValue, onMedia }: { field: ComfyWorkflowField; value: unknown; media?: ComfyMediaValue; onValue: (value: unknown) => void; onMedia: (value: ComfyMediaValue | undefined) => void }) {
    const { t } = useTranslation();
    if (isMediaFieldType(field.type)) {
        return (
            <div className="flex items-center gap-2">
                <span className="w-40 shrink-0 truncate text-xs text-stone-500">{field.label || field.inputKey}</span>
                <input
                    type="file"
                    accept={field.type === "image" ? "image/*" : field.type === "video" ? "video/*" : "audio/*"}
                    className="text-xs"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) onMedia({ name: file.name, blob: file });
                    }}
                />
                {media ? (
                    <>
                        <span className="truncate text-xs text-stone-500">{media.name}</span>
                        <Button size="small" type="text" onClick={() => onMedia(undefined)}>
                            移除
                        </Button>
                    </>
                ) : field.referenceInput ? (
                    <span className="text-xs text-stone-500">可选，未选则跳过</span>
                ) : null}
            </div>
        );
    }
    if (field.type === "boolean") {
        return (
            <label className="flex items-center gap-2 text-xs">
                <span className="w-40 shrink-0 truncate text-stone-500">{field.label || field.inputKey}</span>
                <Switch size="small" checked={Boolean(value)} onChange={onValue} />
            </label>
        );
    }
    if (field.type === "dropdown") {
        return (
            <label className="flex items-center gap-2 text-xs">
                <span className="w-40 shrink-0 truncate text-stone-500">{field.label || field.inputKey}</span>
                <Select size="small" className="min-w-0 flex-1" value={value === "" ? undefined : String(value)} options={(field.options || []).map((option) => ({ value: String(option), label: String(option) }))} onChange={onValue} />
            </label>
        );
    }
    if (field.randomize) {
        return (
            <label className="flex items-center gap-2 text-xs">
                <span className="w-40 shrink-0 truncate text-stone-500">{field.label || field.inputKey}</span>
                <Input size="small" value={String(value ?? "")} onChange={(event) => onValue(event.target.value)} />
                <Button size="small" type="text" onClick={() => onValue(randomSeed())}>
                    {t("canvas.comfyNode.random")}
                </Button>
            </label>
        );
    }
    return (
        <label className="flex items-center gap-2 text-xs">
            <span className="w-40 shrink-0 truncate text-stone-500">{field.label || field.inputKey}</span>
            {field.type === "textarea" ? (
                <Input.TextArea size="small" autoSize={{ minRows: 2, maxRows: 6 }} value={String(value ?? "")} onChange={(event) => onValue(event.target.value)} />
            ) : (
                <Input size="small" value={String(value ?? "")} onChange={(event) => onValue(event.target.value)} />
            )}
        </label>
    );
}
