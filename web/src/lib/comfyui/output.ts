import type { ComfyOutput, ComfyOutputFile, ComfyOutputKind, ComfyWorkflow } from "@/types/comfyui";

export type ComfyHistoryItem = {
    outputs?: Record<string, Record<string, unknown>>;
    status?: { status_str?: string; completed?: boolean; messages?: unknown[] };
};

export type ComfyExecutionError = {
    nodeId: string;
    nodeType: string;
    exceptionType: string;
    message: string;
};

/** Output keys whose values are text rather than media files. */
const TEXT_OUTPUT_KEYS = new Set(["text", "texts", "string", "strings", "caption", "captions", "prompt", "prompts"]);

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "tiff", "tif", "avif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "mkv", "avi", "m4v"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus"]);

/** Class names carry no output policy: use selected nodes, metadata and actual file descriptors. */
export function collectComfyOutputs(outputs: Record<string, Record<string, unknown>> | undefined, classTypes: Record<string, string>, workflow?: Pick<ComfyWorkflow, "nodeInfo" | "outputNodeIds" | "outputKinds">): ComfyOutput[] {
    if (!outputs) return [];
    const formal: ComfyOutput[] = [],
        intermediate: ComfyOutput[] = [];
    for (const [nodeId, nodeOutputs] of Object.entries(outputs)) {
        if (!nodeOutputs || typeof nodeOutputs !== "object" || (workflow?.outputNodeIds && !workflow.outputNodeIds.includes(nodeId))) continue;
        const classType = classTypes[nodeId] || "";
        const info = workflow?.nodeInfo?.[classType];
        for (const [key, value] of Object.entries(nodeOutputs))
            for (const output of readOutputEntries(nodeId, classType, key, value, Boolean(info?.output?.includes("STRING") || workflow?.outputKinds?.includes("text")))) {
                if (output.kind === "file" && workflow?.outputKinds?.length === 1) output.kind = workflow.outputKinds[0];
                const preview = !workflow?.outputNodeIds && (output.file?.type === "temp" || info?.has_intermediate_output || info?.output_node === false);
                (preview ? intermediate : formal).push(output);
            }
    }
    return dedupeOutputs(formal.length ? formal : intermediate);
}

export function dedupeOutputs(outputs: ComfyOutput[]) {
    const seen = new Set<string>();
    return outputs.filter((output) => {
        const key = outputKey(output);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export function outputKey(output: ComfyOutput) {
    if (output.kind === "text") return `text:${output.nodeId}:${output.text}`;
    return `file:${output.nodeId}:${output.file?.filename}:${output.file?.subfolder || ""}:${output.file?.type || ""}`;
}

/** Classifies a downloaded file, preferring the response MIME type when it disagrees with the name. */
export function refineOutputKind(output: ComfyOutput, contentType: string): ComfyOutputKind {
    const mime = contentType.toLowerCase();
    if (mime.startsWith("text/") || mime === "application/json") return "text";
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    if (output.kind === "file") throw new Error(`无法识别输出文件类型：${output.file?.filename || output.nodeId}，请配置工作流输出类型`);
    return output.kind;
}

export function readExecutionError(item: ComfyHistoryItem | undefined): ComfyExecutionError | undefined {
    const messages = item?.status?.messages;
    if (!Array.isArray(messages)) return undefined;
    for (const entry of messages) {
        if (!Array.isArray(entry) || entry[0] !== "execution_error") continue;
        const payload = (entry[1] || {}) as Record<string, unknown>;
        return {
            nodeId: typeof payload.node_id === "string" ? payload.node_id : "",
            nodeType: typeof payload.node_type === "string" ? payload.node_type : "",
            exceptionType: typeof payload.exception_type === "string" ? payload.exception_type : "",
            message: typeof payload.exception_message === "string" ? payload.exception_message.trim() : "",
        };
    }
    return undefined;
}

/** A history entry only appears once a prompt finished, so its presence is the terminal signal. */
export function readHistoryStatus(item: ComfyHistoryItem | undefined) {
    if (!item) return "pending" as const;
    if (item.status?.status_str === "error") return "error" as const;
    if (readExecutionError(item)) return "error" as const;
    return "success" as const;
}

function readOutputEntries(nodeId: string, classType: string, key: string, value: unknown, strings = false): ComfyOutput[] {
    const items = Array.isArray(value) ? value : [value];
    const results: ComfyOutput[] = [];
    for (const item of items) {
        const file = readOutputFile(item);
        if (file) {
            results.push({ kind: classifyOutputKind(key, file.filename), nodeId, classType, file });
            continue;
        }
        const text = readOutputText(key, item, strings);
        if (text) results.push({ kind: "text", nodeId, classType, text });
    }
    return results;
}

function readOutputFile(item: unknown): ComfyOutputFile | undefined {
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.filename !== "string" || !candidate.filename) return undefined;
    const type = candidate.type;
    return {
        filename: candidate.filename,
        subfolder: typeof candidate.subfolder === "string" ? candidate.subfolder : "",
        type: type === "input" || type === "output" || type === "temp" ? type : "output",
    };
}

function readOutputText(key: string, item: unknown, strings = false): string | undefined {
    if (!strings && !TEXT_OUTPUT_KEYS.has(key.toLowerCase())) return undefined;
    if (typeof item === "string") return item.trim() ? item : undefined;
    if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
    const candidate = item as Record<string, unknown>;
    for (const field of ["text", "value"]) {
        if (typeof candidate[field] === "string" && (candidate[field] as string).trim()) return candidate[field] as string;
    }
    return undefined;
}

/** The output key is more reliable than the extension for video nodes that also emit animated images. */
function classifyOutputKind(key: string, filename: string): ComfyOutput["kind"] {
    const lowerKey = key.toLowerCase();
    if (lowerKey.includes("video") || lowerKey === "gifs") return "video";
    if (lowerKey.includes("audio") || lowerKey.includes("sound")) return "audio";
    const extension = filename.split(".").pop()?.toLowerCase() || "";
    if (VIDEO_EXTENSIONS.has(extension)) return "video";
    if (AUDIO_EXTENSIONS.has(extension)) return "audio";
    if (IMAGE_EXTENSIONS.has(extension)) return "image";
    return "file";
}
