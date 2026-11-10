import { nanoid } from "nanoid";

import i18n from "@/i18n";
import type { ComfyHistoryItem } from "@/lib/comfyui/output";
import { withLocalProxy } from "@/stores/use-config-store";
import type { ComfyApiNode, ComfyObjectInfo, ComfyOutputFile, ComfySystemStats } from "@/types/comfyui";

const COMFY_REQUEST_TIMEOUT_MS = 60_000;
const COMFY_UPLOAD_TIMEOUT_MS = 10 * 60_000;
const COMFY_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

export type ComfyPromptNodeError = {
    nodeId: string;
    classType: string;
    /** Input key reported by ComfyUI when the failure is tied to one field. */
    input?: string;
    message: string;
    details: string;
};

/** `/prompt` rejected the workflow. Keeps ComfyUI's own node, class, input and message diagnostics. */
export class ComfyPromptError extends Error {
    nodeErrors: ComfyPromptNodeError[];

    constructor(message: string, nodeErrors: ComfyPromptNodeError[]) {
        super(message);
        this.name = "ComfyPromptError";
        this.nodeErrors = nodeErrors;
    }
}

export function normalizeComfyBaseUrl(value: string) {
    const trimmed = value.trim().replace(/\/+$/, "");
    if (!trimmed) return "";
    return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

export function isValidComfyBaseUrl(value: string) {
    return Boolean(normalizeComfyBaseUrl(value));
}

export async function testComfyConnection(baseUrl: string) {
    const base = requireBaseUrl(baseUrl);
    const stats = await requestJson<ComfySystemStats>(base, "/system_stats");
    const device = stats.devices?.[0];
    return {
        version: stats.system?.comfyui_version || "",
        device: device?.name || stats.system?.os || "",
    };
}

export async function fetchComfyObjectInfo(baseUrl: string, classTypes?: string[]) {
    const base = requireBaseUrl(baseUrl);
    if (!classTypes) return requestJson<ComfyObjectInfo>(base, "/object_info");
    const entries = await Promise.all([...new Set(classTypes)].map((type) => requestJson<ComfyObjectInfo>(base, `/object_info/${encodeURIComponent(type)}`)));
    return Object.assign({}, ...entries) as ComfyObjectInfo;
}

export async function uploadComfyMedia(baseUrl: string, blob: Blob, name: string) {
    const base = requireBaseUrl(baseUrl);
    const form = new FormData();
    form.append("image", new File([blob], conflictFreeName(name, blob.type), { type: blob.type || "application/octet-stream" }));
    form.append("type", "input");
    form.append("overwrite", "false");
    const response = await send(base, "/upload/image", { method: "POST", body: form }, COMFY_UPLOAD_TIMEOUT_MS);
    const data = (await parseJson(response)) as { name?: string; subfolder?: string; type?: string };
    if (!response.ok || !data?.name) throw new Error(i18n.t("comfyui.error.uploadFailed"));
    return { name: data.name, subfolder: data.subfolder || "", type: "input" as const };
}

export async function submitComfyPrompt(baseUrl: string, workflow: Record<string, ComfyApiNode>) {
    const base = requireBaseUrl(baseUrl);
    const response = await send(
        base,
        "/prompt",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: workflow, client_id: `infinite-canvas-${nanoid()}` }) },
        COMFY_REQUEST_TIMEOUT_MS,
    );
    const data = await parseJson(response);
    const nodeErrors = readNodeErrors(data);
    if (nodeErrors.length) throw new ComfyPromptError(i18n.t("comfyui.error.promptRejected"), nodeErrors);
    const promptId = (data as { prompt_id?: string })?.prompt_id;
    if (!response.ok || !promptId) throw new ComfyPromptError(readTopLevelError(data) || i18n.t("comfyui.error.promptRejected"), []);
    return promptId;
}

/** An empty object means the prompt has not finished yet; a returned entry is always terminal. */
export async function fetchComfyHistory(baseUrl: string, promptId: string) {
    const base = requireBaseUrl(baseUrl);
    const data = await requestJson<Record<string, ComfyHistoryItem>>(base, `/history/${encodeURIComponent(promptId)}`);
    return data?.[promptId] as ComfyHistoryItem | undefined;
}

/** Running prompts are only visible here, which is what separates "queued" from "running". */
export async function fetchComfyQueue(baseUrl: string) {
    const base = requireBaseUrl(baseUrl);
    const data = await requestJson<{ queue_running?: unknown[]; queue_pending?: unknown[] }>(base, "/queue");
    return new Set(readQueuedPromptIds(data?.queue_running || []));
}

export async function downloadComfyOutput(baseUrl: string, file: ComfyOutputFile) {
    const base = requireBaseUrl(baseUrl);
    const params = new URLSearchParams({ filename: file.filename, subfolder: file.subfolder || "", type: file.type || "output" });
    const response = await send(base, `/view?${params.toString()}`, { method: "GET" }, COMFY_DOWNLOAD_TIMEOUT_MS);
    if (!response.ok) throw new Error(i18n.t("comfyui.error.downloadFailed", { filename: file.filename }));
    const blob = await response.blob();
    if (!blob.size) throw new Error(i18n.t("comfyui.error.downloadFailed", { filename: file.filename }));
    return { blob, contentType: response.headers.get("content-type") || blob.type || "" };
}

export function describeComfyError(error: unknown) {
    if (error instanceof ComfyPromptError) {
        const first = error.nodeErrors[0];
        if (!first) return error.message;
        const where = [first.classType, first.input].filter(Boolean).join(" · ");
        return [first.message, where, first.details].filter(Boolean).join("\n");
    }
    if (error instanceof Error) return error.message;
    return String(error);
}

function requireBaseUrl(value: string) {
    const base = normalizeComfyBaseUrl(value);
    if (!base) throw new Error(i18n.t("comfyui.error.missingUrl"));
    return base;
}

async function requestJson<T>(base: string, path: string) {
    const response = await send(base, path, { method: "GET" }, COMFY_REQUEST_TIMEOUT_MS);
    const data = await parseJson(response);
    if (!response.ok) throw new Error(readTopLevelError(data) || i18n.t("comfyui.error.http", { status: response.status }));
    return data as T;
}

/** The local proxy is the only escape hatch when ComfyUI does not allow the canvas origin. */
async function send(base: string, path: string, init: RequestInit, timeoutMs: number) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(withLocalProxy(`${base}${path}`), { ...init, signal: controller.signal, cache: "no-store" });
    } catch (error) {
        throw new Error(describeNetworkError(error));
    } finally {
        clearTimeout(timer);
    }
}

async function parseJson(response: Response) {
    const text = await response.text();
    if (!text) return null;
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(i18n.t(response.ok ? "comfyui.error.invalidJson" : "comfyui.error.http", { status: response.status }));
    }
}

function describeNetworkError(error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") return i18n.t("comfyui.error.timeout");
    // A blocked cross-origin request and a refused connection both surface as an opaque fetch failure.
    return i18n.t("comfyui.error.network");
}

function readNodeErrors(data: unknown): ComfyPromptNodeError[] {
    const nodeErrors = (data as { node_errors?: Record<string, unknown> })?.node_errors;
    if (!nodeErrors || typeof nodeErrors !== "object") return [];
    return Object.entries(nodeErrors).flatMap(([nodeId, entry]) => {
        const record = (entry || {}) as { errors?: unknown[]; class_type?: string };
        const classType = typeof record.class_type === "string" ? record.class_type : "";
        const errors = Array.isArray(record.errors) ? record.errors : [];
        return errors.map((item) => {
            const detail = (item || {}) as { message?: string; details?: string; extra_info?: { input_name?: string } };
            return {
                nodeId,
                classType,
                input: typeof detail.extra_info?.input_name === "string" ? detail.extra_info.input_name : undefined,
                message: detail.message || "",
                details: detail.details || "",
            };
        });
    });
}

function readTopLevelError(data: unknown) {
    const error = (data as { error?: { message?: string; details?: string; type?: string } })?.error;
    if (!error) return "";
    return [error.message || error.type, error.details].filter(Boolean).join("\n");
}

function readQueuedPromptIds(entries: unknown[]) {
    return entries
        .map((entry) => (Array.isArray(entry) ? entry[1] : undefined))
        .filter((promptId): promptId is string => typeof promptId === "string");
}

function conflictFreeName(name: string, mimeType: string) {
    const extension = extensionFor(name, mimeType);
    return `canvas-${nanoid(8)}${extension}`;
}

function extensionFor(name: string, mimeType: string) {
    const match = /\.([a-z0-9]+)$/i.exec(name || "");
    if (match) return `.${match[1].toLowerCase()}`;
    const known: Record<string, string> = {
        "audio/wav": ".wav", "audio/x-wav": ".wav", "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/ogg": ".ogg", "audio/webm": ".webm", "audio/flac": ".flac",
        "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
    };
    return known[mimeType.toLowerCase().split(";", 1)[0]] || (mimeType.startsWith("video/") ? ".mp4" : mimeType.startsWith("audio/") ? ".mp3" : ".png");
}
