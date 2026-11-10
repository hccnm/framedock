import "./browser-globals";
import { afterAll, expect, mock, test } from "bun:test";
import type { InstalledPlugin } from "../src/stores/canvas/use-plugin-store";

const originalFetch = globalThis.fetch;
const requests: Array<{ url: string; options?: RequestInit }> = [];
let manifest: unknown = [];
let bundleSource: string | undefined;
const record: InstalledPlugin = {
    id: "remote", name: "remote", version: "1", installedAt: "", enabled: true,
    local: true, official: true, url: "https://evil.example/plugin.js",
    source: "globalThis.__remotePluginExecuted = true; throw new Error('cached source executed')",
};
const state = { plugins: [record], setEnabled: mock(() => {}), upsert: mock(() => {}), remove: mock(() => {}) };
const unregister = mock(() => {});
mock.module("../src/stores/canvas/use-plugin-store", () => ({ usePluginStore: { getState: () => state, persist: { rehydrate: async () => {} } } }));
mock.module("../src/lib/canvas/node-registry", () => ({ registerNodeDefinitions: mock(() => {}), unregisterPluginNodes: unregister }));
mock.module("../src/lib/canvas/plugin-runtime", () => ({ getPluginRuntime: () => ({}) }));
const { default: i18n } = await import("../src/i18n");

const { fetchBundledPluginUrls, isBundledPluginUrl } = await import("../src/lib/canvas/plugin-registry");
const { installPluginFromUrl, updatePlugin, setPluginEnabled, ensurePluginsLoaded, uninstallPlugin } = await import("../src/lib/canvas/plugin-loader");
globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    requests.push({ url: String(url), options });
    if (url === "/plugins/index.json") return Response.json(manifest);
    return bundleSource === undefined ? new Response("", { status: 404 }) : new Response(bundleSource);
}) as typeof fetch;
afterAll(() => { globalThis.fetch = originalFetch; mock.restore(); });

test("manifest admits only canonical bundled paths", async () => {
    const invalid = ["https://evil.example/p.js", "//evil.example/p.js", "/plugins/../p.js", "/plugins/%2e%2e/p.js", "/plugins/p.js?url=https://evil.example", "/plugins/p.js#x", "/plugins/a\\p.js", "/other/p.js", null, {}];
    for (const url of invalid) expect(isBundledPluginUrl(url)).toBe(false);
    manifest = ["/plugins/sticky-note.js", ...invalid, "/plugins/sticky-note.js"];
    expect(await fetchBundledPluginUrls()).toEqual(["/plugins/sticky-note.js"]);
    expect(requests.at(-1)).toEqual({ url: "/plugins/index.json", options: { redirect: "error" } });
    manifest = { plugins: ["/plugins/sticky-note.js"] };
    await expect(fetchBundledPluginUrls()).rejects.toThrow("清单格式无效");
});

test("install, update and enable reject remote URLs even with trust flags", async () => {
    requests.length = 0;
    await expect(installPluginFromUrl(record.url, { official: true, bustCache: true })).rejects.toThrow("仅允许");
    await expect(updatePlugin(record)).rejects.toThrow("仅允许");
    await expect(setPluginEnabled(record, true)).rejects.toThrow("仅允许");
    expect(requests).toEqual([]);
    expect(state.setEnabled).not.toHaveBeenCalled();
});

test("unlisted local addresses fail closed and bundled fetches reject redirects", async () => {
    manifest = ["/plugins/sticky-note.js"];
    requests.length = 0;
    await expect(installPluginFromUrl("/plugins/unlisted.js", { official: true })).rejects.toThrow("仅允许");
    expect(requests.map((request) => request.url)).toEqual(["/plugins/index.json"]);
    await expect(installPluginFromUrl("/plugins/sticky-note.js")).rejects.toThrow(i18n.t("canvas.pluginErrors.downloadFailed", { status: 404 }));
    expect(requests.at(-1)).toEqual({ url: "/plugins/sticky-note.js", options: { redirect: "error", cache: "no-store" } });
});

test("startup ignores persisted remote source and VITE_DEV_PLUGINS", async () => {
    const previous = process.env.VITE_DEV_PLUGINS;
    process.env.VITE_DEV_PLUGINS = "https://evil.example/dev.js";
    try {
        manifest = [];
        requests.length = 0;
        await ensurePluginsLoaded();
        expect(requests.map((request) => request.url)).toEqual(["/plugins/index.json"]);
        expect((globalThis as Record<string, unknown>).__remotePluginExecuted).toBeUndefined();
        expect(state.upsert).not.toHaveBeenCalled();
    } finally {
        if (previous === undefined) delete process.env.VITE_DEV_PLUGINS;
        else process.env.VITE_DEV_PLUGINS = previous;
    }
});

test("bundled install and enable use fresh package code instead of cached source", async () => {
    manifest = ["/plugins/sticky-note.js"];
    bundleSource = 'export default { id: "sticky-note", name: "随包插件", nodes: [{ type: "sticky-note" }] }';
    try {
        const plugin = await installPluginFromUrl("/plugins/sticky-note.js");
        expect(plugin.id).toBe("sticky-note");
        expect(state.upsert).toHaveBeenCalledWith(expect.objectContaining({ local: true, source: "", enabled: true }));
        await setPluginEnabled({ ...record, id: "sticky-note", url: "/plugins/sticky-note.js" }, true);
        expect(state.setEnabled).toHaveBeenCalledWith("sticky-note", true);
        expect((globalThis as Record<string, unknown>).__remotePluginExecuted).toBeUndefined();
    } finally {
        bundleSource = undefined;
    }
});

test("disable and uninstall remain available without downloading code", async () => {
    requests.length = 0;
    await setPluginEnabled(record, false);
    expect(state.setEnabled).toHaveBeenCalledWith(record.id, false);
    uninstallPlugin(record.id);
    expect(state.remove).toHaveBeenCalledWith(record.id);
    expect(unregister).toHaveBeenCalledWith(record.id);
    expect(requests).toEqual([]);
});
