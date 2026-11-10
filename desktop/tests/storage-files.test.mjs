import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { stripTypeScriptTypes } from "node:module";
const source = await fs.readFile(new URL("../src/storage-files.ts", import.meta.url), "utf8");
const { createDesktopStorage } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);

test("配置以普通 JSON 往返，保留旧密文且拒绝无效写入", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "framedock-config-"));
    try {
        const root = path.join(directory, "storage");
        await fs.mkdir(root);
        const legacyFile = path.join(root, "config.encrypted");
        const legacy = Buffer.from([0, 1, 2, 3]);
        await fs.writeFile(legacyFile, legacy);
        const storage = createDesktopStorage(directory);
        assert.equal(await storage.getConfig(), null);
        const value = JSON.stringify({ state: { config: { apiKey: "fixture-key", channels: [] }, webdav: { password: "fixture-password" } }, version: 0 });
        await storage.setConfig(value);
        const file = path.join(root, "config.json");
        assert.equal(await fs.readFile(file, "utf8"), value);
        assert.equal(await createDesktopStorage(directory).getConfig(), value);
        if (process.platform !== "win32") assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
        await assert.rejects(storage.setConfig("broken json"));
        assert.equal(await storage.getConfig(), value);
        await storage.removeConfig();
        assert.equal(await storage.getConfig(), null);
        assert.deepEqual(await fs.readFile(legacyFile), legacy);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test("限定键与媒体文件往返", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "framedock-storage-"));
    try {
        const storage = createDesktopStorage(directory);
        assert.equal(await storage.getState("framedock:canvas_store"), null);
        await assert.rejects(storage.setState("../escape", "{}"));
        await assert.rejects(storage.setState("framedock:ai_config_store", '{"apiKey":"secret"}'));
        await assert.rejects(storage.setState("framedock:canvas_store", "broken json"));
        await Promise.all([storage.setState("framedock:canvas_store", '{"v":1}'), storage.setState("framedock:canvas_store", '{"v":2}')]);
        assert.equal(await storage.getState("framedock:canvas_store"), '{"v":2}');
        await storage.setMedia("images", "image:example_1", { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/png" });
        assert.deepEqual(await fs.readFile(path.join(directory, "storage", "images", "image_example_1.bin")), Buffer.from([1, 2, 3]));
        assert.deepEqual(await storage.mediaKeys("images"), ["image:example_1"]);
        assert.equal((await storage.getMedia("images", "image:example_1"))?.mimeType, "image/png");
        await assert.rejects(storage.getMedia("images", "image:../../escape"));
        await assert.rejects(storage.getMedia("images", "video:wrong"));
        await storage.removeMedia("images", "image:example_1");
        assert.equal(await storage.getMedia("images", "image:example_1"), null);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
