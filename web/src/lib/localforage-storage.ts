import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";
import { desktopBridge } from "@/lib/desktop-host";

const browser = localforage.createInstance({ name: "framedock", storeName: "app_state" });

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        const host = desktopBridge();
        return host ? host.storage.getState(name) : browser.getItem<string>(name);
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        const host = desktopBridge();
        if (host) await host.storage.setState(name, value);
        else await browser.setItem(name, value);
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        const host = desktopBridge();
        if (host) await host.storage.removeState(name);
        else await browser.removeItem(name);
    },
};
