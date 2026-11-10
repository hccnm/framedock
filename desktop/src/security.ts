import { app, shell, type BrowserWindow, type WebContents } from "electron";

const windowOrigins = new WeakMap<WebContents, string>();

function allowFullscreen(contents: WebContents | null, permission: string, requestingUrl: string, isMainFrame: boolean) {
    if (permission !== "fullscreen" || !contents || contents.isDestroyed() || !isMainFrame) return false;
    const allowed = windowOrigins.get(contents);
    try {
        return Boolean(allowed && normalizeOrigin(contents.getURL()) === allowed && normalizeOrigin(requestingUrl) === allowed);
    } catch { return false; }
}

/** 规范化出用于精确比较的 origin（协议 + 主机 + 端口），不依赖 scheme 是否被 Node 识别为 special。 */
export function normalizeOrigin(value: string) {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`;
}

/** 收紧单个窗口的导航与外链行为：只允许应用自身 origin，外链交给系统浏览器。 */
export function applyWindowSecurity(window: BrowserWindow, allowedOrigin: string) {
    const allowed = normalizeOrigin(allowedOrigin);
    windowOrigins.set(window.webContents, allowed);
    window.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
        return { action: "deny" };
    });
    window.webContents.on("will-navigate", (event, url) => {
        let targetOrigin = "";
        try {
            targetOrigin = normalizeOrigin(url);
        } catch {
            // 无法解析的地址一律阻止。
        }
        if (targetOrigin !== allowed) event.preventDefault();
    });
}

/** 仅登记的应用主页面可全屏；webview 与设备权限继续拒绝。 */
export function applyAppSecurity() {
    app.on("web-contents-created", (_event, contents) => {
        contents.on("will-attach-webview", (event) => event.preventDefault());
        contents.setWindowOpenHandler(() => ({ action: "deny" }));
        contents.session.setPermissionCheckHandler((requester, permission, origin, details) => allowFullscreen(requester, permission, details.requestingUrl || origin, details.isMainFrame));
        contents.session.setPermissionRequestHandler((requester, permission, callback, details) => callback(allowFullscreen(requester, permission, details.requestingUrl, details.isMainFrame)));
    });
}
