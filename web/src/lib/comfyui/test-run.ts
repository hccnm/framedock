import { prepareComfyWorkflow, preflightComfyRun } from "./prepare";
import i18n from "@/i18n";
import type { ComfyMediaValue } from "@/lib/comfyui/mapping";
import { collectComfyOutputs, readExecutionError, readHistoryStatus, refineOutputKind } from "@/lib/comfyui/output";
import { comfyPollDelayMs } from "@/lib/comfyui/poll";
import { buildRunWorkflow, defaultFieldValue, isMediaFieldType, randomSeed } from "@/lib/comfyui/workflow";
import { downloadComfyOutput, fetchComfyHistory, fetchComfyQueue, submitComfyPrompt, uploadComfyMedia } from "@/services/api/comfyui";
import { useComfyUiStore } from "@/stores/use-comfyui-store";
import { withLocalProxy } from "@/stores/use-config-store";
import type { ComfyOutput, ComfyWorkflow } from "@/types/comfyui";

export type ComfyTestProgress = "uploading" | "queued" | "running" | "processing";

export type ComfyTestResult = {
    promptId: string;
    images: string[];
    videos: string[];
    audios: string[];
    texts: string[];
};

/** Runs a workflow draft without touching the canvas: same upload, queue, poll and download path. */
export async function runComfyTest(options: {
    baseUrl: string;
    workflow: ComfyWorkflow;
    values: Record<string, unknown>;
    media: Record<string, ComfyMediaValue>;
    signal: AbortSignal;
    onProgress: (progress: ComfyTestProgress) => void;
}): Promise<ComfyTestResult> {
    const { baseUrl, values, media, signal, onProgress } = options;
    let { workflow } = options;
    if (workflow.executionBlockedReason) throw new Error(workflow.executionBlockedReason);
    workflow = await prepareComfyWorkflow(workflow, baseUrl);
    const scalar = Object.fromEntries(workflow.fields.filter((f) => f.enabled && !isMediaFieldType(f.type)).map((f) => [f.id, f.id in values ? values[f.id] : defaultFieldValue(f)]));
    preflightComfyRun(
        workflow,
        scalar,
        Object.keys(media).filter((id) => Boolean(media[id])),
    );
    onProgress("uploading");
    const resolved = await resolveTestValues(baseUrl, workflow, values, media, signal);

    onProgress("queued");
    const promptId = await submitComfyPrompt(baseUrl, buildRunWorkflow(workflow.workflow, workflow.fields, resolved, workflow));
    const item = await pollTest(baseUrl, promptId, signal, onProgress);

    onProgress("processing");
    const classTypes = Object.fromEntries(Object.entries(workflow.workflow).map(([id, node]) => [id, node.class_type]));
    const outputs = collectComfyOutputs(item.outputs, classTypes, workflow);
    if (!outputs.length) throw new Error(i18n.t("comfyui.error.emptyOutput"));

    const result: ComfyTestResult = { promptId, images: [], videos: [], audios: [], texts: [] };
    for (const output of outputs) {
        if (signal.aborted) throw abortError();
        if (output.kind === "text" && !output.file) {
            if (output.text) result.texts.push(output.text);
            continue;
        }
        const downloaded = await downloadComfyOutput(baseUrl, output.file!);
        const url = URL.createObjectURL(downloaded.blob);
        const kind = refineOutputKind(output as ComfyOutput, downloaded.contentType);
        if (kind === "image") result.images.push(url);
        else if (kind === "video") result.videos.push(url);
        else if (kind === "audio") result.audios.push(url);
        else if (kind === "text") result.texts.push(await downloaded.blob.text());
    }
    return result;
}

async function resolveTestValues(baseUrl: string, workflow: ComfyWorkflow, values: Record<string, unknown>, media: Record<string, ComfyMediaValue>, signal: AbortSignal) {
    const resolved: Record<string, unknown> = {};
    const missing: string[] = [];
    for (const field of workflow.fields.filter((item) => item.enabled)) {
        if (isMediaFieldType(field.type)) {
            const picked = media[field.id];
            if (!picked) {
                if (field.referenceInput) continue;
                missing.push(field.label || field.inputKey);
                continue;
            }
            const blob = picked.blob || (picked.url ? await fetchForBlob(picked.url, signal) : null);
            if (!blob) {
                missing.push(field.label || field.inputKey);
                continue;
            }
            const uploaded = await uploadComfyMedia(baseUrl, blob, picked.name);
            resolved[field.id] = uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
            continue;
        }
        const raw = field.id in values ? values[field.id] : defaultFieldValue(field);
        if (field.randomize) resolved[field.id] = randomSeed();
        else if (raw !== undefined && (raw !== "" || field.type === "text" || field.type === "textarea")) resolved[field.id] = raw;
    }
    if (missing.length) throw new Error(i18n.t("comfyui.error.missingInputs", { fields: missing.join("、") }));
    return resolved;
}

async function pollTest(baseUrl: string, promptId: string, signal: AbortSignal, onProgress: (progress: ComfyTestProgress) => void) {
    for (;;) {
        const item = await fetchComfyHistory(baseUrl, promptId);
        if (item) {
            if (readHistoryStatus(item) === "error") {
                const failure = readExecutionError(item);
                throw new Error([failure?.message, [failure?.nodeType, failure?.nodeId].filter(Boolean).join(" · ")].filter(Boolean).join("\n") || i18n.t("comfyui.error.executionFailed"));
            }
            return item;
        }
        const running = await fetchComfyQueue(baseUrl).catch(() => new Set<string>());
        onProgress(running.has(promptId) ? "running" : "queued");
        await delay(comfyPollDelayMs(useComfyUiStore.getState().pollIntervalSeconds), signal);
    }
}

async function fetchForBlob(url: string, signal: AbortSignal) {
    const response = await fetch(withLocalProxy(url), { signal });
    return response.ok ? response.blob() : null;
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
