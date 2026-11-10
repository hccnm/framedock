import localforage from "localforage";
import type { CanvasDesktopBridge, DesktopMediaNamespace } from "@/types/desktop-host";

/** 当前是否运行在 Infinite Canvas 桌面壳中。 */
export function isDesktopHost() {
    return typeof window !== "undefined" && Boolean(window.canvasDesktop);
}

/** 读取桌面壳桥接；浏览器环境返回 undefined。 */
export function desktopBridge(): CanvasDesktopBridge | undefined {
    return typeof window === "undefined" ? undefined : window.canvasDesktop;
}

/** 保留媒体服务的 Blob API；Electron 只经受限桥读写本机文件。 */
export function createMediaStorage(namespace: DesktopMediaNamespace, storeName: string) {
    const browser = localforage.createInstance({ name: "framedock", storeName });
    return {
        async getItem<T = Blob>(key: string): Promise<T | null> {
            const host = desktopBridge();
            if (!host) return browser.getItem<T>(key);
            const value = await host.storage.getMedia(namespace, key);
            return value ? new Blob([new Uint8Array(value.bytes)], { type: value.mimeType }) as T : null;
        },
        async setItem(key: string, blob: Blob) {
            const host = desktopBridge();
            if (!host) return browser.setItem(key, blob);
            await host.storage.setMedia(namespace, key, { bytes: new Uint8Array(await blob.arrayBuffer()), mimeType: blob.type });
            return blob;
        },
        async removeItem(key: string) {
            const host = desktopBridge();
            if (host) await host.storage.removeMedia(namespace, key);
            else await browser.removeItem(key);
        },
        async iterate(callback: (value: unknown, key: string) => void) {
            const host = desktopBridge();
            if (host) for (const key of await host.storage.mediaKeys(namespace)) callback(undefined, key);
            else await browser.iterate(callback);
        },
    };
}
