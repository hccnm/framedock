import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { createDesktopStorage } from "./storage-files.js";

type RecordValue = Record<string, any>;
type Payload = { folder: RecordValue | null; pages: RecordValue[] };
type Media = { key: string; hash: string; mimeType: string };
type Manifest = Payload & { format: "framedock-project"; version: 1; media: Media[] };
type Binding = { id: string; directory: string; digest: string };
const filename = "framedock.project.json";
const privateDirectory = "canvas";
const keyPattern = /^(image|video|audio|file|video-reference|audio-reference):[A-Za-z0-9_-]+$/;
const hash = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const object = (value: unknown): value is RecordValue => Boolean(value && typeof value === "object" && !Array.isArray(value));
const identifier = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value);
function requireValue(ok: unknown, message = "项目目录数据损坏") { if (!ok) throw new Error(message); }
function validatePayload(value: unknown): asserts value is Payload {
    requireValue(object(value), "项目数据无效：必须是对象");
    const data = value as Payload;
    requireValue(Array.isArray(data.pages), "项目数据无效：pages 必须是数组");
    requireValue(data.folder === null || object(data.folder), "项目数据无效：folder 必须是对象或 null");
    if (data.folder) {
        requireValue(identifier(data.folder.id), "项目数据无效：folder.id 只能包含英文字母、数字、下划线和短横线");
        requireValue(typeof data.folder.name === "string" && typeof data.folder.createdAt === "string" && typeof data.folder.updatedAt === "string", "项目数据无效：folder.name、createdAt 和 updatedAt 必须是字符串");
    }
    requireValue(data.folder || data.pages.length === 1, "项目数据无效：独立创作页必须且只能包含一页");
    const ids = new Set<string>();
    for (const [pageIndex, page] of data.pages.entries()) {
        const location = `创作页 ${pageIndex + 1}`;
        requireValue(object(page), `${location}数据无效：必须是对象`);
        requireValue(identifier(page.id), `${location}数据无效：id 只能包含英文字母、数字、下划线和短横线`);
        requireValue(page.id !== data.folder?.id && !ids.has(page.id), `${location}数据无效：id 与项目或其他创作页重复`);
        ids.add(page.id);
        requireValue(typeof page.title === "string" && typeof page.createdAt === "string" && typeof page.updatedAt === "string", `${location}数据无效：title、createdAt 和 updatedAt 必须是字符串`);
        requireValue(page.projectFolderId === (data.folder?.id ?? null), `${location}数据无效：projectFolderId 与所属项目不一致`);
        requireValue(Array.isArray(page.nodes) && Array.isArray(page.connections) && Array.isArray(page.chatSessions), `${location}数据无效：nodes、connections 和 chatSessions 必须是数组`);
        requireValue(object(page.viewport) && [page.viewport.x, page.viewport.y, page.viewport.k].every(Number.isFinite) && page.viewport.k > 0, `${location}数据无效：viewport 坐标和缩放必须是有限数值，缩放必须大于 0`);
        requireValue(["lines", "dots", "blank"].includes(page.backgroundMode) && typeof page.showImageInfo === "boolean" && (page.activeChatId === null || typeof page.activeChatId === "string"), `${location}数据无效：backgroundMode、showImageInfo 或 activeChatId 格式不正确`);
        const nodes = new Set<string>();
        // 节点和连线 ID 仅用于 JSON 内部引用，不作为文件路径，保留助手及插件提供的原始值。
        for (const [nodeIndex, node] of page.nodes.entries()) {
            const item = `${location}，节点 ${nodeIndex + 1}`;
            requireValue(object(node), `${item}数据无效：必须是对象`);
            requireValue(typeof node.id === "string" && node.id.length > 0, `${item}数据无效：id 必须是非空字符串`);
            requireValue(!nodes.has(node.id), `${item}数据无效：id 与其他节点重复`);
            requireValue(typeof node.type === "string" && typeof node.title === "string", `${item}数据无效：type 和 title 必须是字符串`);
            nodes.add(node.id);
            requireValue(object(node.position) && [node.position.x, node.position.y, node.width, node.height].every(Number.isFinite), `${item}数据无效：position.x、position.y、width 和 height 必须是有限数值`);
            requireValue(node.metadata === undefined || object(node.metadata), `${item}数据无效：metadata 必须是对象`);
        }
        const connections = new Set<string>();
        for (const [edgeIndex, edge] of page.connections.entries()) {
            const item = `${location}，连线 ${edgeIndex + 1}`;
            requireValue(object(edge), `${item}数据无效：必须是对象`);
            requireValue(typeof edge.id === "string" && edge.id.length > 0, `${item}数据无效：id 必须是非空字符串`);
            requireValue(!connections.has(edge.id), `${item}数据无效：id 与其他连线重复`);
            requireValue(nodes.has(edge.fromNodeId), `${item}数据无效：fromNodeId 引用的起点节点不存在`);
            requireValue(nodes.has(edge.toNodeId), `${item}数据无效：toNodeId 引用的终点节点不存在`);
            connections.add(edge.id);
        }
        for (const session of page.chatSessions) requireValue(object(session) && typeof session.id === "string" && typeof session.title === "string" && Array.isArray(session.messages) && session.messages.every((message: unknown) => object(message) && typeof message.id === "string" && typeof message.role === "string" && typeof message.text === "string"), `${location}数据无效：chatSessions 中的对话或消息字段格式不正确`);
    }
}
function mediaKeys(value: unknown, keys = new Set<string>()) {
    if (typeof value === "string" && keyPattern.test(value)) keys.add(value);
    else if (Array.isArray(value)) value.forEach((item) => mediaKeys(item, keys));
    else if (object(value)) {
        if (value.storageKey !== undefined && value.storageKey !== "") requireValue(typeof value.storageKey === "string" && keyPattern.test(value.storageKey), "媒体引用无效");
        Object.values(value).forEach((item) => mediaKeys(item, keys));
    }
    return keys;
}
// blob URL 只在当前进程有效，持久媒体由 storageKey 在打开时重建。
function portable(value: any): any {
    if (Array.isArray(value)) return value.map(portable);
    if (object(value) && ["image", "video", "audio"].includes(value.type) && object(value.metadata)) {
        const metadata = value.metadata;
        if (typeof metadata.content === "string" && /^https?:/.test(metadata.content)) requireValue(keyPattern.test(metadata.storageKey ?? ""), "存在尚未保存到本机的媒体，请先保存媒体后另存项目");
    }
    if (!object(value)) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
        if (typeof item === "string" && ["content", "url", "dataUrl"].includes(key) && typeof value.storageKey === "string" && keyPattern.test(value.storageKey)) return [key, value.storageKey];
        if (typeof item === "string" && item.startsWith("blob:")) {
            requireValue(typeof value.storageKey === "string" && keyPattern.test(value.storageKey), "存在未落盘的媒体，请等待媒体保存后重试");
            return [key, value.storageKey];
        }
        return [key, portable(item)];
    }));
}
async function regularRead(file: string) {
    requireValue((await fs.lstat(file)).isFile(), "项目路径不是普通文件");
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try { requireValue((await handle.stat()).isFile(), "项目路径不是普通文件"); return await handle.readFile(); }
    finally { await handle.close(); }
}
async function safeDirectory(directory: string) {
    requireValue(path.resolve(directory) === await fs.realpath(directory) && (await fs.lstat(directory)).isDirectory(), "项目目录包含符号链接或路径越界");
}
async function statIfExists(file: string) {
    try { return await fs.lstat(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function projectLayout(directory: string) {
    await safeDirectory(directory);
    const layouts: string[] = [];
    for (const name of ["", privateDirectory, ".framedock"]) {
        const candidate = path.join(directory, name);
        if (!await statIfExists(candidate)) continue;
        await safeDirectory(candidate);
        if (await statIfExists(path.join(candidate, filename))) layouts.push(candidate);
    }
    requireValue(layouts.length <= 1, "目录同时包含多种项目清单，请先处理冲突；拒绝打开或覆盖");
    requireValue(layouts.length === 1, "目录没有项目清单，请先创建或打开已有项目目录");
    const dataDirectory = layouts[0];
    return { dataDirectory, internalPaths: dataDirectory === directory ? [filename, "media"] : [path.basename(dataDirectory)] };
}
async function atomicWrite(file: string, bytes: string | Uint8Array, exclusive = false) {
    await safeDirectory(path.dirname(file));
    const temporary = `${file}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        await safeDirectory(path.dirname(file));
        if (exclusive) await fs.link(temporary, file);
        else await fs.rename(temporary, file);
        const parent = await fs.open(path.dirname(file), constants.O_RDONLY);
        try { await parent.sync(); } finally { await parent.close(); }
    } finally { await handle.close().catch(() => undefined); await fs.rm(temporary, { force: true }); }
}

/** 路径只由主进程的 native picker 授权；渲染器只持有项目 ID。 */
export function createProjectDirectories(userDataPath: string, storage: ReturnType<typeof createDesktopStorage>) {
    const indexFile = path.join(userDataPath, "project-directories.json");
    let bindings: Binding[] | undefined;
    const savedPayloads = new Map<string, string>();
    const verifiedMedia = new Map<string, { signature: string; digest: string }>();
    async function verifyMedia(file: string, digest: string) {
        const stat = await fs.lstat(file);
        requireValue(stat.isFile() && !stat.isSymbolicLink(), "媒体路径不是普通文件");
        const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
        const cached = verifiedMedia.get(file);
        if (cached?.signature === signature && cached.digest === digest) return;
        requireValue(hash(await regularRead(file)) === digest, "项目媒体缺失或损坏，拒绝覆盖");
        verifiedMedia.set(file, { signature, digest });
    }
    let pending: Promise<unknown> = Promise.resolve();
    const run = <T>(task: () => Promise<T>) => { const result = pending.then(task); pending = result.catch(() => undefined); return result; };
    const fileRun = <T>(task: () => Promise<T>) => run(async () => {
        try { return await task(); }
        catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            if (code) throw new Error(`无法读取项目文件（${code}）`);
            throw error;
        }
    });
    async function load() {
        if (bindings) return bindings;
        try {
            const parsed = JSON.parse((await regularRead(indexFile)).toString("utf8"));
            requireValue(parsed.version === 1 && Array.isArray(parsed.bindings), "项目目录索引无效，拒绝覆盖");
            const ids = new Set<string>(), directories = new Set<string>();
            for (const item of parsed.bindings) {
                requireValue(object(item) && identifier(item.id) && !ids.has(item.id) && typeof item.directory === "string" && path.isAbsolute(item.directory) && !directories.has(item.directory) && /^[a-f0-9]{64}$/.test(item.digest), "项目目录索引冲突，拒绝覆盖");
                ids.add(item.id); directories.add(item.directory);
            }
            bindings = parsed.bindings;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; bindings = []; }
        return bindings!;
    }
    async function remember(next: Binding[]) {
        await atomicWrite(indexFile, JSON.stringify({ version: 1, bindings: next }));
        bindings = next;
    }
    async function read(directory: string, loadBlobs = true) {
        const layout = await projectLayout(directory);
        const { dataDirectory } = layout;
        const bytes = await regularRead(path.join(dataDirectory, filename));
        const manifest = JSON.parse(bytes.toString("utf8")) as Manifest;
        requireValue(manifest.format === "framedock-project" && manifest.version === 1, "不支持的项目目录格式或版本，拒绝覆盖");
        validatePayload(manifest);
        requireValue(Array.isArray(manifest.media));
        const keys = mediaKeys(manifest.pages);
        requireValue(keys.size === manifest.media.length, "媒体清单不完整或重复");
        const blobs = new Map<string, Buffer>();
        if (keys.size) await safeDirectory(path.join(dataDirectory, "media"));
        for (const item of manifest.media) {
            requireValue(object(item) && keys.delete(item.key) && /^[a-f0-9]{64}$/.test(item.hash) && typeof item.mimeType === "string" && !/[\r\n]/.test(item.mimeType), "媒体清单无效");
            const file = path.join(dataDirectory, "media", `${item.hash}.bin`);
            await verifyMedia(file, item.hash);
            if (loadBlobs) blobs.set(item.key, await regularRead(file));
        }
        return { manifest, blobs, digest: hash(bytes), ...layout };
    }
    async function write(directory: string, payload: Payload, existing: Media[] = [], exclusive = false) {
        validatePayload(payload);
        const clean = portable(payload) as Payload;
        const media: Media[] = [];
        await safeDirectory(directory);
        const keys = mediaKeys(clean.pages);
        if (keys.size) {
            await fs.mkdir(path.join(directory, "media"), { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
            await safeDirectory(path.join(directory, "media"));
        }
        for (const key of keys) {
            const previous = existing.find((item) => item.key === key);
            if (previous) { media.push(previous); continue; }
            const value = await storage.getMedia(key.startsWith("image:") ? "images" : "media", key);
            requireValue(value, `缺少媒体 ${key}，项目目录未覆盖`);
            const digest = hash(value!.bytes);
            const file = path.join(directory, "media", `${digest}.bin`);
            try { await verifyMedia(file, digest); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; await atomicWrite(file, value!.bytes); }
            media.push({ key, hash: digest, mimeType: value!.mimeType });
        }
        const text = JSON.stringify({ format: "framedock-project", version: 1, ...clean, media } satisfies Manifest);
        const currentManifest = path.join(directory, filename);
        try { requireValue((await fs.lstat(currentManifest)).isFile() && !(await fs.lstat(currentManifest)).isSymbolicLink(), "项目清单包含符号链接"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        await atomicWrite(currentManifest, text, exclusive);
        return hash(text);
    }
    async function pageDirectory(pageId: string) {
        requireValue(identifier(pageId), "创作页 ID 无效");
        const value = await storage.getState("framedock:canvas_store");
        requireValue(value !== null, "没有已保存的创作页，请先保存项目");
        const persisted = JSON.parse(value!);
        const state = persisted?.state;
        requireValue(object(state) && Array.isArray(state.projects) && Array.isArray(state.projectFolders), "画布存储损坏，无法读取项目文件");
        const pages = state.projects.filter((item: unknown) => object(item) && item.id === pageId);
        requireValue(pages.length === 1, "创作页不存在或 ID 冲突");
        const folderId = pages[0].projectFolderId;
        requireValue(folderId === null || (identifier(folderId) && state.projectFolders.filter((item: unknown) => object(item) && item.id === folderId).length === 1), "创作页所属项目不存在或数据无效");
        const binding = (await load()).find((item) => item.id === (folderId ?? pageId));
        requireValue(binding, "创作页尚未绑定已授权的项目目录");
        return { directory: binding!.directory, scope: hash(JSON.stringify([folderId ?? pageId, binding!.directory])), ...await projectLayout(binding!.directory) };
    }
    function visibleParts(relative: string, internalPaths: string[]) {
        requireValue(typeof relative === "string" && !path.isAbsolute(relative) && !path.win32.isAbsolute(relative) && !relative.includes("\\") && !relative.includes("\0"), "只允许项目内相对路径");
        const parts = relative === "" ? [] : relative.split("/");
        const skillRoot = [".agents", ".claude"].includes(parts[0]);
        requireValue(parts.every((part, index) => part && !part.includes(":") && (!part.startsWith(".") || (index === 0 && skillRoot))) && (!skillRoot || parts.length === 1 || parts[1] === "skills"), "拒绝隐藏路径或路径越界");
        requireValue(!internalPaths.includes(parts[0]), "不能读取项目内部文件");
        return parts;
    }
    async function resolveFilePath(root: string, parts: string[]) {
        await safeDirectory(root);
        let file = root;
        for (const [index, part] of parts.entries()) {
            file = path.join(file, part);
            const stat = await fs.lstat(file);
            requireValue(!stat.isSymbolicLink(), "项目文件路径包含符号链接");
            requireValue(index === parts.length - 1 || stat.isDirectory(), "项目路径不是目录");
        }
        requireValue(file === await fs.realpath(file), "项目文件路径包含符号链接或路径越界");
        return file;
    }
    return {
        locations: () => run(async () => (await load()).map(({ id, directory }) => ({ id, directory }))),
        listFiles: (pageId: string, relative = "", expectedScope?: string) => fileRun(async () => {
            const project = await pageDirectory(pageId);
            requireValue(expectedScope === undefined || expectedScope === project.scope, "项目目录绑定已变化，请重新发起任务");
            const parts = visibleParts(relative, project.internalPaths);
            const directory = await resolveFilePath(project.directory, parts);
            await safeDirectory(directory);
            const entries: { name: string; path: string; kind: "file" | "directory"; size?: number; modifiedAt: string }[] = [];
            for (const name of await fs.readdir(directory)) {
                if ((name.startsWith(".") && !(parts.length === 0 && [".agents", ".claude"].includes(name))) || name.includes("\\") || name.includes(":")) continue;
                if (parts.length === 1 && [".agents", ".claude"].includes(parts[0]) && name !== "skills") continue;
                if (!parts.length && project.internalPaths.includes(name)) continue;
                const stat = await fs.lstat(path.join(directory, name));
                if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (name.startsWith(".") && !stat.isDirectory())) continue;
                entries.push({ name, path: [...parts, name].join("/"), kind: stat.isDirectory() ? "directory" : "file", ...(stat.isFile() ? { size: stat.size } : {}), modifiedAt: stat.mtime.toISOString() });
            }
            return { directory: parts.join("/"), entries, scope: project.scope };
        }),
        readFile: (pageId: string, relative: string, expectedScope?: string) => fileRun(async () => {
            const project = await pageDirectory(pageId);
            requireValue(expectedScope === undefined || expectedScope === project.scope, "项目目录绑定已变化，请重新发起任务");
            const parts = visibleParts(relative, project.internalPaths);
            requireValue(parts.length && !(parts.length === 1 && [".agents", ".claude"].includes(parts[0])), "请选择项目内的文本文件");
            const file = await resolveFilePath(project.directory, parts);
            const bytes = await regularRead(file);
            let content: string;
            try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
            catch { throw new Error("文件不是有效 UTF-8 文本"); }
            requireValue(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content), "文件是二进制内容，无法作为文本读取");
            const stat = await fs.lstat(file);
            return { path: parts.join("/"), content, modifiedAt: stat.mtime.toISOString() };
        }),
        saveAs: (directory: string, payload: Payload) => run(async () => {
            validatePayload(payload);
            await safeDirectory(directory);
            const current = await load();
            const id = payload.folder?.id ?? payload.pages[0].id;
            const existsMessage = "目录已有项目数据，请使用打开项目目录；不会覆盖原文件";
            requireValue(!await statIfExists(path.join(directory, filename)) && !await statIfExists(path.join(directory, ".framedock", filename)), existsMessage);
            const dataDirectory = path.join(directory, privateDirectory);
            await fs.mkdir(dataDirectory, { mode: 0o700 }).catch((error) => { if (error.code !== "EEXIST") throw error; });
            await safeDirectory(dataDirectory);
            requireValue((await fs.readdir(dataDirectory)).length === 0, existsMessage);
            // 排他标记覆盖已有空目录和多进程同时初始化；失败保留标记，避免覆盖部分数据。
            const marker = path.join(dataDirectory, "initializing");
            let lock;
            try { lock = await fs.open(marker, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
            catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(existsMessage); throw error; }
            await lock.close();
            requireValue(!await statIfExists(path.join(directory, filename)) && !await statIfExists(path.join(directory, ".framedock", filename)) && (await fs.readdir(dataDirectory)).every((name) => name === "initializing"), existsMessage);
            requireValue(!current.some((item) => item.directory === directory), "目录已经绑定其他项目，请使用打开项目目录");
            const digest = await write(dataDirectory, payload, [], true);
            await fs.rm(marker);
            savedPayloads.set(id, hash(JSON.stringify(portable(payload))));
            await remember([...current.filter((item) => item.id !== id), { id, directory, digest }]);
            return { id, directory };
        }),
        open: (directory: string, state: { projects: RecordValue[]; projectFolders: RecordValue[] }) => run(async () => {
            requireValue(object(state) && Array.isArray(state.projects) && Array.isArray(state.projectFolders));
            // 打开是新的信任边界，必须重新完整校验媒体。
            for (const file of verifiedMedia.keys()) if (file.startsWith(directory + path.sep)) verifiedMedia.delete(file);
            const loaded = await read(directory);
            const { manifest, blobs, digest } = loaded;
            const id = manifest.folder?.id ?? manifest.pages[0].id;
            const current = await load();
            const stored = current.find((item) => item.id === id);
            if (stored && stored.directory !== directory && stored.directory === loaded.dataDirectory && (manifest.folder ? state.projectFolders.some((item) => item.id === id) : state.projects.some((item) => item.id === id))) {
                requireValue(stored.digest === digest, "项目目录已被外部修改，请先处理冲突");
                requireValue(!current.some((item) => item.id !== id && item.directory === directory), "目录已经绑定其他项目");
                await remember(current.map((item) => item.id === id ? { ...item, directory } : item));
                return { folder: manifest.folder, pages: manifest.pages, location: { id, directory }, alreadyOpen: true };
            }
            const already = current.find((item) => item.id === id && item.directory === directory);
            if (already && (manifest.folder ? state.projectFolders.some((item) => item.id === id) : state.projects.some((item) => item.id === id))) {
                requireValue(already.digest === digest, "项目目录已被外部修改，请先处理冲突");
                return { folder: manifest.folder, pages: manifest.pages, location: { id, directory }, alreadyOpen: true };
            }
            requireValue(!current.some((item) => (item.id === id || item.directory === directory) && !(item.id === id && item.directory === directory)) && !state.projectFolders.some((item) => item.id === id) && !state.projects.some((item) => item.id === id || manifest.pages.some((page) => page.id === item.id)), "项目或创作页 ID 已存在，请从项目库继续；不会覆盖现有数据");
            for (const item of manifest.media) {
                const existing = await storage.getMedia(item.key.startsWith("image:") ? "images" : "media", item.key);
                requireValue(!existing || (hash(existing.bytes) === item.hash && existing.mimeType === item.mimeType), "媒体 ID 与本机缓存冲突，拒绝覆盖");
            }
            for (const item of manifest.media) await storage.setMedia(item.key.startsWith("image:") ? "images" : "media", item.key, { bytes: blobs.get(item.key)!, mimeType: item.mimeType });
            await remember([...current.filter((item) => item.id !== id), { id, directory, digest }]);
            savedPayloads.set(id, hash(JSON.stringify({ folder: manifest.folder, pages: manifest.pages })));
            return { folder: manifest.folder, pages: manifest.pages, location: { id, directory } };
        }),
        sync: (state: { projects: RecordValue[]; projectFolders: RecordValue[] }) => run(async () => {
            requireValue(object(state) && Array.isArray(state.projects) && Array.isArray(state.projectFolders));
            const current = await load();
            const next: Binding[] = [];
            // 先保存所有目标，成功后才从来源移除跨目录移动的页面。
            const jobs: { binding: Binding; payload: Payload; previous: Awaited<ReturnType<typeof read>> }[] = [];
            for (const binding of current) {
                const folder = state.projectFolders.find((item) => item.id === binding.id) ?? null;
                const pages = folder ? state.projects.filter((item) => item.projectFolderId === folder.id) : state.projects.filter((item) => item.id === binding.id && item.projectFolderId === null);
                // 解散、移出或删除只解除绑定，原目录作为最后一次保存保留。
                if (!folder && !pages.length) continue;
                const payload = { folder, pages };
                const payloadDigest = hash(JSON.stringify(portable(payload)));
                const previous = await read(binding.directory, false);
                requireValue(previous.digest === binding.digest, `项目目录已被外部修改：${binding.directory}，拒绝覆盖`);
                if (savedPayloads.get(binding.id) === payloadDigest) { next.push(binding); continue; }
                if (hash(JSON.stringify({ folder: previous.manifest.folder, pages: previous.manifest.pages })) === payloadDigest) {
                    savedPayloads.set(binding.id, payloadDigest); next.push(binding); continue;
                }
                jobs.push({ binding, payload, previous });
            }
            for (const { binding, payload, previous } of jobs) {
                const retained = previous.manifest.pages.filter((old) => !payload.pages.some((page) => page.id === old.id) && state.projects.some((page) => page.id === old.id));
                binding.digest = await write(previous.dataDirectory, { ...payload, pages: [...payload.pages, ...retained.map((page) => ({ ...page, projectFolderId: payload.folder?.id ?? null }))] }, previous.manifest.media);
                await remember(current);
            }
            for (const { binding, payload, previous } of jobs) {
                const retained = previous.manifest.pages.some((old) => !payload.pages.some((page) => page.id === old.id) && state.projects.some((page) => page.id === old.id));
                if (retained) {
                    binding.digest = await write(previous.dataDirectory, payload, previous.manifest.media);
                    await remember(current);
                }
                savedPayloads.set(binding.id, hash(JSON.stringify(portable(payload))));
                next.push(binding);
            }
            if (JSON.stringify(current) === JSON.stringify(next)) return;
            await remember(next);
        }),
    };
}
