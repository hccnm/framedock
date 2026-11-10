/** Infinite Canvas 桌面壳通过 preload 暴露的最小桥接接口。 */
export type CanvasDesktopSidecarEvent = { type: "starting" | "ready" | "restarting" | "failed"; message?: string };
export type DesktopMediaNamespace = "images" | "previews" | "media";
export type DesktopStorageBridge = {
    getState: (key: string) => Promise<string | null>;
    setState: (key: string, value: string) => Promise<void>;
    removeState: (key: string) => Promise<void>;
    getConfig: () => Promise<string | null>;
    setConfig: (value: string) => Promise<void>;
    removeConfig: () => Promise<void>;
    getMedia: (namespace: DesktopMediaNamespace, key: string) => Promise<{ bytes: Uint8Array; mimeType: string } | null>;
    setMedia: (namespace: DesktopMediaNamespace, key: string, value: { bytes: Uint8Array; mimeType: string }) => Promise<void>;
    removeMedia: (namespace: DesktopMediaNamespace, key: string) => Promise<void>;
    mediaKeys: (namespace: DesktopMediaNamespace) => Promise<string[]>;
};
export type DesktopProjectLocation = { id: string; directory: string };
export type DesktopProjectFileEntry = { name: string; path: string; kind: "file" | "directory"; size?: number; modifiedAt?: string };
export type DesktopProjectFileList = { directory: string; entries: DesktopProjectFileEntry[]; scope: string };
export type DesktopProjectFile = { path: string; content: string; modifiedAt: string };
export type DesktopProjectPayload = { folder: import("@/stores/canvas/use-canvas-store").ProjectFolder | null; pages: import("@/stores/canvas/use-canvas-store").CanvasProject[] };
export type DesktopProjectState = { projects: import("@/stores/canvas/use-canvas-store").CanvasProject[]; projectFolders: import("@/stores/canvas/use-canvas-store").ProjectFolder[] };
export type GenerationNotificationTarget = { kind: "image" | "video"; logId: string } | { kind: "canvas"; projectId: string; nodeId: string };
export type GenerationNotification = { id: string; title: string; body: string; target: GenerationNotificationTarget };
export type CanvasDesktopBridge = {
    notifyGeneration: (notification: GenerationNotification) => Promise<boolean>;
    onGenerationNotificationClick: (listener: (target: GenerationNotificationTarget) => void) => () => void;
    storage: DesktopStorageBridge;
    projects: {
        locations: () => Promise<DesktopProjectLocation[]>;
        listFiles: (pageId: string, path?: string, scope?: string) => Promise<DesktopProjectFileList>;
        readFile: (pageId: string, path: string, scope?: string) => Promise<DesktopProjectFile>;
        selectDirectory: () => Promise<string | null>;
        create: (payload: DesktopProjectPayload, directory: string) => Promise<DesktopProjectLocation>;
        saveAs: (payload: DesktopProjectPayload) => Promise<DesktopProjectLocation | null>;
        open: (state: DesktopProjectState) => Promise<(DesktopProjectPayload & { location: DesktopProjectLocation; alreadyOpen?: boolean }) | null>;
        sync: (state: DesktopProjectState) => Promise<void>;
    };
    onBeforeClose: (flush: () => Promise<void>) => () => void;
    getAgentConnection: () => Promise<{ url: string; token: string } | null>;
    getHostInfo: () => Promise<{ desktop: true; platform: string; version: string }>;
    onSidecarEvent: (listener: (event: CanvasDesktopSidecarEvent) => void) => () => void;
};

declare global {
    interface Window {
        canvasDesktop?: CanvasDesktopBridge;
    }
}
