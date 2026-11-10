import localforage from "localforage";
import { useCallback } from "react";
import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";

import { resolveImageUrl } from "@/services/image-storage";
import type { ComfyWorkbenchSnapshot } from "@/hooks/use-comfy-workbench";
import type { ComfyMediaValue } from "@/lib/comfyui/mapping";
import type { ReferenceImage } from "@/types/image";

export type WorkbenchKind = "image" | "video";
export type WorkbenchDraft = {
    prompt: string;
    references: ReferenceImage[];
    method: string;
    selection: ComfyWorkbenchSnapshot;
    uploadedMedia: Record<string, ComfyMediaValue>;
};
const emptyDraft = (): WorkbenchDraft => ({ prompt: "", references: [], method: "api", selection: { workflowId: "", values: {}, promptFieldId: "" }, uploadedMedia: {} });
type SavedDrafts = { image: WorkbenchDraft; video: WorkbenchDraft };
type DraftStore = SavedDrafts & {
    hydrated: boolean;
    error: string;
    updateDraft: (kind: WorkbenchKind, patch: Partial<WorkbenchDraft>) => void;
};

// 使用 IndexedDB 的结构化存储保留上传的 Blob，持久引用不保存运行时 blob: URL。
const files = localforage.createInstance({ name: "framedock", storeName: "workbench_drafts" });
let writable = false;
let pending: Promise<unknown> = Promise.resolve();
const storage: PersistStorage<SavedDrafts> = {
    getItem: async (name) => {
        const saved = await files.getItem<{ state: SavedDrafts; version?: number }>(name);
        if (saved) for (const kind of ["image", "video"] as const) {
            saved.state[kind].references = await Promise.all(saved.state[kind].references.map(async (reference) => ({ ...reference, dataUrl: await resolveImageUrl(reference.storageKey, reference.dataUrl) })));
            saved.state[kind].uploadedMedia = Object.fromEntries(await Promise.all(Object.entries(saved.state[kind].uploadedMedia).map(async ([id, media]) => [id, { ...media, url: media.storageKey ? await resolveImageUrl(media.storageKey) : media.url }])));
        }
        writable = true;
        return saved;
    },
    setItem: (name, value) => {
        if (!writable) return;
        const state = Object.fromEntries((["image", "video"] as const).map((kind) => [kind, {
            ...value.state[kind],
            references: value.state[kind].references.map((reference) => ({ ...reference, dataUrl: reference.storageKey ? "" : reference.dataUrl })),
            uploadedMedia: Object.fromEntries(Object.entries(value.state[kind].uploadedMedia).map(([id, media]) => [id, { ...media, url: media.storageKey ? undefined : media.url }])),
            selection: { ...value.state[kind].selection, media: undefined },
        }])) as SavedDrafts;
        const write = pending.then(() => files.setItem(name, { ...value, state }));
        pending = write.catch(() => undefined);
        return write.then(() => undefined).catch(() => { writable = false; useWorkbenchDraftStore.setState({ error: "工作台内容保存失败，请检查本地存储空间。" }); });
    },
    removeItem: (name) => files.removeItem(name),
};

export const useWorkbenchDraftStore = create<DraftStore>()(persist(
    (set) => ({
        image: emptyDraft(),
        video: emptyDraft(),
        hydrated: false,
        error: "",
        updateDraft: (kind, patch) => set((state) => ({ [kind]: { ...state[kind], ...patch } })),
    }),
    {
        name: "framedock:workbench_drafts",
        storage,
        partialize: ({ image, video }) => ({ image, video }),
        onRehydrateStorage: () => (_state, error) => {
            useWorkbenchDraftStore.setState({ hydrated: true, error: error ? "工作台内容读取失败，已暂停保存以保护原内容。" : "" });
        },
    },
));

/** 保持页面原有 setter 调用方式，状态直接写入共享草稿。 */
export function useWorkbenchDraftField<K extends keyof WorkbenchDraft>(kind: WorkbenchKind, field: K) {
    const value = useWorkbenchDraftStore((state) => state[kind][field]);
    const setValue = useCallback((next: WorkbenchDraft[K] | ((current: WorkbenchDraft[K]) => WorkbenchDraft[K])) => {
        const current = useWorkbenchDraftStore.getState()[kind][field];
        useWorkbenchDraftStore.getState().updateDraft(kind, { [field]: typeof next === "function" ? next(current) : next });
    }, [kind, field]);
    return [value, setValue] as const;
}
