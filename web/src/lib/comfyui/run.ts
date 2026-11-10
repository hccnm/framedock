import { prepareComfyWorkflow, preflightComfyRun } from "./prepare";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { notifyCanvasGeneration } from "@/lib/generation-notifications";
import { createCanvasNode, audioMetadata, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { readCanvasProject, updateCanvasProject } from "@/lib/canvas/canvas-project-bridge";
import { getDirectUpstreamResources, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { getComfyInputPorts } from "@/lib/comfyui/ports";
import { buildComfyMapping, missingComfyFields, type ComfyFieldMapping, type ComfyMediaValue } from "@/lib/comfyui/mapping";
import { collectComfyOutputs, readExecutionError, readHistoryStatus, refineOutputKind } from "@/lib/comfyui/output";
import { comfyPollDelayMs } from "@/lib/comfyui/poll";
import { buildRunWorkflow, isMediaFieldType, randomSeed } from "@/lib/comfyui/workflow";
import { downloadComfyOutput, describeComfyError, fetchComfyHistory, fetchComfyQueue, submitComfyPrompt, uploadComfyMedia } from "@/services/api/comfyui";
import { getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { getImageBlob, uploadImage } from "@/services/image-storage";
import { getComfyWorkflow, useComfyUiStore } from "@/stores/use-comfyui-store";
import { withLocalProxy } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeImage, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeText } from "@/types/canvas";
import type { ComfyApiNode, ComfyOutput, ComfyRunStatus, ComfyWorkflow } from "@/types/comfyui";

const RESULT_GAP = 40;

const activeRuns = new Map<string, AbortController>();

export type ComfyRunSummary = {
    imageCount: number;
    videoCount: number;
    audioCount: number;
    textCount: number;
    nodeIds: string[];
};

/** Runs a node end to end: map inputs, upload media, queue, poll, persist outputs, then create result nodes. */
export async function runComfyNode(projectId: string, nodeId: string): Promise<ComfyRunSummary> {
    const context = readNodeContext(projectId, nodeId);
    if (!context) throw new Error(i18n.t("comfyui.error.nodeMissing"));
    const { node } = context;

    const baseUrl = useComfyUiStore.getState().baseUrl;
    if (!baseUrl) throw new Error(i18n.t("comfyui.error.missingUrl"));
    let workflow = resolveNodeWorkflow(node);
    if (!workflow) throw new Error(i18n.t("comfyui.workflow.missing"));
    if (workflow.executionBlockedReason) throw new Error(workflow.executionBlockedReason);

    const controller = startRun(nodeId);
    let notificationId = nanoid();
    try {
        patchNode(projectId, nodeId, { comfyRunStatus: "uploading", comfyError: "", comfyPromptId: "" });
        workflow = await prepareComfyWorkflow(workflow, baseUrl);
        const values = await resolveMediaValues(projectId, nodeId, workflow, controller.signal);
        const runWorkflow = buildRunWorkflow(workflow.workflow, workflow.fields, values, workflow);

        patchNode(projectId, nodeId, { comfyRunStatus: "queued" });
        const promptId = await submitComfyPrompt(baseUrl, runWorkflow);
        notificationId = promptId;
        patchNode(projectId, nodeId, { comfyPromptId: promptId });

        const item = await pollPrompt(projectId, nodeId, baseUrl, promptId, controller.signal);
        const summary = await persistOutputs(projectId, nodeId, workflow, item, controller.signal);
        patchNode(projectId, nodeId, { comfyRunStatus: "success", comfyError: "", comfyOutputNodeIds: summary.nodeIds });
        notifyCanvasGeneration(projectId, nodeId, "success", "ComfyUI", notificationId);
        return summary;
    } catch (error) {
        if (isAbort(error)) throw error;
        patchNode(projectId, nodeId, { comfyRunStatus: "error", comfyError: describeComfyError(error) });
        notifyCanvasGeneration(projectId, nodeId, "error", "ComfyUI", notificationId);
        throw error;
    } finally {
        activeRuns.delete(nodeId);
    }
}

/**
 * Recovery path: a node that finished saving carries a prompt ID and no terminal status.
 * Nothing is resubmitted here; either the original prompt is still tracked or recovery is reported as unavailable.
 */
export async function resumeComfyNode(projectId: string, nodeId: string) {
    const context = readNodeContext(projectId, nodeId);
    const promptId = context?.node.metadata?.comfyPromptId;
    if (!context || !promptId || activeRuns.has(nodeId)) return;
    const baseUrl = useComfyUiStore.getState().baseUrl;
    if (!baseUrl) return;

    const controller = startRun(nodeId);
    try {
        const existing = await fetchComfyHistory(baseUrl, promptId);
        if (!existing) {
            const running = await fetchComfyQueue(baseUrl).catch(() => new Set<string>());
            if (!running.has(promptId)) {
                // Neither history nor the queue knows this prompt, so the ComfyUI history was cleared.
                patchNode(projectId, nodeId, { comfyRunStatus: "error", comfyError: i18n.t("comfyui.error.recoveryUnavailable") });
                notifyCanvasGeneration(projectId, nodeId, "error", "ComfyUI", promptId);
                return;
            }
            patchNode(projectId, nodeId, { comfyRunStatus: "running" });
        }
        const item = await pollPrompt(projectId, nodeId, baseUrl, promptId, controller.signal);
        const workflow = resolveNodeWorkflow(context.node);
        if (!workflow) {
            patchNode(projectId, nodeId, { comfyRunStatus: "error", comfyError: i18n.t("comfyui.workflow.missing") });
            notifyCanvasGeneration(projectId, nodeId, "error", "ComfyUI", promptId);
            return;
        }
        const summary = await persistOutputs(projectId, nodeId, workflow, item, controller.signal);
        patchNode(projectId, nodeId, { comfyRunStatus: "success", comfyError: "", comfyOutputNodeIds: summary.nodeIds });
        notifyCanvasGeneration(projectId, nodeId, "success", "ComfyUI", promptId);
    } catch (error) {
        if (isAbort(error)) return;
        patchNode(projectId, nodeId, { comfyRunStatus: "error", comfyError: describeComfyError(error) });
        notifyCanvasGeneration(projectId, nodeId, "error", "ComfyUI", promptId);
    } finally {
        activeRuns.delete(nodeId);
    }
}

export function cancelComfyRun(nodeId: string) {
    activeRuns.get(nodeId)?.abort();
    activeRuns.delete(nodeId);
}

export function isComfyRunActive(nodeId: string) {
    return activeRuns.has(nodeId);
}

/** Loads a saved run's outputs without resubmitting; used by the "query again" error action. */
export async function queryComfyPrompt(projectId: string, nodeId: string): Promise<ComfyRunSummary> {
    const context = readNodeContext(projectId, nodeId);
    const promptId = context?.node.metadata?.comfyPromptId;
    const baseUrl = useComfyUiStore.getState().baseUrl;
    if (!context || !promptId || !baseUrl) throw new Error(i18n.t("comfyui.error.noPrompt"));
    const workflow = resolveNodeWorkflow(context.node);
    if (!workflow) throw new Error(i18n.t("comfyui.workflow.missing"));
    try {
        const item = await fetchComfyHistory(baseUrl, promptId);
        if (!item) throw new Error(i18n.t("comfyui.error.recoveryUnavailable"));
        const summary = await persistOutputs(projectId, nodeId, workflow, item, undefined);
        patchNode(projectId, nodeId, { comfyRunStatus: "success", comfyError: "", comfyOutputNodeIds: summary.nodeIds });
        notifyCanvasGeneration(projectId, nodeId, "success", "ComfyUI", promptId);
        return summary;
    } catch (error) {
        if (!isAbort(error)) notifyCanvasGeneration(projectId, nodeId, "error", "ComfyUI", promptId);
        throw error;
    }
}

export function buildComfyNodeMapping(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[], prepared?: ComfyWorkflow) {
    const workflow = prepared || resolveNodeWorkflow(node);
    if (!workflow) return { workflow: undefined, mapping: [] as ComfyFieldMapping[], missing: [] as ComfyFieldMapping[], errors: [] as string[] };
    const upstream: Record<string, CanvasResourceReference[]> = Object.create(null);
    const errors: string[] = [];
    const ports = getComfyInputPorts(node, workflow);
    for (const connection of connections.filter((item) => item.toNodeId === node.id)) {
        const port = ports.find((item) => item.field.id === connection.targetFieldId);
        if (!port) {
            errors.push("输入连线未指定有效字段，请断开后连接到具名入口");
            continue;
        }
        const resources = getDirectUpstreamResources(node.id, nodes, [connection]);
        if (!resources.length || resources.some((item) => item.kind !== port.kind)) {
            errors.push(`${port.field.label}：素材类型不匹配或内容为空`);
            continue;
        }
        const assigned = [...(upstream[port.field.id] || []), ...resources];
        upstream[port.field.id] = [...new Map(assigned.map((item) => [item.nodeId, item])).values()];
        if (port.kind !== "text" && upstream[port.field.id].length > 1) errors.push(`${port.field.label}：一个素材入口只能连接一个素材`);
    }
    const mapping = buildComfyMapping({ fields: workflow.fields, upstream, values: node.metadata?.comfyValues || {} });
    return { workflow, mapping, missing: missingComfyFields(mapping), errors };
}

export function resolveNodeWorkflow(node: CanvasNodeData) {
    return getComfyWorkflow(node.metadata?.comfyWorkflowId);
}

/** Random seeds and uploaded file names are applied here, so the saved template is never touched. */
async function resolveMediaValues(projectId: string, nodeId: string, workflow: ComfyWorkflow, signal: AbortSignal) {
    const context = readNodeContext(projectId, nodeId);
    if (!context) throw new Error(i18n.t("comfyui.error.nodeMissing"));
    const { mapping, missing, errors } = buildComfyNodeMapping(context.node, context.nodes, context.connections, workflow);
    if (errors.length) throw new Error(errors.join("\n"));
    if (missing.length) throw new Error(i18n.t("comfyui.error.missingInputs", { fields: missing.map((item) => item.field.label || item.field.inputKey).join("、") }));

    preflightComfyRun(
        workflow,
        Object.fromEntries(mapping.filter((item) => !isMediaFieldType(item.field.type)).map((item) => [item.field.id, item.value])),
        mapping.filter((item) => Boolean(item.media)).map((item) => item.field.id),
    );
    const baseUrl = useComfyUiStore.getState().baseUrl;
    const values: Record<string, unknown> = {};
    for (const item of mapping) {
        if (isMediaFieldType(item.field.type)) {
            if (item.field.referenceInput && !item.media) continue;
            const blob = await resolveMediaBlob(item.media as ComfyMediaValue, signal);
            const uploaded = await uploadComfyMedia(baseUrl, blob, (item.media as ComfyMediaValue).name);
            values[item.field.id] = uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
            continue;
        }
        if (item.value === undefined) continue;
        const randomEnabled = context.node.metadata?.comfyRandomEnabled?.[item.field.id] ?? Boolean(item.field.randomize);
        values[item.field.id] = item.field.randomize && randomEnabled ? randomSeed() : item.value;
    }
    return values;
}

async function resolveMediaBlob(media: ComfyMediaValue, signal: AbortSignal) {
    if (media.blob) return media.blob;
    const stored = media.storageKey ? await readStoredBlob(media.storageKey) : null;
    if (stored) return stored;
    if (!media.url) throw new Error(i18n.t("comfyui.error.missingInputs", { fields: media.name }));
    const response = await fetch(withLocalProxy(media.url), { signal });
    if (!response.ok) throw new Error(i18n.t("comfyui.error.localFileFailed", { name: media.name }));
    return response.blob();
}

async function readStoredBlob(storageKey: string) {
    if (storageKey.startsWith("image:")) return getImageBlob(storageKey);
    return getMediaBlob(storageKey);
}

async function pollPrompt(projectId: string, nodeId: string, baseUrl: string, promptId: string, signal: AbortSignal) {
    for (;;) {
        const item = await fetchComfyHistory(baseUrl, promptId);
        if (item) {
            if (readHistoryStatus(item) === "error") {
                const failure = readExecutionError(item);
                const detail = [failure?.message, [failure?.nodeType, failure?.nodeId].filter(Boolean).join(" · ")].filter(Boolean).join("\n");
                throw new Error(detail || i18n.t("comfyui.error.executionFailed"));
            }
            return item;
        }
        const running = await fetchComfyQueue(baseUrl).catch(() => null);
        if (running) patchNode(projectId, nodeId, { comfyRunStatus: running.has(promptId) ? "running" : "queued" });
        await delay(comfyPollDelayMs(useComfyUiStore.getState().pollIntervalSeconds), signal);
    }
}

/** Downloads every recognised output, stores it locally, and appends ordinary resource nodes. */
async function persistOutputs(projectId: string, nodeId: string, workflow: ComfyWorkflow, item: Awaited<ReturnType<typeof fetchComfyHistory>>, signal?: AbortSignal) {
    const baseUrl = useComfyUiStore.getState().baseUrl;
    patchNode(projectId, nodeId, { comfyRunStatus: "processing" });
    const classTypes = Object.fromEntries(Object.entries(workflow.workflow).map(([id, node]) => [id, node.class_type]));
    const outputs = collectComfyOutputs(item?.outputs, classTypes, workflow);
    if (!outputs.length) throw new Error(i18n.t("comfyui.error.emptyOutput"));

    const images: CanvasNodeMetadata[] = [];
    const videos: CanvasNodeMetadata[] = [];
    const audios: CanvasNodeMetadata[] = [];
    const texts: string[] = [];

    for (const output of outputs) {
        if (signal?.aborted) throw abortError();
        if (output.kind === "text" && !output.file) {
            if (output.text) texts.push(output.text);
            continue;
        }
        const downloaded = await downloadComfyOutput(baseUrl, output.file!).catch((error) => {
            throw new Error(describeComfyError(error));
        });
        const kind = refineOutputKind(output as ComfyOutput, downloaded.contentType);
        if (kind === "image") images.push(imageMetadata(await uploadImage(downloaded.blob)));
        else if (kind === "video") videos.push(videoMetadata(await uploadMediaFile(downloaded.blob, "video")));
        else if (kind === "audio") audios.push(audioMetadata(await uploadMediaFile(downloaded.blob, "audio")));
        else if (kind === "text") texts.push(await downloaded.blob.text());
    }

    return appendResultNodes(projectId, nodeId, { images, videos, audios, texts });
}

/** One batch image node, one batch text node, and one node per video and audio. */
function appendResultNodes(projectId: string, nodeId: string, results: { images: CanvasNodeMetadata[]; videos: CanvasNodeMetadata[]; audios: CanvasNodeMetadata[]; texts: string[] }) {
    const created: CanvasNodeData[] = [];
    updateCanvasProject(projectId, (current) => {
        const source = current.nodes.find((node) => node.id === nodeId);
        if (!source) throw new Error(i18n.t("comfyui.error.nodeMissing"));

        const previousIds = new Set(source.metadata?.comfyOutputNodeIds || []);
        let cursorX = Math.max(source.position.x + source.width, ...current.nodes.filter((node) => previousIds.has(node.id)).map((node) => node.position.x + node.width)) + RESULT_GAP;
        const place = (type: CanvasNodeType, metadata: CanvasNodeMetadata, width: number, height: number) => {
            // Keep versions beside their source; unrelated rows and enclosing groups do not push them away.
            for (;;) {
                const collision = [...current.nodes, ...created].find((node) => node.id !== nodeId && node.type !== CanvasNodeType.Group &&
                    cursorX < node.position.x + node.width + RESULT_GAP && cursorX + width + RESULT_GAP > node.position.x &&
                    source.position.y < node.position.y + node.height + RESULT_GAP && source.position.y + height + RESULT_GAP > node.position.y);
                if (!collision) break;
                cursorX = collision.position.x + collision.width + RESULT_GAP;
            }
            const node = createCanvasNode(type, { x: cursorX + width / 2, y: source.position.y + height / 2 }, metadata);
            node.title = `${source.title || "ComfyUI"} · ${node.title} ${created.length + 1}`;
            cursorX += width + RESULT_GAP;
            created.push(node);
        };
        if (results.images.length) place(CanvasNodeType.Image, batchImageMetadata(results.images), 340, 240);
        if (results.texts.length) place(CanvasNodeType.Text, batchTextMetadata(results.texts), 340, 240);
        results.videos.forEach((meta) => place(CanvasNodeType.Video, meta, 420, 236));
        results.audios.forEach((meta) => place(CanvasNodeType.Audio, meta, 340, 120));

        const connections: CanvasConnection[] = created.map((node) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: node.id }));
        return { nodes: [...current.nodes, ...created], connections: [...current.connections, ...connections] };
    });

    return {
        imageCount: results.images.length,
        videoCount: results.videos.length,
        audioCount: results.audios.length,
        textCount: results.texts.length,
        nodeIds: created.map((node) => node.id),
    };
}

function batchImageMetadata(images: CanvasNodeMetadata[]): CanvasNodeMetadata {
    const entries: CanvasNodeImage[] = images.map((meta) => ({
        id: nanoid(),
        status: "success",
        content: meta.content || "",
        storageKey: meta.storageKey,
        naturalWidth: meta.naturalWidth || 1024,
        naturalHeight: meta.naturalHeight || 1024,
        bytes: meta.bytes || 0,
        mimeType: meta.mimeType || "image/png",
    }));
    const primary = entries[0];
    return {
        images: entries,
        primaryImageId: primary.id,
        content: primary.content,
        storageKey: primary.storageKey,
        status: "success",
        naturalWidth: primary.naturalWidth,
        naturalHeight: primary.naturalHeight,
        bytes: primary.bytes,
        mimeType: primary.mimeType,
    };
}

function batchTextMetadata(texts: string[]): CanvasNodeMetadata {
    const entries: CanvasNodeText[] = texts.map((content) => ({ id: nanoid(), status: "success", content }));
    return { texts: entries, primaryTextId: entries[0].id, content: entries[0].content, status: "success" };
}

function readNodeContext(projectId: string, nodeId: string) {
    const project = readCanvasProject(projectId);
    const node = project?.nodes.find((item) => item.id === nodeId);
    if (!project || !node || node.type !== CanvasNodeType.ComfyUI) return null;
    return { node, nodes: project.nodes, connections: project.connections };
}

/** Shared write path for ComfyUI node state; the panel and the runner both go through it. */
export function updateComfyNode(projectId: string, nodeId: string, patch: Partial<CanvasNodeMetadata>) {
    patchNode(projectId, nodeId, patch);
}

function patchNode(projectId: string, nodeId: string, patch: Partial<CanvasNodeMetadata>) {
    const node = readCanvasProject(projectId)?.nodes.find((item) => item.id === nodeId);
    if (!node || Object.entries(patch).every(([key, value]) => Object.is(node.metadata?.[key as keyof CanvasNodeMetadata], value))) return;
    updateCanvasProject(projectId, (current) => ({
        nodes: current.nodes.map((item) => (item.id === nodeId ? { ...item, metadata: { ...item.metadata, ...patch } } : item)),
        connections: current.connections,
    }));
}

export function comfyRunStatusLabel(status: ComfyRunStatus | undefined) {
    return i18n.t(`comfyui.status.${status || "idle"}`);
}

function startRun(nodeId: string) {
    activeRuns.get(nodeId)?.abort();
    const controller = new AbortController();
    activeRuns.set(nodeId, controller);
    return controller;
}

function delay(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            signal.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(abortError());
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
    });
}

function abortError() {
    return new DOMException("Aborted", "AbortError");
}

function isAbort(error: unknown) {
    return error instanceof DOMException && error.name === "AbortError";
}
