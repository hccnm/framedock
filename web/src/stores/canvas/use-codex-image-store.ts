import { nanoid } from "nanoid";
import { create } from "zustand";
import { buildNodeGenerationContext, hydrateNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { readCanvasProject, updateCanvasProject } from "@/lib/canvas/canvas-project-bridge";
import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { getGenerationCount } from "@/lib/canvas/canvas-generation-helpers";
import { useConfigStore } from "@/stores/use-config-store";
import { generateCodexNodeImage } from "@/services/api/codex-image";
import { deleteStoredImages, uploadImage } from "@/services/image-storage";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

export const CODEX_IMAGE_MODEL = "__codex_builtin_image__";
export const CODEX_IMAGE_OPTIONS = [{ value: CODEX_IMAGE_MODEL, label: "Codex（本机）" }];
export const isCodexImageNode = (node: CanvasNodeData) => node.metadata?.imageChannel === "codex" && (node.type === CanvasNodeType.Image || (node.type === CanvasNodeType.Config && (node.metadata.generationMode || "image") === "image"));
const taskKey = (projectId: string, nodeId: string) => `${projectId}:${nodeId}`;
const controllers = new Map<string, AbortController>();
export const useCodexImageStore = create<{ running: Record<string, boolean> }>(() => ({ running: {} }));
export const isCodexImageRunning = (projectId: string, nodeId: string) => Boolean(useCodexImageStore.getState().running[taskKey(projectId, nodeId)]);

export function cancelCodexImageNode(projectId: string, nodeId: string) {
    controllers.get(taskKey(projectId, nodeId))?.abort();
}

/** 按任务开始时的作品与节点写回；切页不切换目标，删除或撤销节点后不再插入结果。 */
export async function runCodexImageNode(projectId: string, nodeId: string, prompt?: string) {
    const key = taskKey(projectId, nodeId);
    if (controllers.has(key)) return;
    const project = readCanvasProject(projectId);
    const node = project?.nodes.find((item) => item.id === nodeId && isCodexImageNode(item));
    if (!project || !node) return;
    const config = useConfigStore.getState().config;
    const controller = new AbortController();
    const requestId = nanoid();
    controllers.set(key, controller);
    useCodexImageStore.setState((state) => ({ running: { ...state.running, [key]: true } }));
    const uploaded: string[] = [];
    let committed = false;
    const patch = (run: Partial<NonNullable<CanvasNodeMetadata["codexImageRun"]>>, initial = false) => updateCanvasProject(projectId, (current) => ({ ...current,
        nodes: current.nodes.map((item) => item.id === nodeId && isCodexImageNode(item) && (initial || item.metadata?.codexImageRun?.requestId === requestId)
            ? { ...item, metadata: { ...item.metadata, codexImageRun: { ...item.metadata?.codexImageRun, requestId, status: "preparing", error: undefined, ...run } } } : item),
    }));
    const currentNode = () => readCanvasProject(projectId)?.nodes.find((item) => item.id === nodeId && isCodexImageNode(item) && item.metadata?.codexImageRun?.requestId === requestId);
    patch({ status: "preparing" }, true);
    try {
        const input = buildNodeGenerationContext(nodeId, project.nodes, project.connections, prompt ?? node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
        if (node.type === CanvasNodeType.Image && node.metadata?.content) {
            input.referenceImages = [...new Map([{ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey }, ...input.referenceImages].map((image) => [image.id, image])).values()];
        }
        const context = await hydrateNodeGenerationContext(input);
        controller.signal.throwIfAborted();
        if (!currentNode()) return;
        if (!context.prompt.trim()) throw new Error("请输入提示词，或连接一个文本节点");
        if (context.referenceVideos.length || context.referenceAudios.length) throw new Error("Codex 生图支持文本和图片输入，请先将视频截帧为图片");
        if (context.referenceImages.some((image) => !/^data:image\//.test(image.dataUrl || ""))) throw new Error("有参考图无法读取，请检查连接的图片是否仍可用");
        patch({ status: "running" });
        const result = await generateCodexNodeImage({ projectId, nodeId, requestId, prompt: context.prompt,
            references: context.referenceImages.map((image) => ({ name: image.name, dataUrl: image.dataUrl! })),
            options: { size: node.metadata?.size || config.size, quality: node.metadata?.quality || config.quality, background: node.metadata?.background || config.background || "auto", count: getGenerationCount(String(node.metadata?.count || config.canvasImageCount || config.count)) },
        }, controller.signal);
        controller.signal.throwIfAborted();
        if (!currentNode()) return;
        if (result.projectId !== projectId || result.nodeId !== nodeId || result.requestId !== requestId || !result.threadId || !result.turnId) throw new Error("生图结果不属于当前节点任务，已停止导入");
        if (!result.images?.length) throw new Error("Codex 没有返回生成图片");
        patch({ status: "saving", threadId: result.threadId, turnId: result.turnId });
        const outputNodes: CanvasNodeData[] = [];
        for (const image of result.images) {
            controller.signal.throwIfAborted();
            if (!image.itemId || outputNodes.some((item) => item.id === `${requestId}:${image.itemId}`)) continue;
            const saved = await uploadImage(image.dataUrl);
            if (saved.storageKey) uploaded.push(saved.storageKey);
            outputNodes.push({ id: `${requestId}:${image.itemId}`, type: CanvasNodeType.Image, title: `Codex · ${node.title} · ${outputNodes.length + 1}`,
                position: { x: 0, y: 0 }, ...fitNodeSize(saved.width, saved.height), metadata: { ...imageMetadata(saved), prompt: image.revisedPrompt || context.prompt, imageChannel: "codex", size: `${saved.width}x${saved.height}`, quality: node.metadata?.quality || config.quality, background: image.transparentBackground ? "transparent" : "opaque", count: 1 },
            });
        }
        controller.signal.throwIfAborted();
        if (!outputNodes.length) throw new Error("Codex 返回的图片缺少结果标识");
        updateCanvasProject(projectId, (current) => {
            const source = current.nodes.find((item) => item.id === nodeId && isCodexImageNode(item) && item.metadata?.codexImageRun?.requestId === requestId);
            if (!source) return current;
            const previousIds = source.metadata?.codexImageRun?.outputNodeIds || [];
            let x = Math.max(source.position.x + source.width, ...current.nodes.filter((item) => previousIds.includes(item.id)).map((item) => item.position.x + item.width)) + 80;
            const positioned = outputNodes.map((item) => { const next = { ...item, position: { x, y: source.position.y } }; x += item.width + 40; return next; });
            committed = true;
            return {
                nodes: [...current.nodes.map((item) => item.id === nodeId ? { ...item, metadata: { ...item.metadata, codexImageRun: { requestId, status: "success" as const, threadId: result.threadId, turnId: result.turnId, outputNodeIds: [...previousIds, ...positioned.map((output) => output.id)] } } } : item), ...positioned],
                connections: [...current.connections, ...positioned.map((item) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: item.id }))],
            };
        });
    } catch (error) {
        patch({ status: controller.signal.aborted ? "cancelled" : "error", error: controller.signal.aborted ? undefined : error instanceof Error ? error.message : String(error) });
    } finally {
        if (!committed && uploaded.length) await deleteStoredImages(uploaded).catch(() => undefined);
        controllers.delete(key);
        useCodexImageStore.setState((state) => { const running = { ...state.running }; delete running[key]; return { running }; });
    }
}
