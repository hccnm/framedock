import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const source = stripTypeScriptTypes(await readFile(new URL("../src/storage.ts", import.meta.url), "utf8"))
    .replace(/^import .*;\n/gm, "")
    .replace("export function registerDesktopStorage", "return function registerDesktopStorage");

function setup() {
    const handlers = new Map();
    const writes = [];
    let selection = { canceled: false, filePaths: ["/tmp/春日短片"] };
    let failure = false;
    let dialogs = 0;
    const register = new Function("BrowserWindow", "dialog", "ipcMain", "createProjectDirectories", "normalizeOrigin", "createDesktopStorage", source)(
        { fromWebContents: () => ({}) },
        { showOpenDialog: async () => { dialogs++; return selection; } },
        { handle: (name, handler) => handlers.set(name, handler) },
        () => ({ saveAs: async (directory, payload) => {
            if (failure) throw new Error("请选择空目录");
            writes.push({ directory, payload });
            return { id: payload.folder.id, directory };
        } }),
        (url) => new URL(url).origin,
        () => ({}),
    );
    register({ userDataPath: "/unused", rendererOrigin: "http://localhost:3030" });
    const frame = { url: "http://localhost:3030/projects" };
    const event = { senderFrame: frame, sender: { id: 1, mainFrame: frame } };
    return {
        invoke: (operation, ...args) => handlers.get(`framedock:projects:${operation}`)(event, ...args),
        writes,
        cancel: () => { selection = { canceled: true, filePaths: [] }; },
        fail: (value) => { failure = value; },
        dialogs: () => dialogs,
        event,
    };
}
const payload = { folder: { id: "project-1", name: "手动修改后的名称" }, pages: [] };

test("先选择目录，创建直接写入且保留用户名称", async () => {
    const host = setup();
    assert.equal(await host.invoke("selectDirectory"), "/tmp/春日短片");
    assert.equal(host.writes.length, 0);
    await host.invoke("create", payload, "/tmp/春日短片");
    assert.equal(host.dialogs(), 1);
    assert.deepEqual(host.writes, [{ directory: "/tmp/春日短片", payload }]);
    await assert.rejects(host.invoke("create", payload, "/tmp/春日短片"), /请先选择/);
});

test("取消选择不授权路径，拒绝其他目录与其他窗口", async () => {
    const host = setup();
    host.cancel();
    assert.equal(await host.invoke("selectDirectory"), null);
    await assert.rejects(host.invoke("create", payload, "/tmp/未授权"), /请先选择/);
    const selected = setup();
    await selected.invoke("selectDirectory");
    await assert.rejects(selected.invoke("create", payload, "/tmp/其他目录"), /请先选择/);
    selected.event.sender.id = 2;
    await assert.rejects(selected.invoke("create", payload, "/tmp/春日短片"), /请先选择/);
    assert.equal(selected.writes.length, 0);
});

test("保存失败保留目录供重试，非应用来源拒绝调用", async () => {
    const host = setup();
    await host.invoke("selectDirectory");
    host.fail(true);
    await assert.rejects(host.invoke("create", payload, "/tmp/春日短片"), /请选择空目录/);
    host.fail(false);
    await host.invoke("create", payload, "/tmp/春日短片");
    assert.equal(host.dialogs(), 1);
    host.event.senderFrame.url = "https://example.com";
    await assert.rejects(host.invoke("selectDirectory"), /禁止访问/);
});
