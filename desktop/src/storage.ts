import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from "electron";
import { createProjectDirectories } from "./project-files.js";
import { normalizeOrigin } from "./security.js";
import { createDesktopStorage } from "./storage-files.js";

export function registerDesktopStorage(options: { userDataPath: string; rendererOrigin: string }) {
    const allowedOrigin = normalizeOrigin(options.rendererOrigin);
    const storage = createDesktopStorage(options.userDataPath);
    const directories = createProjectDirectories(options.userDataPath, storage);
    const selectedDirectories = new Map<number, string>();
    for (const operation of ["locations", "selectDirectory", "create", "saveAs", "open", "sync", "listFiles", "readFile"] as const) {
        ipcMain.handle(`framedock:projects:${operation}`, async (event, value, directory: unknown, scope?: string) => {
            validate(event);
            if (operation === "locations") return directories.locations();
            if (operation === "sync") return directories.sync(value);
            if (operation === "listFiles") return directories.listFiles(value, directory as string | undefined, scope);
            if (operation === "readFile") return directories.readFile(value, directory as string, scope);
            if (operation === "create") {
                if (typeof directory !== "string" || selectedDirectories.get(event.sender.id) !== directory) throw new Error("请先选择项目保存目录");
                const location = await directories.saveAs(directory, value);
                selectedDirectories.delete(event.sender.id);
                return location;
            }
            const owner = BrowserWindow.fromWebContents(event.sender);
            if (!owner) throw new Error("应用窗口不存在");
            const selected = await dialog.showOpenDialog(owner, { title: operation === "open" ? "打开项目目录" : "选择作品目录保存项目", properties: ["openDirectory", "createDirectory"] });
            if (selected.canceled || !selected.filePaths[0]) return null;
            if (operation === "selectDirectory") {
                selectedDirectories.set(event.sender.id, selected.filePaths[0]);
                return selected.filePaths[0];
            }
            return operation === "open" ? directories.open(selected.filePaths[0], value) : directories.saveAs(selected.filePaths[0], value);
        });
    }
    function validate(event: IpcMainInvokeEvent) {
        const frame = event.senderFrame;
        if (!frame || frame !== event.sender.mainFrame || normalizeOrigin(frame.url) !== allowedOrigin) throw new Error("禁止访问桌面存储");
    }
    // 只有这些操作可跨进程调用，不暴露文件系统或任意 IPC 通道。
    for (const operation of ["getState", "setState", "removeState", "getConfig", "setConfig", "removeConfig", "getMedia", "setMedia", "removeMedia", "mediaKeys"] as const) {
        ipcMain.handle(`framedock:storage:${operation}`, (event, ...args: unknown[]) => {
            validate(event);
            const handler = storage[operation] as (...input: unknown[]) => Promise<unknown>;
            return handler(...args);
        });
    }
}
