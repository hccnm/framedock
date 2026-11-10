import { useCallback, useEffect, useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import i18n from "@/i18n";
import { nanoid } from "nanoid";

import { useAgentStore, type CanvasVideoFrameInput, type CanvasVideoFrameResult } from "@/stores/use-agent-store";
import { captureVideoFrame } from "@/lib/canvas/canvas-video-frame";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { imageMetadata } from "@/lib/canvas/canvas-node-factory";
import { deleteStoredImages, uploadImage } from "@/services/image-storage";
import { CanvasNodeType } from "@/types/canvas";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";

type GenerateNodeRef = MutableRefObject<((nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => Promise<void>) | null>;

type AgentBridgeParams = {
    projectId: string;
    ready: boolean;
    title: string | undefined;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    viewport: ViewportTransform;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    selectedNodeIdsRef: MutableRefObject<Set<string>>;
    viewportRef: MutableRefObject<ViewportTransform>;
    generateNodeRef: GenerateNodeRef;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
};

/**
 * Bridge between the canvas and local Agent: publish the current snapshot and apply/undo capabilities
 * to the Agent store for the local Codex panel. All members except applyAgentOps are internal.
 */
export function useAgentBridge(params: AgentBridgeParams) {
    const { projectId, title, nodes, connections, selectedNodeIds, viewport, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, generateNodeRef, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setViewport, setContextMenu } =
        params;
    const setAgentCanvasContext = useAgentStore((state) => state.setCanvasContext);
    const [agentUndoSnapshot, setAgentUndoSnapshot] = useState<CanvasAgentSnapshot | null>(null);
    const projectTitle = title || i18n.t("canvas.project.untitled");

    const agentSnapshot = useMemo<CanvasAgentSnapshot>(() => ({ projectId, title: projectTitle, nodes, connections, selectedNodeIds: Array.from(selectedNodeIds), viewport }), [connections, projectTitle, nodes, projectId, selectedNodeIds, viewport]);
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const before = { projectId, title: projectTitle, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
            const generationOps = safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId));
            const next = applyCanvasAgentOps(
                before,
                safeOps.filter((op) => op.type !== "run_generation"),
            );
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            setAgentUndoSnapshot(before);
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            if (generationOps.length) {
                queueMicrotask(() =>
                    generationOps.forEach((op) => {
                        const target = nodesRef.current.find((node) => node.id === op.nodeId);
                        const prompt = op.prompt?.trim() ? op.prompt : (target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                        void generateNodeRef.current?.(op.nodeId, op.mode || target?.metadata?.generationMode || "image", prompt);
                    }),
                );
            }
            return { ...next, projectId, title: projectTitle };
        },
        [projectTitle, projectId],
    );
    const undoAgentOps = useCallback(() => {
        if (!agentUndoSnapshot) return null;
        nodesRef.current = agentUndoSnapshot.nodes;
        connectionsRef.current = agentUndoSnapshot.connections;
        selectedNodeIdsRef.current = new Set(agentUndoSnapshot.selectedNodeIds);
        viewportRef.current = agentUndoSnapshot.viewport;
        setNodes(agentUndoSnapshot.nodes);
        setConnections(agentUndoSnapshot.connections);
        setSelectedNodeIds(new Set(agentUndoSnapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(agentUndoSnapshot.viewport);
        setContextMenu(null);
        setAgentUndoSnapshot(null);
        return { ...agentUndoSnapshot, projectId, title: projectTitle };
    }, [agentUndoSnapshot, projectTitle, projectId]);

    const captureAgentVideoFrame = useCallback(async (input: CanvasVideoFrameInput): Promise<CanvasVideoFrameResult> => {
        const context = useAgentStore.getState().canvasContext;
        if (!context || context.snapshot.projectId !== input.projectId || input.projectId !== projectId || context.applyOps !== applyAgentOps) throw new Error("当前创作页与指定 projectId 不一致");
        const node = nodesRef.current.find((item) => item.id === input.nodeId);
        if (node?.type !== CanvasNodeType.Video || !node.metadata?.content) throw new Error("指定节点不是可读取的视频节点");
        const video = Array.from(document.querySelectorAll<HTMLVideoElement>("video[data-canvas-video]")).find((item) => item.dataset.canvasVideo === input.nodeId);
        if (input.position === "current" && !video) throw new Error("请先让视频节点显示在画布中，并将播放器停在目标画面");
        const requestedTime = input.position === "time" ? input.time : video?.currentTime || 0;
        if (requestedTime === undefined) throw new Error("按时间截帧必须提供 time，单位为秒");
        const frame = await captureVideoFrame(node.metadata.content, input.position, requestedTime);
        const image = await uploadImage(frame.blob);
        let applied = false;
        try {
            const current = useAgentStore.getState().canvasContext;
            if (!current || current.snapshot.projectId !== projectId || current.applyOps !== applyAgentOps) throw new Error("截帧期间创作页已切换，请重试");
            const source = nodesRef.current.find((item) => item.id === input.nodeId);
            if (!source || source.type !== CanvasNodeType.Video || source.metadata?.content !== node.metadata.content || source.metadata?.storageKey !== node.metadata.storageKey) throw new Error("截帧期间视频节点已删除或内容已变化，请重试");
            const size = fitNodeSize(image.width, image.height, 420, 420);
            const nodeId = nanoid();
            const x = source.position.x + source.width + 96;
            let y = source.position.y + source.height / 2 - size.height / 2;
            while (nodesRef.current.some((item) => item.id !== source.id && item.position.x < x + size.width && item.position.x + item.width > x && item.position.y < y + size.height && item.position.y + item.height > y)) y += size.height + 24;
            const snapshot = applyAgentOps([
                { type: "add_node", id: nodeId, nodeType: CanvasNodeType.Image, title: i18n.t(`canvas.videoFrames.${input.position}Title`, { name: source.title || i18n.t("assets.kinds.video"), time: frame.time }), position: { x, y }, ...size, metadata: imageMetadata(image) },
                { type: "connect_nodes", fromNodeId: source.id, toNodeId: nodeId },
            ]);
            applied = true;
            return { projectId, sourceNodeId: source.id, nodeId, storageKey: image.storageKey, width: image.width, height: image.height, time: frame.time, snapshot };
        } finally {
            if (!applied && image.storageKey) await deleteStoredImages([image.storageKey]);
        }
    }, [projectId, applyAgentOps, nodesRef]);

    useEffect(() => () => setAgentCanvasContext(null), [projectId, setAgentCanvasContext]);

    useEffect(() => {
        setAgentCanvasContext(params.ready ? { snapshot: agentSnapshot, applyOps: applyAgentOps, captureVideoFrame: captureAgentVideoFrame, undoOps: undoAgentOps, canUndo: Boolean(agentUndoSnapshot) } : null);
    }, [params.ready, agentSnapshot, applyAgentOps, agentUndoSnapshot, setAgentCanvasContext, undoAgentOps, captureAgentVideoFrame]);

    return { applyAgentOps, captureAgentVideoFrame };
}
