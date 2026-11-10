import { useRef, useState } from "react";
import { App, Button, Form, Input, InputNumber, Modal, Select } from "antd";
import { Copy, FileJson, FlaskConical, Pencil, Plus, Trash2, Wifi } from "lucide-react";
import { nanoid } from "nanoid";
import { useTranslation } from "react-i18next";

import { ComfyWorkflowEditor } from "@/components/layout/comfy-workflow-editor";
import { isDesktopHost } from "@/lib/desktop-host";
import { clampComfyPollSeconds, COMFY_POLL_PRESETS, MIN_COMFY_POLL_SECONDS } from "@/lib/comfyui/poll";
import { COMFY_OUTPUT_LABELS, workflowOutputKinds, analyzeWorkflow, isMediaFieldType, parseWorkflowFile } from "@/lib/comfyui/workflow";
import { fetchComfyObjectInfo, isValidComfyBaseUrl, normalizeComfyBaseUrl, testComfyConnection } from "@/services/api/comfyui";
import { countComfyWorkflowReferences, useComfyUiStore } from "@/stores/use-comfyui-store";
import type { ComfyPresetRoles, ComfyWorkflow } from "@/types/comfyui";

const PRESET_MODES: Array<keyof ComfyPresetRoles> = ["text", "enhance", "edit"];

export function ConfigComfyUi() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const fileRef = useRef<HTMLInputElement>(null);
    const baseUrl = useComfyUiStore((state) => state.baseUrl);
    const workflows = useComfyUiStore((state) => state.workflows);
    const setBaseUrl = useComfyUiStore((state) => state.setBaseUrl);
    const addWorkflow = useComfyUiStore((state) => state.addWorkflow);
    const duplicateWorkflow = useComfyUiStore((state) => state.duplicateWorkflow);
    const deleteWorkflow = useComfyUiStore((state) => state.deleteWorkflow);
    const presetWorkflowIds = useComfyUiStore((state) => state.presetWorkflowIds);
    const setPresetWorkflowId = useComfyUiStore((state) => state.setPresetWorkflowId);
    const pollIntervalSeconds = useComfyUiStore((state) => state.pollIntervalSeconds);
    const setPollIntervalSeconds = useComfyUiStore((state) => state.setPollIntervalSeconds);
    const [url, setUrl] = useState(baseUrl);
    const [pollDraft, setPollDraft] = useState<number | null>(pollIntervalSeconds);
    const [testing, setTesting] = useState(false);
    const [instanceInfo, setInstanceInfo] = useState("");
    const [editing, setEditing] = useState<ComfyWorkflow | null>(null);
    const [isNew, setIsNew] = useState(false);
    const [removing, setRemoving] = useState<ComfyWorkflow | null>(null);

    const saveUrl = (value: string) => {
        const normalized = normalizeComfyBaseUrl(value);
        // An invalid address is never persisted, so a typo cannot break every later run.
        if (normalized || !value.trim()) setBaseUrl(normalized);
        if (!normalized && value.trim()) message.warning(t("comfyui.error.missingUrl"));
    };

    const applyPollInterval = (value: number | null) => {
        const clamped = clampComfyPollSeconds(Number(value));
        // Custom intervals have no upper bound, so only a value below the minimum is corrected.
        if (value !== null && clamped !== value) message.warning(t("comfyui.poll.minHint", { min: MIN_COMFY_POLL_SECONDS }));
        setPollIntervalSeconds(clamped);
        setPollDraft(clamped);
    };

    const test = async () => {
        if (!isValidComfyBaseUrl(url)) {
            message.error(t("comfyui.error.missingUrl"));
            return;
        }
        setTesting(true);
        try {
            const info = await testComfyConnection(url);
            setInstanceInfo([t("comfyui.instance.connected", { version: info.version || "?" }), info.device ? t("comfyui.instance.device", { device: info.device }) : ""].filter(Boolean).join(" · "));
            saveUrl(url);
        } catch (error) {
            setInstanceInfo("");
            message.error(error instanceof Error ? error.message : String(error));
        } finally {
            setTesting(false);
        }
    };

    const importFile = async (file: File) => {
        try {
            const workflow = parseWorkflowFile(await file.text());
            // Object info only refines types; a missing instance still imports with inferred fields.
            const objectInfo = isValidComfyBaseUrl(baseUrl)
                ? await fetchComfyObjectInfo(
                      baseUrl,
                      Object.values(workflow).map((node) => node.class_type),
                  ).catch(() => undefined)
                : undefined;
            if (isValidComfyBaseUrl(baseUrl) && !objectInfo) message.warning(t("comfyui.workflows.objectInfoFailed"));
            const now = new Date().toISOString();
            setEditing({ id: nanoid(), name: file.name.replace(/\.json$/i, ""), description: "", workflow, ...analyzeWorkflow(workflow, objectInfo), createdAt: now, updatedAt: now });
            setIsNew(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        }
    };

    const confirmRemove = () => {
        if (!removing) return;
        deleteWorkflow(removing.id);
        setRemoving(null);
    };

    return (
        <Form layout="vertical" requiredMark={false}>
            <section className="rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                <div className="text-sm font-semibold">{t("comfyui.instance.title")}</div>
                <div className="mt-1 text-xs text-stone-500">{isDesktopHost() ? "桌面应用直接连接此 ComfyUI 实例，支持局域网和远程地址。" : t("comfyui.instance.description")}</div>
                <Form.Item label={t("comfyui.instance.url")} className="mt-3 mb-0">
                    <Input value={url} placeholder={t("comfyui.instance.urlPlaceholder")} onChange={(event) => setUrl(event.target.value)} onBlur={(event) => saveUrl(event.target.value)} />
                </Form.Item>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button icon={<Wifi className="size-4" />} loading={testing} onClick={() => void test()}>
                        {testing ? t("comfyui.instance.testing") : t("comfyui.instance.test")}
                    </Button>
                    {instanceInfo ? <span className="text-xs text-stone-500">{instanceInfo}</span> : null}
                </div>
                <Form.Item label={t("comfyui.poll.title")} extra={t("comfyui.poll.description")} className="mt-3 mb-0">
                    <div className="flex flex-wrap items-center gap-2">
                        {COMFY_POLL_PRESETS.map((seconds) => (
                            <Button key={seconds} size="small" type={pollIntervalSeconds === seconds ? "primary" : "default"} onClick={() => applyPollInterval(seconds)}>
                                {t("comfyui.poll.seconds", { count: seconds })}
                            </Button>
                        ))}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                        <span className="text-xs text-stone-500">{t("comfyui.poll.custom")}</span>
                        <InputNumber
                            size="small"
                            min={MIN_COMFY_POLL_SECONDS}
                            step={1}
                            className="w-24"
                            value={pollDraft}
                            onChange={(value) => setPollDraft(value)}
                            onBlur={() => applyPollInterval(pollDraft)}
                            onPressEnter={() => applyPollInterval(pollDraft)}
                        />
                        <span className="text-xs text-stone-500">{t("comfyui.poll.unit")}</span>
                    </div>
                </Form.Item>
                <div className="mt-3 text-xs text-stone-500">{isDesktopHost() ? "请求通过桌面连接通道发送，无需为浏览器额外开启跨域访问。请确保当前电脑能够访问该地址。" : t("comfyui.instance.corsHint")}</div>
            </section>

            <section className="mt-4 rounded-lg border border-stone-200 p-3 dark:border-stone-800">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div className="text-sm font-semibold">{t("comfyui.workflows.title")}</div>
                        <div className="mt-1 text-xs text-stone-500">{t("comfyui.workflows.description")}</div>
                    </div>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={() => fileRef.current?.click()}>
                        {t("comfyui.workflows.import")}
                    </Button>
                </div>
                <input
                    ref={fileRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void importFile(file);
                    }}
                />

                {workflows.length ? (
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        {PRESET_MODES.map((mode) => (
                            <label key={mode} className="flex items-center gap-2 text-xs">
                                <span className="w-16 shrink-0 text-stone-500">{t(`canvas.comfyNode.presets.${mode}`)}</span>
                                <Select
                                    size="small"
                                    className="min-w-0 flex-1"
                                    allowClear
                                    value={presetWorkflowIds[mode] || undefined}
                                    placeholder={t("comfyui.roles.none")}
                                    options={workflows.filter((workflow) => workflowOutputKinds(workflow).includes("image")).map((workflow) => ({ value: workflow.id, label: workflow.name }))}
                                    onChange={(value) => setPresetWorkflowId(mode, value || "")}
                                />
                            </label>
                        ))}
                    </div>
                ) : null}

                {workflows.length ? (
                    <div className="mt-3 space-y-2">
                        {workflows.map((workflow) => {
                            const media = [...new Set(workflow.fields.filter((field) => field.enabled && isMediaFieldType(field.type)).map((field) => t(`comfyui.fieldTypes.${field.type}`)))];
                            const roles = [...new Set(workflow.fields.filter((field) => field.enabled && field.presetRole).map((field) => t(`comfyui.roles.${field.presetRole}`)))];
                            return (
                                <div key={workflow.id} className="flex items-start justify-between gap-3 rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-semibold">{workflow.name}</div>
                                        <div className="mt-1 space-y-0.5 text-xs text-stone-500">
                                            <div>
                                                输出：
                                                {workflowOutputKinds(workflow)
                                                    .map((kind) => COMFY_OUTPUT_LABELS[kind])
                                                    .join("、") || "未指定（请编辑设置）"}
                                            </div>
                                            <div>
                                                {t("comfyui.workflows.fieldCount", { count: workflow.fields.filter((field) => field.enabled).length })}
                                                {media.length ? ` · ${t("comfyui.workflows.fieldKinds", { kinds: media.join("、") })}` : ""}
                                                {roles.length ? ` · ${t("comfyui.workflows.presetBindings", { roles: roles.join("、") })}` : ""}
                                            </div>
                                            <div>{t("common.updated", { date: new Date(workflow.updatedAt).toLocaleString() })}</div>
                                        </div>
                                    </div>
                                    <div className="flex shrink-0 gap-2">
                                        <Button
                                            size="small"
                                            icon={<Pencil className="size-3.5" />}
                                            onClick={() => {
                                                setEditing(workflow);
                                                setIsNew(false);
                                            }}
                                        >
                                            {t("comfyui.workflows.edit")}
                                        </Button>
                                        <Button
                                            size="small"
                                            icon={<FlaskConical className="size-3.5" />}
                                            onClick={() => {
                                                setEditing(workflow);
                                                setIsNew(false);
                                            }}
                                        >
                                            {t("comfyui.workflows.test")}
                                        </Button>
                                        <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => duplicateWorkflow(workflow.id)}>
                                            {t("comfyui.workflows.duplicate")}
                                        </Button>
                                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => setRemoving(workflow)} />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="mt-3 rounded-lg bg-stone-100 px-4 py-8 text-center text-xs text-stone-500 dark:bg-stone-900">
                        <FileJson className="mx-auto mb-2 size-5" />
                        <div>{t("comfyui.workflows.empty")}</div>
                        <div className="mt-1">{t("comfyui.workflows.emptyHint")}</div>
                    </div>
                )}
            </section>

            {editing ? (
                <ComfyWorkflowEditor
                    workflow={editing}
                    onClose={() => setEditing(null)}
                    onSave={(workflow) => {
                        addWorkflow(workflow);
                        setEditing(null);
                        if (isNew) message.success(t("comfyui.workflows.imported", { name: workflow.name }));
                    }}
                />
            ) : null}

            <Modal open={Boolean(removing)} title={t("comfyui.workflows.removeTitle")} okText={t("comfyui.workflows.removeConfirm")} cancelText={t("common.cancel")} okButtonProps={{ danger: true }} onOk={confirmRemove} onCancel={() => setRemoving(null)}>
                <div className="space-y-2 text-sm">
                    <div>{t("comfyui.workflows.removeDescription", { name: removing?.name || "" })}</div>
                    {removing && countComfyWorkflowReferences(removing.id) ? <div className="text-xs text-amber-600 dark:text-amber-500">{t("comfyui.workflows.removeReferenced", { count: countComfyWorkflowReferences(removing.id) })}</div> : null}
                </div>
            </Modal>
        </Form>
    );
}
