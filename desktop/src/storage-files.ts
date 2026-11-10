import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const stateKeys = new Set(["framedock:canvas_store", "framedock:asset_store", "framedock:plugin_store", "framedock:comfyui_store"]);
const mediaNamespaces = new Set(["images", "previews", "media"]);
export type MediaNamespace = "images" | "previews" | "media";
export type StoredMedia = { bytes: Uint8Array; mimeType: string };
/** 所有路径只来自固定命名空间和受限键，配置以普通 JSON 文件保存。 */
export function createDesktopStorage(userDataPath: string) {
    const root = path.join(userDataPath, "storage");
    let pending: Promise<unknown> = Promise.resolve();
    function run<T>(task: () => Promise<T>): Promise<T> {
        const result = pending.then(task);
        pending = result.catch(() => undefined);
        return result;
    }
    async function read(file: string) {
        try { return await fs.readFile(file); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    }
    async function write(file: string, data: string | Uint8Array) {
        await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
            await fs.writeFile(temporary, data, { mode: 0o600 });
            await fs.rename(temporary, file);
        } finally { await fs.rm(temporary, { force: true }); }
    }
    function statePath(key: string) {
        if (!stateKeys.has(key)) throw new Error("不支持的状态键");
        return path.join(root, "state", `${key.split(":")[1]}.json`);
    }
    function mediaPath(namespace: MediaNamespace, key: string) {
        if (!mediaNamespaces.has(namespace) || typeof key !== "string" || !/^(image|video|audio|file|video-reference|audio-reference):[A-Za-z0-9_-]+$/.test(key)) throw new Error("不支持的媒体键");
        if (namespace !== "media" && !key.startsWith("image:")) throw new Error("媒体类型不匹配");
        return path.join(root, namespace, key.replace(":", "_"));
    }
    const configPath = path.join(root, "config.json");
    return {
        getState: (key: string) => run(async () => (await read(statePath(key)))?.toString("utf8") ?? null),
        setState: (key: string, value: string) => run(async () => {
            const file = statePath(key);
            if (typeof value !== "string") throw new Error("状态必须是 JSON 字符串");
            JSON.parse(value);
            await write(file, value);
        }),
        removeState: (key: string) => run(() => fs.rm(statePath(key), { force: true })),
        getConfig: () => run(async () => (await read(configPath))?.toString("utf8") ?? null),
        setConfig: (value: string) => run(async () => {
            if (typeof value !== "string") throw new Error("配置必须是 JSON 字符串");
            JSON.parse(value);
            await write(configPath, value);
        }),
        removeConfig: () => run(() => fs.rm(configPath, { force: true })),
        getMedia: (namespace: MediaNamespace, key: string) => run(async (): Promise<StoredMedia | null> => {
            const file = mediaPath(namespace, key);
            const bytes = await read(`${file}.bin`);
            if (!bytes) return null;
            const mime = await read(`${file}.json`);
            return { bytes, mimeType: mime ? JSON.parse(mime.toString("utf8")).mimeType : "application/octet-stream" };
        }),
        setMedia: (namespace: MediaNamespace, key: string, value: StoredMedia) => run(async () => {
            const file = mediaPath(namespace, key);
            if (!value || !(value.bytes instanceof Uint8Array) || typeof value.mimeType !== "string" || /[\r\n]/.test(value.mimeType)) throw new Error("媒体内容无效");
            await write(`${file}.json`, JSON.stringify({ mimeType: value.mimeType }));
            await write(`${file}.bin`, value.bytes);
        }),
        removeMedia: (namespace: MediaNamespace, key: string) => run(async () => {
            const file = mediaPath(namespace, key);
            await fs.rm(`${file}.bin`, { force: true });
            await fs.rm(`${file}.json`, { force: true });
        }),
        mediaKeys: (namespace: MediaNamespace) => run(async () => {
            mediaPath(namespace, "image:validation");
            let names: string[];
            try { names = await fs.readdir(path.join(root, namespace)); }
            catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
            return names.filter((name) => name.endsWith(".bin")).map((name) => name.slice(0, -4).replace("_", ":"));
        }),
    };
}
