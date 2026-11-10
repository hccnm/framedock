import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stripTypeScriptTypes } from "node:module";
const load = async (file) => import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(await fs.readFile(new URL(file, import.meta.url), "utf8"))).toString("base64")}`);
const { createProjectDirectories } = await load("../src/project-files.ts");
const { createDesktopStorage } = await load("../src/storage-files.ts");
const page = (id, folder = "folder") => ({ id, title: id, projectFolderId: folder, createdAt: "now", updatedAt: "now", nodes: [{ id: `node_${id}`, type: "image", title: "图片", position: { x: 0, y: 0 }, width: 10, height: 10, metadata: { storageKey: "image:shared", content: "blob:temporary" } }], connections: [], chatSessions: [], activeChatId: null, viewport: { x: 0, y: 0, k: 1 }, backgroundMode: "lines", showImageInfo: false });
const folder = { id: "folder", name: "多页项目", createdAt: "now", updatedAt: "now" };

test("目录多页往返、媒体去重、未变零媒体读取、ID/未知版本/缺媒体/符号链接拒覆盖", async () => {
    const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "framedock-project-")));
    try {
        const user = path.join(temporary, "user"), target = path.join(temporary, "project"), otherUser = path.join(temporary, "other");
        await Promise.all([user, target, otherUser].map((directory) => fs.mkdir(directory)));
        const storage = createDesktopStorage(user);
        await storage.setMedia("images", "image:shared", { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" });
        let mediaReads = 0;
        const directories = createProjectDirectories(user, { ...storage, getMedia: (...args) => { mediaReads++; return storage.getMedia(...args); } });
        const payload = { folder, pages: [page("first"), page("second")] };
        await directories.saveAs(target, payload);
        assert.equal((await fs.readdir(path.join(target, "canvas", "media"))).length, 1);
        const manifestFile = path.join(target, "canvas", "framedock.project.json");
        const original = await fs.readFile(manifestFile, "utf8");
        assert.equal(JSON.parse(original).pages[0].nodes[0].metadata.content, "image:shared");
        mediaReads = 0;
        await directories.sync({ projectFolders: [folder], projects: payload.pages });
        assert.equal(mediaReads, 0);
        assert.equal(await fs.readFile(manifestFile, "utf8"), original);
        const otherStorage = createDesktopStorage(otherUser);
        const openedBy = createProjectDirectories(otherUser, otherStorage);
        const opened = await openedBy.open(target, { projects: [], projectFolders: [] });
        assert.deepEqual(opened.pages.map((item) => item.id), ["first", "second"]);
        assert.deepEqual((await otherStorage.getMedia("images", "image:shared")).bytes, Buffer.from([1, 2, 3]));
        assert.equal((await openedBy.open(target, { projects: opened.pages, projectFolders: [folder] })).alreadyOpen, true);
        await assert.rejects(directories.saveAs(target, payload), /打开项目目录/);
        const malformed = JSON.parse(original);
        malformed.media[0].hash = "../../escape";
        await fs.writeFile(manifestFile, JSON.stringify(malformed));
        await assert.rejects(openedBy.open(target, { projects: [], projectFolders: [] }), /媒体清单/);
        await fs.writeFile(manifestFile, JSON.stringify({ ...JSON.parse(original), version: 999 }));
        await assert.rejects(openedBy.open(target, { projects: [], projectFolders: [] }), /版本/);
        const changed = { projectFolders: [folder], projects: payload.pages.map((item) => ({ ...item, title: "已改" })) };
        await assert.rejects(directories.sync(changed), /版本/);
        await fs.writeFile(manifestFile, original);
        const mediaFile = path.join(target, "canvas", "media", (await fs.readdir(path.join(target, "canvas", "media")))[0]);
        await fs.rm(mediaFile);
        await assert.rejects(directories.sync(changed));
        assert.equal(await fs.readFile(manifestFile, "utf8"), original);
        await fs.symlink(path.join(temporary, "user"), mediaFile);
        await assert.rejects(directories.sync(changed), /普通文件/);
        assert.equal(await fs.readFile(manifestFile, "utf8"), original);
        await fs.rm(mediaFile);
        await fs.writeFile(mediaFile, new Uint8Array([1, 2, 3]));
        await fs.writeFile(manifestFile, JSON.stringify({ ...JSON.parse(original), folder: { ...folder, name: "外部修改" } }));
        await assert.rejects(directories.sync(changed), /外部修改/);
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("中文及插件节点 ID 与连线 ID 在保存、同步和重新打开后原样保留", async () => {
    const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "framedock-node-ids-")));
    try {
        const user = path.join(temporary, "user"), target = path.join(temporary, "project"), other = path.join(temporary, "other");
        await Promise.all([user, target, other].map((directory) => fs.mkdir(directory)));
        const original = page("first");
        original.nodes = ["中文节点", "markdown:doc-1", "节点/分镜.一"].map((id) => ({ ...original.nodes[0], id, type: "text", metadata: { content: "保留文本" } }));
        original.connections = [{ id: "连线:一", fromNodeId: original.nodes[0].id, toNodeId: original.nodes[1].id }];
        const directories = createProjectDirectories(user, createDesktopStorage(user));
        await directories.saveAs(target, { folder, pages: [original] });
        const changed = structuredClone(original);
        changed.nodes[0].title = "更新标题";
        changed.connections.push({ id: "连线/二", fromNodeId: changed.nodes[1].id, toNodeId: changed.nodes[2].id });
        await directories.sync({ projectFolders: [folder], projects: [changed] });
        const saved = JSON.parse(await fs.readFile(path.join(target, "canvas", "framedock.project.json"), "utf8"));
        assert.deepEqual(saved.pages, [changed]);
        const opened = await createProjectDirectories(other, createDesktopStorage(other)).open(target, { projects: [], projectFolders: [] });
        assert.deepEqual(opened.pages, [changed]);
        assert.deepEqual(original.nodes.map((node) => node.id), changed.nodes.map((node) => node.id));
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("无效节点与连线提示具体字段和原因，拒绝覆盖原项目", async () => {
    const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "framedock-validation-")));
    try {
        const user = path.join(temporary, "user"), target = path.join(temporary, "project");
        await Promise.all([user, target].map((directory) => fs.mkdir(directory)));
        const valid = page("first");
        valid.nodes[0].metadata = { content: "文本" };
        const directories = createProjectDirectories(user, createDesktopStorage(user));
        await directories.saveAs(target, { folder, pages: [valid] });
        const manifest = path.join(target, "canvas", "framedock.project.json");
        const before = await fs.readFile(manifest, "utf8");
        const cases = [
            [(p) => { p.nodes[0].id = ""; }, /节点 1.*id.*非空字符串/],
            [(p) => { p.nodes[0].id = 123; }, /节点 1.*id.*非空字符串/],
            [(p) => { p.nodes.push(structuredClone(p.nodes[0])); }, /节点 2.*id.*重复/],
            [(p) => { delete p.nodes[0].title; }, /节点 1.*title.*字符串/],
            [(p) => { p.nodes[0].position.x = NaN; }, /节点 1.*position.*有限数值/],
            [(p) => { p.nodes[0].metadata = []; }, /节点 1.*metadata.*对象/],
            [(p) => { p.connections = [{ id: "", fromNodeId: p.nodes[0].id, toNodeId: p.nodes[0].id }]; }, /连线 1.*id.*非空字符串/],
            [(p) => { p.connections = [{ id: "edge", fromNodeId: "missing", toNodeId: p.nodes[0].id }]; }, /连线 1.*fromNodeId.*不存在/],
            [(p) => { p.connections = [{ id: "edge", fromNodeId: p.nodes[0].id, toNodeId: "missing" }]; }, /连线 1.*toNodeId.*不存在/],
            [(p) => { const edge = { id: "edge", fromNodeId: p.nodes[0].id, toNodeId: p.nodes[0].id }; p.connections = [edge, { ...edge }]; }, /连线 2.*id.*重复/],
            [(p) => { p.id = "无效页面ID"; }, /创作页 1.*id/],
        ];
        for (const [mutate, message] of cases) {
            const invalid = structuredClone(valid);
            mutate(invalid);
            await assert.rejects(directories.sync({ projectFolders: [folder], projects: [invalid] }), message);
            assert.equal(await fs.readFile(manifest, "utf8"), before);
        }
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("非空作品目录共存、初始化并发及保留既有内容", async () => {
    const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "framedock-coexist-")));
    try {
        const user = path.join(temporary, "user"), other = path.join(temporary, "other"), target = path.join(temporary, "project");
        await Promise.all([user, other, target].map((directory) => fs.mkdir(directory)));
        await fs.writeFile(path.join(target, "剧本.md"), "原始剧本");
        await fs.mkdir(path.join(target, "media"));
        await fs.writeFile(path.join(target, "media", "original.txt"), "用户素材");
        const payload = { folder, pages: [] };
        const directories = createProjectDirectories(user, createDesktopStorage(user));
        const competing = createProjectDirectories(other, createDesktopStorage(other));
        const results = await Promise.allSettled([directories.saveAs(target, payload), competing.saveAs(target, payload)]);
        assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
        assert.match(results.find((result) => result.status === "rejected").reason.message, /打开项目目录/);
        assert.equal(await fs.readFile(path.join(target, "剧本.md"), "utf8"), "原始剧本");
        assert.equal(await fs.readFile(path.join(target, "media", "original.txt"), "utf8"), "用户素材");
        assert.equal(JSON.parse(await fs.readFile(path.join(target, "canvas", "framedock.project.json"))).folder.id, folder.id);
        const occupied = path.join(temporary, "occupied");
        await fs.mkdir(path.join(occupied, "canvas"), { recursive: true });
        await fs.writeFile(path.join(occupied, "canvas", "unknown"), "保留");
        await assert.rejects(directories.saveAs(occupied, payload), /打开项目目录/);
        assert.deepEqual(await fs.readdir(path.join(occupied, "canvas")), ["unknown"]);
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("旧格式原位打开同步，两种清单同时存在拒绝歧义与覆盖", async () => {
    const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "framedock-legacy-")));
    try {
        const user = path.join(temporary, "user"), target = path.join(temporary, "project");
        await Promise.all([user, target].map((directory) => fs.mkdir(directory)));
        const originalPage = page("first");
        originalPage.nodes[0].metadata = { content: "文本" };
        const manifest = { format: "framedock-project", version: 1, folder, pages: [originalPage], media: [] };
        const legacyFile = path.join(target, "framedock.project.json");
        await fs.writeFile(legacyFile, JSON.stringify(manifest));
        await fs.mkdir(path.join(target, "media"));
        await fs.writeFile(path.join(target, "story.md"), "剧本");
        const storage = createDesktopStorage(user), directories = createProjectDirectories(user, storage);
        await assert.rejects(directories.saveAs(target, { folder, pages: [] }), /打开项目目录/);
        const opened = await directories.open(target, { projects: [], projectFolders: [] });
        assert.equal(opened.location.directory, target);
        originalPage.title = "原位同步";
        const state = { projects: [originalPage], projectFolders: [folder] };
        await directories.sync(state);
        assert.equal(JSON.parse(await fs.readFile(legacyFile)).pages[0].title, "原位同步");
        await assert.rejects(fs.stat(path.join(target, "canvas")), { code: "ENOENT" });
        await storage.setState("framedock:canvas_store", JSON.stringify({ state }));
        assert.deepEqual((await directories.listFiles("first")).entries.map((entry) => entry.name), ["story.md"]);
        await assert.rejects(directories.readFile("first", "framedock.project.json"), /内部文件/);
        await assert.rejects(directories.listFiles("first", "media"), /内部文件/);
        const before = await fs.readFile(legacyFile, "utf8");
        await fs.mkdir(path.join(target, "canvas"));
        const modern = path.join(target, "canvas", "framedock.project.json");
        await fs.writeFile(modern, before);
        await assert.rejects(directories.open(target, { projects: [], projectFolders: [] }), /多种/);
        await assert.rejects(directories.sync(state), /多种/);
        await assert.rejects(directories.saveAs(target, { folder, pages: [] }), /打开项目目录/);
        assert.equal(await fs.readFile(legacyFile, "utf8"), before);
        assert.equal(await fs.readFile(modern, "utf8"), before);
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("项目文件按最新页面归属读取最新 UTF8，保护路径、隐藏文件与技能设置", async () => {
    const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "framedock-files-")));
    try {
        const user = path.join(temporary, "user"), target = path.join(temporary, "project"), other = path.join(temporary, "other");
        await Promise.all([user, target, other].map((directory) => fs.mkdir(directory)));
        const storage = createDesktopStorage(user), directories = createProjectDirectories(user, storage);
        await assert.rejects(directories.listFiles("first"), /已保存/);
        const first = page("first");
        first.nodes[0].metadata = { content: "文本" };
        await directories.saveAs(target, { folder, pages: [first] });
        await directories.saveAs(other, { folder: { ...folder, id: "other" }, pages: [] });
        const state = { projects: [first], projectFolders: [folder, { ...folder, id: "other" }] };
        await storage.setState("framedock:canvas_store", JSON.stringify({ state }));
        await fs.mkdir(path.join(target, "references"));
        await fs.mkdir(path.join(target, "media"));
        await fs.mkdir(path.join(target, ".agents", "skills", "writer", "references"), { recursive: true });
        await fs.mkdir(path.join(target, ".claude", "skills"), { recursive: true });
        await fs.writeFile(path.join(target, ".agents", "skills", "writer", "SKILL.md"), "项目技能");
        await fs.writeFile(path.join(target, ".agents", "skills", "writer", "references", "guide.md"), "技能参考");
        await fs.writeFile(path.join(target, ".claude", "settings.json"), "私有设置");
        await fs.writeFile(path.join(target, ".hidden"), "私密");
        await fs.writeFile(path.join(target, "references", "剧本.md"), "第一版");
        await fs.writeFile(path.join(other, "story.md"), "另一项目");
        const listed = await directories.listFiles("first");
        assert.equal(listed.directory, "");
        assert.deepEqual(listed.entries.map((entry) => entry.name).sort(), [".agents", ".claude", "media", "references"]);
        assert.ok(listed.entries.every((entry) => entry.kind === "directory" && !path.isAbsolute(entry.path)));
        const nested = await directories.listFiles("first", "references");
        assert.equal(nested.directory, "references");
        assert.equal(nested.entries[0].path, "references/剧本.md");
        assert.equal(nested.entries[0].size, Buffer.byteLength("第一版"));
        assert.equal((await directories.readFile("first", "references/剧本.md")).content, "第一版");
        await fs.writeFile(path.join(target, "references", "剧本.md"), "最新内容");
        const latest = await directories.readFile("first", "references/剧本.md");
        assert.equal(latest.content, "最新内容");
        assert.equal(latest.path, "references/剧本.md");
        assert.ok(Number.isFinite(Date.parse(latest.modifiedAt)));
        await assert.rejects(directories.readFile("first", "missing.md"), (error) => error.message.includes("ENOENT") && !error.message.includes(target));
        assert.equal((await directories.readFile("first", ".agents/skills/writer/SKILL.md")).content, "项目技能");
        assert.equal((await directories.readFile("first", ".agents/skills/writer/references/guide.md")).content, "技能参考");
        assert.deepEqual((await directories.listFiles("first", ".claude")).entries.map((entry) => entry.name), ["skills"]);
        await fs.symlink(other, path.join(target, "linked"));
        await fs.symlink(path.join(other, "story.md"), path.join(target, "link.md"));
        for (const relative of ["../other/story.md", target, "C:/secret", "references/../.hidden", "canvas/framedock.project.json", ".framedock/framedock.project.json", ".hidden", ".claude/settings.json", "linked/story.md", "link.md", "references"]) {
            await assert.rejects(directories.readFile("first", relative));
        }
        for (const relative of ["..", "canvas", ".hidden", "linked"]) await assert.rejects(directories.listFiles("first", relative));
        assert.ok(!(await directories.listFiles("first")).entries.some((entry) => ["linked", "link.md"].includes(entry.name)));
        await fs.writeFile(path.join(target, "binary.bin"), Buffer.from([0, 1, 2]));
        await fs.writeFile(path.join(target, "invalid.txt"), Buffer.from([0xff, 0xfe]));
        await assert.rejects(directories.readFile("first", "binary.bin"), /二进制/);
        await assert.rejects(directories.readFile("first", "invalid.txt"), /UTF-8/);
        first.projectFolderId = "other";
        await storage.setState("framedock:canvas_store", JSON.stringify({ state }));
        await assert.rejects(directories.readFile("first", "story.md", listed.scope), /绑定已变化/);
        await assert.rejects(directories.listFiles("first", "", listed.scope), /绑定已变化/);
        assert.equal((await directories.readFile("first", "story.md")).content, "另一项目");
        first.projectFolderId = "untrusted";
        state.projectFolders.push({ ...folder, id: "untrusted", directory: target });
        await storage.setState("framedock:canvas_store", JSON.stringify({ state }));
        await assert.rejects(directories.listFiles("first"), /已授权/);
        await storage.setState("framedock:canvas_store", JSON.stringify({ state: {} }));
        await assert.rejects(directories.listFiles("first"), /存储损坏/);
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("移动先目标后来源，解散只解除绑定而保留目录", async () => {
    const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "framedock-move-")));
    try {
        const user = path.join(temporary, "user"), a = path.join(temporary, "a"), b = path.join(temporary, "b");
        await Promise.all([user, a, b].map((directory) => fs.mkdir(directory)));
        const storage = createDesktopStorage(user);
        await storage.setMedia("images", "image:shared", { bytes: new Uint8Array([5]), mimeType: "image/png" });
        const directories = createProjectDirectories(user, storage);
        const secondFolder = { ...folder, id: "folder_b" };
        await directories.saveAs(a, { folder, pages: [page("first")] });
        await directories.saveAs(b, { folder: secondFolder, pages: [] });
        await directories.sync({ projectFolders: [folder, secondFolder], projects: [page("first", "folder_b")] });
        assert.equal(JSON.parse(await fs.readFile(path.join(a, "canvas", "framedock.project.json"))).pages.length, 0);
        assert.equal(JSON.parse(await fs.readFile(path.join(b, "canvas", "framedock.project.json"))).pages[0].id, "first");
        const saved = await fs.readFile(path.join(b, "canvas", "framedock.project.json"), "utf8");
        await directories.sync({ projectFolders: [], projects: [page("first", null)] });
        assert.deepEqual(await directories.locations(), []);
        assert.equal(await fs.readFile(path.join(b, "canvas", "framedock.project.json"), "utf8"), saved);
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("作品根目录与 canvas 存储分离，重新选择作品根修正绑定且保留画布", async () => {
    const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "framedock-work-root-")));
    try {
        const user = path.join(temporary, "user"), target = path.join(temporary, "作品");
        const dataDirectory = path.join(target, "canvas");
        await fs.mkdir(user);
        await fs.mkdir(dataDirectory, { recursive: true });
        await fs.mkdir(path.join(target, "设定集"));
        await fs.writeFile(path.join(target, "设定集", "角色.md"), "角色三视图说明");
        const originalPage = page("first");
        originalPage.nodes[0].metadata = { content: "已有画布" };
        const manifest = path.join(dataDirectory, "framedock.project.json");
        const bytes = JSON.stringify({ format: "framedock-project", version: 1, folder, pages: [originalPage], media: [] });
        await fs.writeFile(manifest, bytes);
        const storage = createDesktopStorage(user), directories = createProjectDirectories(user, storage);
        const state = { projects: [originalPage], projectFolders: [folder] };
        await directories.open(dataDirectory, { projects: [], projectFolders: [] });
        await storage.setState("framedock:canvas_store", JSON.stringify({ state }));
        const previous = await directories.listFiles("first");
        assert.deepEqual(previous.entries, []);
        const opened = await directories.open(target, state);
        assert.equal(opened.alreadyOpen, true);
        assert.equal(opened.location.directory, target);
        assert.deepEqual((await directories.locations()), [{ id: folder.id, directory: target }]);
        assert.deepEqual((await directories.listFiles("first")).entries.map((entry) => entry.name), ["设定集"]);
        assert.equal((await directories.readFile("first", "设定集/角色.md")).content, "角色三视图说明");
        await assert.rejects(directories.listFiles("first", "", previous.scope), /绑定已变化/);
        await assert.rejects(directories.listFiles("first", "canvas"), /内部文件/);
        await assert.rejects(directories.readFile("first", "canvas/framedock.project.json"), /内部文件/);
        assert.equal(await fs.readFile(manifest, "utf8"), bytes);
        originalPage.title = "继续保存";
        await directories.sync(state);
        assert.equal(JSON.parse(await fs.readFile(manifest)).pages[0].title, "继续保存");
        const reopened = createProjectDirectories(user, storage);
        assert.equal((await reopened.readFile("first", "设定集/角色.md")).content, "角色三视图说明");
        assert.equal((await reopened.open(target, state)).alreadyOpen, true);
        await assert.rejects(fs.stat(path.join(target, "framedock.project.json")), { code: "ENOENT" });
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("已存在的 .framedock 数据原位保存，拒绝与 canvas 双清单冲突", async () => {
    const temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "framedock-layout-")));
    try {
        const user = path.join(temporary, "user"), target = path.join(temporary, "作品");
        await fs.mkdir(user);
        await fs.mkdir(path.join(target, ".framedock"), { recursive: true });
        const first = page("first"); first.nodes = [];
        const manifest = path.join(target, ".framedock", "framedock.project.json");
        await fs.writeFile(manifest, JSON.stringify({ format: "framedock-project", version: 1, folder, pages: [first], media: [] }));
        const directories = createProjectDirectories(user, createDesktopStorage(user));
        await assert.rejects(directories.saveAs(target, { folder, pages: [first] }), /打开项目目录/);
        await directories.open(target, { projects: [], projectFolders: [] });
        first.title = "原位更新";
        await directories.sync({ projects: [first], projectFolders: [folder] });
        assert.equal(JSON.parse(await fs.readFile(manifest)).pages[0].title, "原位更新");
        await fs.mkdir(path.join(target, "canvas"));
        await fs.copyFile(manifest, path.join(target, "canvas", "framedock.project.json"));
        await assert.rejects(directories.listFiles("first"));
        await assert.rejects(directories.open(target, { projects: [], projectFolders: [] }), /多种/);
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
