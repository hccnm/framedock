import "./browser-globals";

import { beforeEach, describe, expect, mock, test } from "bun:test";

/** Workflow templates live in their own localforage store, which has no IndexedDB in Bun. */
const persisted = new Map<string, string>();
const instance = {
    getItem: async (key: string) => persisted.get(key) ?? null,
    setItem: async (key: string, value: string) => void persisted.set(key, value),
    removeItem: async (key: string) => void persisted.delete(key),
};
mock.module("localforage", () => ({ default: { config: () => {}, createInstance: () => instance } }));

const { countComfyWorkflowReferences, getComfyWorkflow, replaceComfyData, useComfyUiStore } = await import("../src/stores/use-comfyui-store");
const { hasResumableComfyRun } = await import("../src/lib/canvas/canvas-generation-helpers");
const { useCanvasStore } = await import("../src/stores/canvas/use-canvas-store");
const { CanvasNodeType } = await import("../src/types/canvas");

const workflow = (id: string, name: string, updatedAt = "2026-01-01T00:00:00.000Z") => ({ id, name, description: "", workflow: {}, fields: [], createdAt: updatedAt, updatedAt });

const node = (patch: Record<string, unknown>) => ({ id: "n1", type: CanvasNodeType.ComfyUI, position: { x: 0, y: 0 }, width: 340, height: 240, metadata: patch }) as never;

beforeEach(() => {
    useComfyUiStore.setState({ workflows: [], presetWorkflowIds: { text: "", enhance: "", edit: "" } });
});

describe("workflow management", () => {
    test("saves, updates and keeps the newest first", () => {
        const store = useComfyUiStore.getState();
        store.addWorkflow(workflow("w1", "文生图") as never);
        store.addWorkflow(workflow("w2", "放大") as never);
        expect(useComfyUiStore.getState().workflows.map((item) => item.id)).toEqual(["w2", "w1"]);

        useComfyUiStore.getState().updateWorkflow("w1", { name: "文生图 v2" });
        expect(getComfyWorkflow("w1")?.name).toBe("文生图 v2");
    });

    test("saving an existing ID replaces it instead of duplicating", () => {
        useComfyUiStore.getState().addWorkflow(workflow("w1", "旧") as never);
        useComfyUiStore.getState().addWorkflow(workflow("w1", "新") as never);
        expect(useComfyUiStore.getState().workflows).toHaveLength(1);
        expect(getComfyWorkflow("w1")?.name).toBe("新");
    });

    test("duplicates under a new ID and leaves the source alone", () => {
        useComfyUiStore.getState().addWorkflow({ ...workflow("w1", "文生图"), fields: [{ id: "3:seed" }] } as never);
        useComfyUiStore.getState().duplicateWorkflow("w1");

        const [copy, source] = useComfyUiStore.getState().workflows;
        expect(copy.id).not.toBe("w1");
        expect(copy.name).toBe("文生图 2");
        expect(copy.fields).toEqual(source.fields);
        expect(copy.fields).not.toBe(source.fields);
    });

    test("deleting clears the preset bindings that pointed at it", () => {
        useComfyUiStore.getState().addWorkflow(workflow("w1", "文生图") as never);
        useComfyUiStore.getState().setPresetWorkflowId("text", "w1");
        useComfyUiStore.getState().setPresetWorkflowId("edit", "w1");
        useComfyUiStore.getState().deleteWorkflow("w1");

        expect(getComfyWorkflow("w1")).toBeUndefined();
        expect(useComfyUiStore.getState().presetWorkflowIds).toEqual({ text: "", enhance: "", edit: "" });
    });

    test("a node keeps its workflow ID and reads as missing after deletion", () => {
        useComfyUiStore.getState().addWorkflow(workflow("w1", "文生图") as never);
        expect(getComfyWorkflow("w1")).toBeDefined();
        useComfyUiStore.getState().deleteWorkflow("w1");
        // The node is not silently repointed at another template.
        expect(getComfyWorkflow("w1")).toBeUndefined();
        expect(getComfyWorkflow(undefined)).toBeUndefined();
    });

    test("counts the canvas nodes that still reference a workflow", () => {
        useCanvasStore.setState({
            projects: [
                { id: "p1", nodes: [node({ comfyWorkflowId: "w1" }), node({ comfyWorkflowId: "w2" })], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "dots", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 }, title: "p", createdAt: "", updatedAt: "" },
                { id: "p2", nodes: [node({ comfyWorkflowId: "w1" })], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "dots", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 }, title: "p", createdAt: "", updatedAt: "" },
            ] as never,
        });
        expect(countComfyWorkflowReferences("w1")).toBe(2);
        expect(countComfyWorkflowReferences("w3")).toBe(0);
    });

    test("applying synced data replaces the workflow library", () => {
        replaceComfyData({ baseUrl: "http://host:8188", presetWorkflowIds: { text: "w9", enhance: "", edit: "" }, workflows: [workflow("w9", "远端")] as never });
        expect(getComfyWorkflow("w9")?.name).toBe("远端");
        expect(useComfyUiStore.getState().presetWorkflowIds.text).toBe("w9");
    });
});

describe("resuming a run after a refresh", () => {
    test("resumes a prompt that has not reached a terminal status", () => {
        ["uploading", "queued", "running", "processing", undefined].forEach((status) => {
            expect(hasResumableComfyRun(node({ comfyPromptId: "p1", comfyRunStatus: status }))).toBe(true);
        });
    });

    test("never re-runs a finished or failed prompt", () => {
        expect(hasResumableComfyRun(node({ comfyPromptId: "p1", comfyRunStatus: "success" }))).toBe(false);
        expect(hasResumableComfyRun(node({ comfyPromptId: "p1", comfyRunStatus: "error" }))).toBe(false);
    });

    test("ignores nodes without a prompt ID and other node types", () => {
        expect(hasResumableComfyRun(node({ comfyRunStatus: "running" }))).toBe(false);
        expect(hasResumableComfyRun({ id: "t1", type: CanvasNodeType.Text, metadata: { comfyPromptId: "p1", comfyRunStatus: "running" } } as never)).toBe(false);
    });
});
