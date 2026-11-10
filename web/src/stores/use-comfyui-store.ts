import { localForageStorage } from "@/lib/localforage-storage";
import { nanoid } from "nanoid";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { clampComfyPollSeconds, DEFAULT_COMFY_POLL_SECONDS } from "@/lib/comfyui/poll";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "@/types/canvas";
import type { ComfyPresetRoles, ComfyWorkflow } from "@/types/comfyui";

const EMPTY_COMFY_PRESET_ROLES: ComfyPresetRoles = { text: "", enhance: "", edit: "" };

type ComfyUiStore = {
    hydrated: boolean;
    baseUrl: string;
    presetWorkflowIds: ComfyPresetRoles;
    workflows: ComfyWorkflow[];
    pollIntervalSeconds: number;
    setBaseUrl: (baseUrl: string) => void;
    setPollIntervalSeconds: (seconds: number) => void;
    setPresetWorkflowId: (mode: keyof ComfyPresetRoles, workflowId: string) => void;
    addWorkflow: (workflow: ComfyWorkflow) => void;
    updateWorkflow: (id: string, patch: Partial<Pick<ComfyWorkflow, "name" | "description" | "fields" | "workflow" | "outputKinds" | "nodeInfo" | "referenceGroups" | "outputNodeIds" | "diagnostics">>) => void;
    duplicateWorkflow: (id: string) => void;
    deleteWorkflow: (id: string) => void;
};

export const useComfyUiStore = create<ComfyUiStore>()(
    persist(
        (set) => ({
            hydrated: false,
            baseUrl: "",
            presetWorkflowIds: EMPTY_COMFY_PRESET_ROLES,
            workflows: [],
            pollIntervalSeconds: DEFAULT_COMFY_POLL_SECONDS,
            setBaseUrl: (baseUrl) => set({ baseUrl }),
            setPollIntervalSeconds: (seconds) => set({ pollIntervalSeconds: clampComfyPollSeconds(seconds) }),
            setPresetWorkflowId: (mode, workflowId) => set((state) => ({ presetWorkflowIds: { ...state.presetWorkflowIds, [mode]: workflowId } })),
            addWorkflow: (workflow) => set((state) => ({ workflows: [workflow, ...state.workflows.filter((item) => item.id !== workflow.id)] })),
            updateWorkflow: (id, patch) =>
                set((state) => ({
                    workflows: state.workflows.map((workflow) => (workflow.id === id ? { ...workflow, ...patch, updatedAt: new Date().toISOString() } : workflow)),
                })),
            duplicateWorkflow: (id) =>
                set((state) => {
                    const source = state.workflows.find((workflow) => workflow.id === id);
                    if (!source) return state;
                    const copy: ComfyWorkflow = {
                        ...structuredClone(source),
                        id: nanoid(),
                        aliasIds: [],
                        name: `${source.name} 2`,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                    };
                    return { workflows: [copy, ...state.workflows] };
                }),
            deleteWorkflow: (id) =>
                set((state) => ({
                    workflows: state.workflows.filter((workflow) => workflow.id !== id),
                    presetWorkflowIds: Object.fromEntries(Object.entries(state.presetWorkflowIds).map(([mode, workflowId]) => [mode, workflowId === id ? "" : workflowId])) as ComfyPresetRoles,
                })),
        }),
        {
            name: "framedock:comfyui_store",
            storage: createJSONStorage(() => localForageStorage),
            partialize: (state) => ({ baseUrl: state.baseUrl, presetWorkflowIds: state.presetWorkflowIds, workflows: state.workflows, pollIntervalSeconds: state.pollIntervalSeconds }),
            onRehydrateStorage: () => () => {
                useComfyUiStore.setState({ hydrated: true });
            },
        },
    ),
);

export function getComfyWorkflow(id?: string) {
    if (!id) return undefined;
    return useComfyUiStore.getState().workflows.find((workflow) => workflow.id === id || workflow.aliasIds?.includes(id));
}

export function replaceComfyData(data: { baseUrl: string; presetWorkflowIds: ComfyPresetRoles; workflows: ComfyWorkflow[] }) {
    useComfyUiStore.setState(data);
}

/** Deleting a workflow that nodes still point at must warn first; the nodes keep the missing ID. */
export function countComfyWorkflowReferences(workflowId: string) {
    return useCanvasStore
        .getState()
        .projects.reduce((total, project) => total + project.nodes.filter((node) => node.type === CanvasNodeType.ComfyUI && (node.metadata?.comfyWorkflowId === workflowId || getComfyWorkflow(node.metadata?.comfyWorkflowId)?.id === workflowId)).length, 0);
}
