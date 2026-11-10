import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { FileText, ImageIcon } from "lucide-react";

import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { ensureImagePreview, getImagePreviewRevision, previewUrlFor, resolveImageUrl, subscribeImagePreviews } from "@/services/image-storage";

type PreviewImage = { content: string; storageKey?: string; title: string };

export function CanvasProjectPreview({ nodes }: { nodes: CanvasNodeData[] }) {
    const images = useMemo(() => {
        const result: PreviewImage[] = [];
        const seen = new Set<string>();
        for (const node of nodes) {
            if (node.type !== CanvasNodeType.Image) continue;
            const metadata = node.metadata;
            const batch = metadata?.images ?? [];
            const primary = batch.find((image) => image.id === metadata?.primaryImageId) ?? batch[0];
            const candidates = [primary ?? { content: metadata?.content ?? "", storageKey: metadata?.storageKey }, ...batch];
            for (const image of candidates) {
                const key = image.storageKey || image.content;
                if (!key || seen.has(key)) continue;
                seen.add(key);
                result.push({ content: image.content, storageKey: image.storageKey, title: node.title });
                if (result.length === 3) return result;
            }
        }
        return result;
    }, [nodes]);
    const text = nodes.find((node) => node.type === CanvasNodeType.Text && node.metadata?.content?.trim())?.metadata?.content;

    return (
        <div className="flex aspect-[4/3] w-full min-w-0 gap-2.5 overflow-hidden p-4" aria-label="创作页内容预览">
            {images.length ? images.map((image) => <ProjectPreviewImage key={image.storageKey || image.content} image={image} />) : (
                <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-hidden rounded-xl px-3">
                    <FileText className="size-8 shrink-0 opacity-30" strokeWidth={1.2} aria-hidden="true" />
                    {text ? <p className="m-0 line-clamp-5 w-full whitespace-pre-wrap text-left text-sm leading-relaxed opacity-60">{text}</p> : <span className="text-xs opacity-40">空白创作页</span>}
                </div>
            )}
        </div>
    );
}

function ProjectPreviewImage({ image }: { image: PreviewImage }) {
    useSyncExternalStore(subscribeImagePreviews, getImagePreviewRevision);
    const [originalUrl, setOriginalUrl] = useState("");
    const [failedUrl, setFailedUrl] = useState("");
    useEffect(() => {
        let active = true;
        // 持久媒体先读缩略图；缓存尚未生成时恢复原图，避免使用上次运行的 blob 地址。
        void (async () => {
            const url = await ensureImagePreview(image.storageKey) || await resolveImageUrl(image.storageKey, image.storageKey && image.content.startsWith("blob:") ? "" : image.content);
            if (active) setOriginalUrl(url);
        })().catch(() => undefined);
        return () => { active = false; };
    }, [image.storageKey, image.content]);
    const url = previewUrlFor(image.storageKey) || originalUrl;

    return (
        <div className="flex min-w-0 flex-1 items-center justify-center overflow-hidden rounded-xl">
            {url && url !== failedUrl ? <img src={url} alt={image.title} loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" onError={() => setFailedUrl(url)} /> : <ImageIcon className="size-7 opacity-25" strokeWidth={1.2} aria-label="暂无可用预览" />}
        </div>
    );
}
