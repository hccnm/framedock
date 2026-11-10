import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { CodexAppClient } from "./codex-client.js";
import { resolveCodexLaunch } from "../runtime/registry.js";
import { field, type JsonRecord } from "../utils/value.js";

export const codexImageInput = z.object({
    projectId: z.string().min(1), nodeId: z.string().min(1), requestId: z.string().min(1),
    prompt: z.string().trim().min(1),
    references: z.array(z.object({ name: z.string(), dataUrl: z.string().regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=\r\n]+$/) })),
    options: z.object({ size: z.string().optional(), quality: z.enum(["auto", "low", "medium", "high", "xhigh", "max"]).optional(), background: z.enum(["auto", "opaque", "transparent"]).optional(), count: z.number().int().positive().optional() }).strict().optional(),
}).strict();
export type CodexImageInput = z.infer<typeof codexImageInput>;
const noHistory = { record: async () => {}, recordTurn: async () => {} };

export function codexImagePrompt(input: CodexImageInput, references: string[], index: number, count: number) {
    const referenceText = references.map((file, i) => `参考图 ${i + 1}（${input.references[i].name}）：${file}`).join("\n");
    const options = input.options;
    return `请直接调用一次 Codex 内置 imagegen，生成第 ${index + 1}/${count} 张独立图片，不要拼成多图或联系表。\n` +
        `transparent_background 必须设为 ${options?.background === "transparent"}。` +
        (referenceText ? `请将以下全部参考图片通过 referenced_image_paths 传给生图工具，保持人物与用户要求一致：\n${referenceText}\n` : "本次没有参考图，请生成新图，不要引用先前 turn 的图片。\n") +
        (options?.size && options.size !== "auto" ? `用户期望尺寸/比例：${options.size}，请写入生图提示词；这不是工具的直接尺寸参数，不要声称精确控制像素。\n` : "") +
        (options?.quality && options.quality !== "auto" ? `用户期望画质：${options.quality}，请作为细节与渲染质量要求写入生图提示词。\n` : "") +
        `\n用户创作要求：\n${input.prompt}`;
}

/** 只读取原生生图 item 的输出字段，绝不递归扫描参考图或任意工具输出。 */
export async function readCodexImageOutput(item: JsonRecord) {
    if (item.failure || ["failed", "error", "cancelled"].includes(String(item.status))) throw new Error(String(field(item.failure, "message") || "Codex 内置生图失败"));
    if (typeof item.savedPath === "string") {
        const bytes = await readFile(item.savedPath);
        if (!bytes.length) throw new Error("Codex 返回了空图片");
        const extension = path.extname(item.savedPath).toLowerCase();
        const mime = ({ ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" } as Record<string, string>)[extension];
        if (!mime) throw new Error("Codex 返回了不支持的图片格式");
        return `data:${mime};base64,${bytes.toString("base64")}`;
    }
    if (typeof item.result === "string" && item.result) {
        if (/^data:image\/(png|jpeg|webp|gif);base64,/.test(item.result)) return item.result;
        if (/^[A-Za-z0-9+/=\r\n]+$/.test(item.result) && Buffer.from(item.result, "base64").length) return `data:image/png;base64,${item.result}`;
    }
    throw new Error(item.fileId ? "Codex 仅返回远端文件标识，没有可读取的图片；请更新本机 CLI 后重试" : "Codex 没有返回可读取的生成图片");
}

/** 每个节点任务独立 app-server，取消只结束该任务，不切换或中断助手对话。 */
export async function generateCodexImage(input: CodexImageInput, signal: AbortSignal, launch = resolveCodexLaunch) {
    signal.throwIfAborted();
    const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "framedock-image-")));
    let client: CodexAppClient | undefined;
    let threadId = "", turnId = "", responseText = "";
    const outputs = new Map<string, JsonRecord>();
    try {
        const references = await Promise.all(input.references.map(async (reference, index) => {
            const [, mime, encoded] = /^data:image\/(png|jpeg|webp|gif);base64,(.+)$/s.exec(reference.dataUrl)!;
            const file = path.join(directory, `reference-${index + 1}.${mime === "jpeg" ? "jpg" : mime}`);
            await writeFile(file, Buffer.from(encoded, "base64"), { mode: 0o600 });
            return file;
        }));
        client = await CodexAppClient.start((type, payload) => {
            if (type === "codex_approval") { client?.resolveApproval(String(field(payload, "requestId")), "decline"); return; }
            if (type !== "agent_event" || field(payload, "thread_id") !== threadId || field(payload, "type") !== "item.completed") return;
            const eventTurn = String(field(payload, "turn_id") || "");
            if (turnId && eventTurn !== turnId) return;
            const item = field(payload, "item") as JsonRecord | undefined;
            if (item?.type === "image_generation" && item.id) outputs.set(`${eventTurn}:${item.id}`, item);
            if (item?.type === "agent_message") responseText = String(item.text || "");
        }, () => {}, await launch(), noHistory, signal);
        signal.throwIfAborted();
        const { thread } = await client.startImageThread(directory);
        threadId = thread.id;
        const images: Array<{ itemId: string; dataUrl: string; revisedPrompt: string; turnId: string; transparentBackground?: boolean }> = [];
        const count = input.options?.count || 1;
        for (let index = 0; index < count; index++) {
            signal.throwIfAborted();
            outputs.clear(); responseText = ""; turnId = "";
            await client.startTurn(threadId, codexImagePrompt(input, references, index, count), references, "request", undefined, undefined, (id) => { turnId = id; });
            signal.throwIfAborted();
            const completed = [...outputs.entries()].filter(([key]) => key.startsWith(`${turnId}:`));
            if (!completed.length) throw new Error(responseText || "Codex 未调用内置生图工具，没有生成图片");
            if (completed.length !== 1) throw new Error("Codex 本次未按要求逐张生成，请重试");
            const [itemId, item] = completed[0];
            const dataUrl = await readCodexImageOutput(item);
            if (input.options?.background === "transparent" && item.transparentBackground !== true) throw new Error("Codex 没有使用原生透明背景参数，请重试");
            images.push({ itemId, dataUrl, revisedPrompt: String(item.revisedPrompt || ""), turnId, transparentBackground: typeof item.transparentBackground === "boolean" ? item.transparentBackground : undefined });
        }
        return { projectId: input.projectId, nodeId: input.nodeId, requestId: input.requestId, threadId, turnId, images };
    } finally {
        client?.stop();
        await rm(directory, { recursive: true, force: true });
    }
}
