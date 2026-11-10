import { registerNodeDefinitions, unregisterPluginNodes } from "@/lib/canvas/node-registry";
import { getPluginRuntime } from "@/lib/canvas/plugin-runtime";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";
import type { CanvasPlugin } from "@/types/canvas-plugin";
import i18n from "@/i18n";
import { fetchBundledPluginUrls, isBundledPluginUrl } from "@/lib/canvas/plugin-registry";

const cleanups = new Map<string, () => void>();

// A bundled plugin may export CanvasPlugin directly or a factory that receives runtime and returns CanvasPlugin.
// The factory uses runtime.React so the bundle does not need its own React copy.
async function evaluatePluginSource(source: string): Promise<CanvasPlugin> {
    const blob = new Blob([source], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    try {
        const mod = (await import(/* @vite-ignore */ url)) as { default?: unknown; plugin?: unknown };
        const exported = mod.default ?? mod.plugin;
        const plugin = typeof exported === "function" ? (exported as (runtime: unknown) => unknown)(getPluginRuntime()) : exported;
        assertPlugin(plugin);
        return plugin;
    } finally {
        URL.revokeObjectURL(url);
    }
}

function assertPlugin(plugin: unknown): asserts plugin is CanvasPlugin {
    const value = plugin as Partial<CanvasPlugin> | null;
    if (!value || typeof value !== "object") throw new Error(i18n.t("canvas.pluginErrors.invalidExport"));
    if (!value.id || !Array.isArray(value.nodes) || !value.nodes.length) throw new Error(i18n.t("canvas.pluginErrors.missingFields"));
}

export function activatePlugin(plugin: CanvasPlugin) {
    registerNodeDefinitions(plugin.nodes, plugin.id);
    const runtime = getPluginRuntime();
    const disposers: Array<() => void> = [];
    // Inject declared styles when enabled and remove them when disabled or uninstalled.
    if (plugin.css) disposers.push(runtime.injectCSS(plugin.css, plugin.id));
    const cleanup = plugin.setup?.(runtime);
    if (typeof cleanup === "function") disposers.push(cleanup);
    if (disposers.length) cleanups.set(plugin.id, () => disposers.forEach((dispose) => dispose()));
}

export function deactivatePlugin(pluginId: string) {
    cleanups.get(pluginId)?.();
    cleanups.delete(pluginId);
    unregisterPluginNodes(pluginId);
}

async function fetchPluginSource(url: string) {
    if (!isBundledPluginUrl(url) || !(await fetchBundledPluginUrls()).includes(url)) {
        throw new Error("仅允许加载随应用提供的插件");
    }
    const response = await fetch(url, { redirect: "error", cache: "no-store" });
    if (!response.ok) throw new Error(i18n.t("canvas.pluginErrors.downloadFailed", { status: response.status }));
    return response.text();
}

// The legacy entry point is retained, but flags cannot authorize an unbundled URL.
export async function installPluginFromUrl(url: string, _opts?: { official?: boolean; bustCache?: boolean }) {
    const plugin = await evaluatePluginSource(await fetchPluginSource(url));
    deactivatePlugin(plugin.id);
    usePluginStore.getState().upsert({ id: plugin.id, name: plugin.name || plugin.id, version: plugin.version || "0.0.0", description: plugin.description, url, source: "", enabled: true, local: true });
    activatePlugin(plugin);
    return plugin;
}

export async function updatePlugin(record: InstalledPlugin) {
    return installPluginFromUrl(record.url);
}

export async function setPluginEnabled(record: InstalledPlugin, enabled: boolean) {
    if (!enabled) {
        usePluginStore.getState().setEnabled(record.id, false);
        deactivatePlugin(record.id);
        return;
    }
    const plugin = await evaluatePluginSource(await fetchPluginSource(record.url));
    if (plugin.id !== record.id) throw new Error("随包插件标识不匹配");
    activatePlugin(plugin);
    usePluginStore.getState().setEnabled(record.id, true);
}

export function uninstallPlugin(id: string) {
    deactivatePlugin(id);
    usePluginStore.getState().remove(id);
}

let loaded = false;

// Discover bundled plugins first; persisted source and trust flags are never executed.
export async function ensurePluginsLoaded() {
    if (loaded) return;
    loaded = true;
    await usePluginStore.persist.rehydrate();
    try {
        await loadLocalPlugins();
    } catch (error) {
        console.error("[plugin] Failed to load bundled plugins", error);
    }
}

async function loadLocalPlugins() {
    const urls = await fetchBundledPluginUrls();
    await Promise.all(
        urls.map(async (url) => {
            try {
                const plugin = await evaluatePluginSource(await fetchPluginSource(url));
                const store = usePluginStore.getState();
                const existing = store.plugins.find((item) => item.id === plugin.id && item.url === url);
                const enabled = existing?.enabled ?? false;
                store.upsert({
                    id: plugin.id,
                    name: plugin.name || plugin.id,
                    version: plugin.version || "0.0.0",
                    description: plugin.description,
                    url,
                    source: "",
                    enabled,
                    local: true,
                });
                if (enabled) activatePlugin(plugin);
            } catch (error) {
                console.error(`[plugin] Failed to discover bundled plugin: ${url}`, error);
            }
        }),
    );
}
