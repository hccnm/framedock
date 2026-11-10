import { contextBridge, ipcRenderer } from "electron/renderer";

/**
 * 只暴露固定、受限的桌面桥接方法；文件读取限定于已授权项目目录，不提供命令执行或任意路径 IPC。
 * 连接信息由桌面主进程在 sidecar 健康检查通过后一次性下发。
 */
const bridge = {
    notifyGeneration: (notification: unknown) => ipcRenderer.invoke("framedock:generation-notification", notification),
    onGenerationNotificationClick: (listener: (target: unknown) => void) => {
        const handler = (_event: unknown, target: unknown) => listener(target);
        ipcRenderer.on("framedock:generation-notification-click", handler);
        return () => ipcRenderer.removeListener("framedock:generation-notification-click", handler);
    },
    storage: {
        getState: (key: string) => ipcRenderer.invoke("framedock:storage:getState", key),
        setState: (key: string, value: string) => ipcRenderer.invoke("framedock:storage:setState", key, value),
        removeState: (key: string) => ipcRenderer.invoke("framedock:storage:removeState", key),
        getConfig: () => ipcRenderer.invoke("framedock:storage:getConfig"),
        setConfig: (value: string) => ipcRenderer.invoke("framedock:storage:setConfig", value),
        removeConfig: () => ipcRenderer.invoke("framedock:storage:removeConfig"),
        getMedia: (namespace: string, key: string) => ipcRenderer.invoke("framedock:storage:getMedia", namespace, key),
        setMedia: (namespace: string, key: string, value: { bytes: Uint8Array; mimeType: string }) => ipcRenderer.invoke("framedock:storage:setMedia", namespace, key, value),
        removeMedia: (namespace: string, key: string) => ipcRenderer.invoke("framedock:storage:removeMedia", namespace, key),
        mediaKeys: (namespace: string) => ipcRenderer.invoke("framedock:storage:mediaKeys", namespace),
    },
    projects: {
        locations: () => ipcRenderer.invoke("framedock:projects:locations"),
        listFiles: (pageId: string, path?: string, scope?: string) => ipcRenderer.invoke("framedock:projects:listFiles", pageId, path, scope),
        readFile: (pageId: string, path: string, scope?: string) => ipcRenderer.invoke("framedock:projects:readFile", pageId, path, scope),
        selectDirectory: () => ipcRenderer.invoke("framedock:projects:selectDirectory"),
        create: (payload: unknown, directory: string) => ipcRenderer.invoke("framedock:projects:create", payload, directory),
        saveAs: (payload: unknown) => ipcRenderer.invoke("framedock:projects:saveAs", payload),
        open: (state: unknown) => ipcRenderer.invoke("framedock:projects:open", state),
        sync: (state: unknown) => ipcRenderer.invoke("framedock:projects:sync", state),
    },
    onBeforeClose: (flush: () => Promise<void>) => {
        const handler = async () => {
            try { await flush(); ipcRenderer.send("framedock:close-result", null); }
            catch (error) { ipcRenderer.send("framedock:close-result", error instanceof Error ? error.message : String(error)); }
        };
        ipcRenderer.on("framedock:before-close", handler);
        ipcRenderer.send("framedock:close-ready");
        return () => ipcRenderer.removeListener("framedock:before-close", handler);
    },
    getAgentConnection: () => ipcRenderer.invoke("canvas-desktop:agent-connection") as Promise<{ url: string; token: string } | null>,
    getHostInfo: () => ipcRenderer.invoke("canvas-desktop:host-info") as Promise<{ desktop: true; platform: string; version: string }>,
    onSidecarEvent: (listener: (event: { type: "starting" | "ready" | "restarting" | "failed"; message?: string }) => void) => {
        const handler = (_event: unknown, data: { type: "starting" | "ready" | "restarting" | "failed"; message?: string }) => listener(data);
        ipcRenderer.on("canvas-desktop:sidecar-event", handler);
        return () => ipcRenderer.removeListener("canvas-desktop:sidecar-event", handler);
    },
};

contextBridge.exposeInMainWorld("canvasDesktop", bridge);
