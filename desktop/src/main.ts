import fs from "node:fs";
import path from "node:path";

import { app, BrowserWindow, dialog, ipcMain, protocol } from "electron";

import { resolveAgentEntry, resolveAppIcon, resolveWebDist } from "./paths.js";
import { forwardDesktopRequest } from "./proxy.js";
import { AgentSidecar, type SidecarEvent } from "./sidecar.js";
import { applyAppSecurity, applyWindowSecurity } from "./security.js";
import { registerDesktopStorage } from "./storage.js";
import { createGenerationNotifications } from "./notifications.js";

/** 稳定渲染 origin：自定义 standard + secure 协议保证本地 IndexedDB 跨启动复用。 */
const RENDERER_ORIGIN = "app://framedock";
const DEV_URL = app.isPackaged ? "" : process.env.FRAMEDOCK_DEV_URL || "";
app.setName("FrameDock");
app.setPath("userData", path.join(app.getPath("appData"), "FrameDock Desktop"));

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

let mainWindow: BrowserWindow | null = null;
let sidecar: AgentSidecar | null = null;
let connection: { url: string; token: string } | null = null;
let quitting = false;
let closeReady = false;
let closeAllowed = false;
let closing = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (!mainWindow) return;
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    });
    app.whenReady().then(() => void bootstrap()).catch((error) => {
        console.error("Infinite Canvas desktop failed to start:", error);
        app.quit();
    });
}

async function bootstrap() {
    applyAppSecurity();
    registerDesktopStorage({ userDataPath: app.getPath("userData"), rendererOrigin: DEV_URL || RENDERER_ORIGIN });
    registerIpc();
    if (!DEV_URL) registerAppProtocol(resolveWebDist());
    sidecar = new AgentSidecar(resolveAgentEntry(), broadcastSidecarEvent);
    try {
        connection = await sidecar.start();
    } catch (error) {
        connection = null;
        broadcastSidecarEvent({ type: "failed", message: error instanceof Error ? error.message : String(error) });
    }
    createWindow();
}

function registerIpc() {
    const trusted = (event: Electron.IpcMainInvokeEvent) => {
        const frame = event.senderFrame;
        if (!mainWindow || event.sender !== mainWindow.webContents || !frame || frame !== event.sender.mainFrame) throw new Error("拒绝非应用页面请求");
        const actual = new URL(frame.url), expected = new URL(DEV_URL || RENDERER_ORIGIN);
        if (actual.protocol !== expected.protocol || actual.host !== expected.host) throw new Error("拒绝非应用来源请求");
    };
    const notifyGeneration = createGenerationNotifications(() => mainWindow);
    ipcMain.handle("framedock:generation-notification", (event, value) => { trusted(event); return notifyGeneration(value); });
    ipcMain.on("framedock:close-ready", (event) => { trusted(event as unknown as Electron.IpcMainInvokeEvent); closeReady = true; });
    ipcMain.on("framedock:close-result", (event, error: unknown) => {
        trusted(event as unknown as Electron.IpcMainInvokeEvent);
        if (!closing) return;
        closing = false;
        if (error !== null) { if (mainWindow) void dialog.showMessageBox(mainWindow, { type: "error", title: "项目保存失败", message: String(error), detail: "窗口保持打开，请解决保存错误后重试退出。" }); return; }
        closeAllowed = true;
        mainWindow?.close();
    });
    ipcMain.handle("canvas-desktop:agent-connection", event => { trusted(event); return connection; });
    ipcMain.handle("canvas-desktop:host-info", event => { trusted(event); return { desktop: true as const, platform: process.platform, version: app.getVersion() }; });
    ipcMain.handle("canvas-desktop:sidecar-log", event => { trusted(event); return sidecar?.recentLog() || ""; });
}

function broadcastSidecarEvent(event: SidecarEvent) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("canvas-desktop:sidecar-event", event);
}

/** 以 app:// 稳定 origin 提供渲染层静态资源；路径限制在 web/dist 内。 */
function registerAppProtocol(dist: string) {
    const mimeByExtension: Record<string, string> = {
        ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
        ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif", ".ico": "image/x-icon",
        ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".map": "application/json", ".txt": "text/plain",
    };
    protocol.handle("app", (request) => {
        const { pathname, host } = new URL(request.url);
        if (host !== "framedock") return new Response("forbidden", { status: 403 });
        if (pathname.startsWith("/proxy/")) return forwardDesktopRequest(request);
        const relative = decodeURIComponent(pathname).replace(/^\/+/, "") || "index.html";
        const file = path.join(dist, relative);
        if (!file.startsWith(dist + path.sep) && file !== dist) return new Response("forbidden", { status: 403 });
        try {
            const body = fs.readFileSync(file);
            return new Response(body, { headers: { "content-type": mimeByExtension[path.extname(file).toLowerCase()] || "application/octet-stream" } });
        } catch {
            // SPA 路由回退到 index.html。
            return new Response(fs.readFileSync(path.join(dist, "index.html")), { headers: { "content-type": "text/html" } });
        }
    });
}

function createWindow() {
    const icon = resolveAppIcon();
    app.dock?.setIcon(icon);
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        show: false,
        title: "FrameDock",
        icon,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            spellcheck: false,
        },
    });
    applyWindowSecurity(mainWindow, DEV_URL || RENDERER_ORIGIN);
    mainWindow.once("ready-to-show", () => mainWindow?.show());
    mainWindow.on("close", (event) => {
        if (closeAllowed) return;
        event.preventDefault();
        if (closing || !closeReady) return;
        closing = true;
        mainWindow?.webContents.send("framedock:before-close");
    });
    // 主文档实际切换后才等待重新就绪，被拦截的导航仍使用原页面的退出监听。
    mainWindow.webContents.on("did-navigate", () => { closeReady = false; });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
    // 必须加载根路径：/index.html 不在 React Router 路由表内，会导致首次启动落到 404 页。
    void mainWindow.loadURL(DEV_URL || `${RENDERER_ORIGIN}/`);
}

app.on("window-all-closed", () => app.quit());

app.on("before-quit", (event) => {
    if (mainWindow && !closeAllowed) {
        event.preventDefault();
        mainWindow.close();
        return;
    }
    if (quitting || !sidecar) return;
    quitting = true;
    event.preventDefault();
    void sidecar.stop().finally(() => app.quit());
});
