import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type CanvasProjectSnapshot = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

type CanvasProjectBridge = {
    projectId: string;
    read: () => CanvasProjectSnapshot;
    write: (updater: (current: CanvasProjectSnapshot) => CanvasProjectSnapshot) => void;
};

/**
 * The canvas editor keeps its own copy of the open project and writes that copy back to the store,
 * so background tasks cannot patch the store directly: the next render would overwrite them.
 * The editor registers itself here and every outside writer goes through these two functions.
 */
let bridge: CanvasProjectBridge | null = null;

export function setCanvasProjectBridge(next: CanvasProjectBridge | null) {
    bridge = next;
}

export function readCanvasProject(projectId: string): CanvasProjectSnapshot | null {
    if (bridge?.projectId === projectId) return bridge.read();
    const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
    return project ? { nodes: project.nodes, connections: project.connections } : null;
}

export function updateCanvasProject(projectId: string, updater: (current: CanvasProjectSnapshot) => CanvasProjectSnapshot) {
    if (bridge?.projectId === projectId) {
        bridge.write(updater);
        return;
    }
    const store = useCanvasStore.getState();
    const project = store.projects.find((item) => item.id === projectId);
    if (!project) return;
    store.updateProject(projectId, updater({ nodes: project.nodes, connections: project.connections }));
}
