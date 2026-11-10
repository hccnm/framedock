import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { codexImageInput, codexImagePrompt, generateCodexImage, readCodexImageOutput } from "./codex-image.js";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4XcAAAAASUVORK5CYII=";
const input = { projectId: "p1", nodeId: "n1", requestId: "r1", prompt: "两个人在同一场景", references: [1, 2].map(i => ({ name: `角色${i}`, dataUrl: `data:image/png;base64,${png}` })) };
const launch = (mode = "") => async () => ({ executablePath: fileURLToPath(new URL("../server/fixtures/codex-image-cli.cjs", import.meta.url)), env: { ...process.env, CODEX_IMAGE_FIXTURE: mode } });

test("原生生图传递所有参考图，隔离线程，完成事件去重并正确归属", async () => {
    const result = await generateCodexImage(input, new AbortController().signal, launch());
    assert.equal(result.projectId, "p1"); assert.equal(result.nodeId, "n1"); assert.equal(result.requestId, "r1");
    assert.equal(result.threadId, "image-thread"); assert.equal(result.turnId, "image-turn");
    assert.equal(result.images.length, 1); assert.equal(result.images[0].itemId, "image-turn:image-1");
    assert.equal(result.images[0].dataUrl, `data:image/png;base64,${png}`);
});

test("多张生成逐 turn 执行，同名 item 按 turn 去重，透明背景有原生结果验证", async () => {
    const options = { size: "1536x1024", quality: "high" as const, background: "transparent" as const, count: 2 };
    const result = await generateCodexImage({ ...input, options }, new AbortController().signal, launch());
    assert.equal(result.images.length, 2);
    assert.notEqual(result.images[0].itemId, result.images[1].itemId);
    assert.ok(result.images.every((image) => image.transparentBackground));
    const prompt = codexImagePrompt({ ...input, options }, ["/ref1.png", "/ref2.png"], 1, 2);
    assert.match(prompt, /2\/2/); assert.match(prompt, /1536x1024/); assert.match(prompt, /high/);
    assert.match(prompt, /transparent_background 必须设为 true/); assert.match(prompt, /referenced_image_paths/);
    await assert.rejects(generateCodexImage({ ...input, options }, new AbortController().signal, launch("wrong-background")), /原生透明背景/);
    assert.equal(codexImageInput.safeParse({ ...input, options: { output_format: "webp" } }).success, false);
});

test("不支持生图或未生成图片时明确失败，不把文字当成成功", async () => {
    await assert.rejects(generateCodexImage(input, new AbortController().signal, launch("unsupported")), /不支持内置生图/);
    await assert.rejects(generateCodexImage(input, new AbortController().signal, launch("no-output")), /没有生图权限/);
});

test("取消会中止独立 app-server，不等待模型完成", async () => {
    const controller = new AbortController();
    const promise = generateCodexImage(input, controller.signal, launch("wait"));
    const timer = setTimeout(() => controller.abort(), 150);
    try { await assert.rejects(promise, /取消|abort/i); } finally { clearTimeout(timer); }
});

test("只接受本次输出，不误导入参考图；拒绝失败和不可下载 fileId", async () => {
    await assert.rejects(readCodexImageOutput({ inputImages: [{ savedPath: "/reference.png" }] }), /没有返回/);
    await assert.rejects(readCodexImageOutput({ fileId: "file-123" }), /远端文件/);
    await assert.rejects(readCodexImageOutput({ failure: { message: "额度不足" }, result: png }), /额度不足/);
    assert.equal(await readCodexImageOutput({ result: png }), `data:image/png;base64,${png}`);
    assert.equal(codexImageInput.safeParse({ ...input, references: [{ name: "x", dataUrl: "file:///secret" }] }).success, false);
});
