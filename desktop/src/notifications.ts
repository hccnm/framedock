import { Notification, type BrowserWindow } from "electron";

type Target = { kind: "image" | "video"; logId: string } | { kind: "canvas"; projectId: string; nodeId: string };
type GenerationNotification = { id: string; title: string; body: string; target: Target };

export function createGenerationNotifications(getWindow: () => BrowserWindow | null) {
    const shown = new Set<string>();
    const active = new Set<Notification>();
    return (value: GenerationNotification) => {
        const target = value?.target;
        if (!value || typeof value.id !== "string" || !value.id || typeof value.title !== "string" || typeof value.body !== "string" || !target ||
            !(target.kind === "canvas" ? typeof target.projectId === "string" && !!target.projectId && typeof target.nodeId === "string" && !!target.nodeId :
                (target.kind === "image" || target.kind === "video") && typeof target.logId === "string" && !!target.logId)) throw new Error("无效的生成通知");
        if (!Notification.isSupported() || shown.has(value.id)) return false;
        const notification = new Notification({ title: value.title, body: value.body });
        active.add(notification);
        notification.on("click", () => {
            const window = getWindow();
            if (!window || window.isDestroyed()) return;
            if (window.isMinimized()) window.restore();
            window.show();
            window.focus();
            window.webContents.send("framedock:generation-notification-click", target);
        });
        notification.on("close", () => active.delete(notification));
        notification.on("failed", (_event, error) => {
            active.delete(notification);
            shown.delete(value.id);
            console.warn("生成任务系统通知发送失败：", error);
        });
        shown.add(value.id);
        try { notification.show(); }
        catch (error) { active.delete(notification); shown.delete(value.id); throw error; }
        return true;
    };
}
