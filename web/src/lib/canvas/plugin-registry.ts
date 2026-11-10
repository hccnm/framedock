// Only canonical paths emitted by the bundled plugin build are accepted.
export function isBundledPluginUrl(url: unknown): url is string {
    return typeof url === "string" && /^\/plugins\/[a-zA-Z0-9_-]+\.js$/.test(url);
}

export async function fetchBundledPluginUrls(): Promise<string[]> {
    const response = await fetch("/plugins/index.json", { redirect: "error" });
    if (!response.ok) throw new Error(`随包插件清单读取失败 (${response.status})`);
    const manifest: unknown = await response.json();
    if (!Array.isArray(manifest)) throw new Error("随包插件清单格式无效");
    return [...new Set(manifest.filter(isBundledPluginUrl))];
}
