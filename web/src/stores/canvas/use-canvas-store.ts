import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { localForageStorage } from "@/lib/localforage-storage";
import { desktopBridge } from "@/lib/desktop-host";
import type { DesktopProjectLocation, DesktopProjectPayload } from "@/types/desktop-host";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";

export type CanvasProject = {
    id: string;
    title: string;
    projectFolderId: string | null;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

export type CanvasDeletedProject = {
    id: string;
    deletedAt: string;
};

export type ProjectFolder = { id: string; name: string; createdAt: string; updatedAt: string };

export function normalizeProjectName(name: string) {
    const value = Array.from(name.trim()).slice(0, 50).join("");
    if (!value) throw new Error("名称不能为空");
    return value;
}

type CanvasStore = {
    projectFolders: ProjectFolder[];
    directoryLocations: DesktopProjectLocation[];
    saveError: string | null;
    saveProjectDirectory: (id: string) => Promise<boolean>;
    openProjectDirectory: () => Promise<string | null>;
    createDirectoryFolder: (name: string, directory: string) => Promise<string>;
    createProjectFolder: (name: string) => string;
    renameProjectFolder: (id: string, name: string) => void;
    dissolveProjectFolder: (id: string) => void;
    assignProjectFolder: (id: string, folderId: string | null) => void;
    hydrated: boolean;
    projects: CanvasProject[];
    deletedProjects: CanvasDeletedProject[];
    createProject: (title?: string, projectFolderId?: string | null) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[], deletedProjects?: CanvasDeletedProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "framedock:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects" | "deletedProjects" | "projectFolders">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
let queuedValue: StorageValue<CanvasStore> | null = null;
let persistenceReady = false;
let pendingSave: Promise<void> = Promise.resolve();

export function flushCanvasStorage(): Promise<void> {
    if (typeof window !== "undefined") window.dispatchEvent(new Event("framedock:flush-canvas"));
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    const result = pendingSave.catch(() => undefined).then(async () => {
        try {
            while (queuedValue) {
                const value = queuedValue;
                await localForageStorage.setItem(CANVAS_STORE_KEY, JSON.stringify(value));
                const host = desktopBridge();
                if (host) {
                    await host.projects.sync(value.state);
                    useCanvasStore.setState({ directoryLocations: await host.projects.locations() });
                }
                if (queuedValue === value) queuedValue = null;
            }
            useCanvasStore.setState({ saveError: null });
        } catch (error) {
            useCanvasStore.setState({ saveError: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    });
    pendingSave = result;
    return result;
}

async function projectPayload(id: string): Promise<DesktopProjectPayload> {
    const state = useCanvasStore.getState();
    const folder = state.projectFolders.find((item) => item.id === id) ?? null;
    const page = state.projects.find((item) => item.id === id);
    if (!folder && !page) throw new Error("项目不存在");
    if (page?.projectFolderId) return projectPayload(page.projectFolderId);
    return { folder, pages: folder ? state.projects.filter((item) => item.projectFolderId === id) : [page!] };
}

function requireDirectoryHost() {
    const host = desktopBridge();
    if (!host) throw new Error("项目目录需要桌面应用");
    return host;
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        if (!persistenceReady) return;
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects && queuedPersistState.deletedProjects === nextState.deletedProjects && queuedPersistState.projectFolders === nextState.projectFolders) return;
        queuedPersistState = nextState;
        queuedValue = value;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { void flushCanvasStorage().catch(() => undefined); }, 400);
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projectFolders: [],
            directoryLocations: [],
            saveError: null,
            saveProjectDirectory: async (id) => {
                const host = requireDirectoryHost();
                await flushCanvasStorage().catch(() => undefined);
                const location = await host.projects.saveAs(await projectPayload(id));
                if (!location) return false;
                set({ directoryLocations: await host.projects.locations() });
                await flushCanvasStorage();
                return true;
            },
            createDirectoryFolder: async (name, directory) => {
                const host = requireDirectoryHost();
                const now = new Date().toISOString();
                const folder = { id: nanoid(), name: normalizeProjectName(name), createdAt: now, updatedAt: now };
                const location = await host.projects.create({ folder, pages: [] }, directory);
                set((state) => ({ projectFolders: [folder, ...state.projectFolders], directoryLocations: [...state.directoryLocations, location] }));
                await flushCanvasStorage();
                return folder.id;
            },
            openProjectDirectory: async () => {
                const host = requireDirectoryHost();
                await flushCanvasStorage();
                const opened = await host.projects.open({ projects: get().projects, projectFolders: get().projectFolders });
                if (!opened) return null;
                if (opened.alreadyOpen) {
                    set({ directoryLocations: await host.projects.locations() });
                    return opened.folder ? `/projects/${opened.folder.id}` : `/canvas/${opened.pages[0].id}`;
                }
                set((state) => ({
                    projectFolders: opened.folder ? [opened.folder, ...state.projectFolders] : state.projectFolders,
                    projects: [...opened.pages, ...state.projects],
                    deletedProjects: state.deletedProjects.filter((item) => !opened.pages.some((page) => page.id === item.id)),
                    directoryLocations: [...state.directoryLocations.filter((item) => item.id !== opened.location.id), opened.location],
                }));
                await flushCanvasStorage();
                return opened.folder ? `/projects/${opened.folder.id}` : `/canvas/${opened.pages[0].id}`;
            },
            createProjectFolder: (name) => {
                const id = nanoid();
                const now = new Date().toISOString();
                const folder = { id, name: normalizeProjectName(name), createdAt: now, updatedAt: now };
                set((state) => ({ projectFolders: [folder, ...state.projectFolders] }));
                return id;
            },
            renameProjectFolder: (id, name) => {
                const title = normalizeProjectName(name);
                set((state) => ({ projectFolders: state.projectFolders.map((folder) => folder.id === id ? { ...folder, name: title, updatedAt: new Date().toISOString() } : folder) }));
            },
            dissolveProjectFolder: (id) => set((state) => ({
                projectFolders: state.projectFolders.filter((folder) => folder.id !== id),
                projects: state.projects.map((project) => project.projectFolderId === id ? { ...project, projectFolderId: null } : project),
            })),
            assignProjectFolder: (id, folderId) => {
                if (folderId && !get().projectFolders.some((folder) => folder.id === folderId)) throw new Error("项目不存在");
                const now = new Date().toISOString();
                set((state) => ({
                    projects: state.projects.map((project) => project.id === id ? { ...project, projectFolderId: folderId, updatedAt: now } : project),
                    projectFolders: state.projectFolders.map((folder) => folder.id === folderId || state.projects.some((project) => project.id === id && project.projectFolderId === folder.id) ? { ...folder, updatedAt: now } : folder),
                }));
            },
            projects: [],
            deletedProjects: [],
            createProject: (title = i18n.t("canvas.project.untitled"), projectFolderId = null) => {
                if (projectFolderId && !get().projectFolders.some((folder) => folder.id === projectFolderId)) throw new Error("项目不存在");
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title: normalizeProjectName(title),
                    projectFolderId,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({
                    projects: [project, ...state.projects],
                    projectFolders: state.projectFolders.map((folder) => folder.id === projectFolderId ? { ...folder, updatedAt: now } : folder),
                }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || i18n.t("canvas.project.imported"),
                    projectFolderId: null,
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: normalizeProjectName(title), updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const now = new Date().toISOString();
                    const removing = new Set(ids);
                    const projects = state.projects.filter((project) => !removing.has(project.id));
                    const deletedProjects = [...state.deletedProjects.filter((item) => !removing.has(item.id)), ...ids.map((id) => ({ id, deletedAt: now }))];
                    return { projects, deletedProjects };
                }),
            replaceProjects: (projects, deletedProjects = []) => set((state) => {
                const bound = new Set(state.directoryLocations.map((item) => item.id));
                const local = state.projects.filter((item) => bound.has(item.id) || (item.projectFolderId && bound.has(item.projectFolderId)));
                const ids = new Set(local.map((item) => item.id));
                return { projects: [...local, ...projects.filter((item) => !ids.has(item.id))], deletedProjects: deletedProjects.filter((item) => !ids.has(item.id)) };
            }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projectFolders: state.projectFolders,
                    projects: state.projects,
                    deletedProjects: state.deletedProjects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                const host = desktopBridge();
                if (error) { useCanvasStore.setState({ saveError: "本地项目读取失败，已停止保存，请重新启动后检查" }); return; }
                if (!host) { persistenceReady = true; useCanvasStore.setState({ hydrated: true }); return; }
                void host.projects.locations().then((directoryLocations) => {
                    persistenceReady = true;
                    useCanvasStore.setState({ hydrated: true, directoryLocations });
                }).catch((cause) => useCanvasStore.setState({ saveError: String(cause) }));
            },
        },
    ),
);

if (typeof window !== "undefined") {
    desktopBridge()?.onBeforeClose(async () => {
        if (!useCanvasStore.getState().hydrated) throw new Error("项目尚未完成读取，无法安全退出");
        await flushCanvasStorage();
    });
}
