import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { audioMetadata, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import type { CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { deleteStoredMedia, getMediaBlob, uploadMediaFile } from "@/services/file-storage";
import { deleteStoredImages, getImageBlob, uploadImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeMetadata } from "@/types/canvas";

type MediaInput = {
    projectId: string;
    nodeId: string;
    nodeType: "image" | "video" | "audio";
    title: string;
    dataUrl: string;
    sha256?: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    metadata?: Record<string, unknown>;
};

async function sha256(blob: Blob) {
    if (!globalThis.crypto?.subtle) throw new Error("当前环境无法核验媒体 SHA-256");
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Store one supplied media file through the same storage services as canvas upload. */
export async function prepareAgentCanvasMedia(input: MediaInput) {
    if (!new RegExp(`^data:${input.nodeType}/[a-z0-9.+-]+;base64,`, "i").test(input.dataUrl)) throw new Error("媒体 data URL 的类型与节点类型不一致");
    const response = await fetch(input.dataUrl);
    if (!response.ok) throw new Error("无法读取媒体数据");
    const blob = await response.blob();
    if (!blob.size || !blob.type.startsWith(`${input.nodeType}/`)) throw new Error("媒体为空或格式不匹配");
    const expected = input.sha256?.toLowerCase();
    if (expected && await sha256(blob) !== expected) throw new Error("媒体 SHA-256 与输入不一致");

    let storageKey = "";
    const discard = async () => {
        if (!storageKey) return;
        if (input.nodeType === "image") await deleteStoredImages([storageKey]);
        else await deleteStoredMedia([storageKey]);
    };
    try {
        const uploaded = input.nodeType === "image" ? await uploadImage(blob) : await uploadMediaFile(blob, input.nodeType);
        storageKey = uploaded.storageKey || "";
        if (!storageKey) throw new Error("媒体未获得持久化存储键");
        const stored = input.nodeType === "image" ? await getImageBlob(storageKey) : await getMediaBlob(storageKey);
        if (!stored || stored.size !== blob.size || (expected && await sha256(stored) !== expected)) throw new Error("媒体保存后字节校验失败");
        const mediaMetadata = input.nodeType === "image" ? imageMetadata(uploaded as Awaited<ReturnType<typeof uploadImage>>) : input.nodeType === "video" ? videoMetadata(uploaded as Awaited<ReturnType<typeof uploadMediaFile>>) : audioMetadata(uploaded as Awaited<ReturnType<typeof uploadMediaFile>>);
        const naturalWidth = uploaded.width || 1280;
        const naturalHeight = uploaded.height || 720;
        const spec = NODE_DEFAULT_SIZE[input.nodeType === "image" ? CanvasNodeType.Image : input.nodeType === "video" ? CanvasNodeType.Video : CanvasNodeType.Audio];
        const size = input.nodeType === "audio" ? { width: input.width || spec.width, height: input.height || spec.height } : fitNodeSize(naturalWidth, naturalHeight, input.width || spec.width, input.height || spec.height);
        const op: CanvasAgentOp = {
            type: "add_node", id: input.nodeId, nodeType: input.nodeType, title: input.title,
            position: { x: input.x, y: input.y }, ...size,
            metadata: { ...input.metadata, ...(expected ? { assetSha256: expected } : {}), ...mediaMetadata } as CanvasNodeMetadata,
        };
        return { op, storageKey, bytes: blob.size, mimeType: blob.type, sha256: expected, discard };
    } catch (error) {
        await discard();
        throw error;
    }
}
