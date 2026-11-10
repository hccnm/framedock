import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { EventEmitter } from "node:events";
import { test } from "node:test";

const source = stripTypeScriptTypes(await readFile(new URL("../src/notifications.ts", import.meta.url), "utf8"))
    .replace(/^import .*;\n/gm, "").replace("export function createGenerationNotifications", "return function createGenerationNotifications");
function setup() {
    const created = [], events = [];
    class Notification extends EventEmitter {
        static supported = true;
        static isSupported() { return this.supported; }
        constructor(options) { super(); this.options = options; created.push(this); }
        show() { events.push("notify"); }
    }
    const window = {
        isDestroyed: () => false, isMinimized: () => true,
        restore: () => events.push("restore"), show: () => events.push("show"), focus: () => events.push("focus"),
        webContents: { send: (...args) => events.push(args) },
    };
    const notify = new Function("Notification", source)(Notification)(() => window);
    return { notify, created, events, Notification, window };
}
const payload = { id: "image:log-1:success", title: "图像生成完成", body: "点击查看结果", target: { kind: "image", logId: "log-1" } };

test("成功和失败通知保留目标，点击恢复窗口并发送定位事件", () => {
    const host = setup();
    assert.equal(host.notify(payload), true);
    assert.deepEqual(host.created[0].options, { title: payload.title, body: payload.body });
    host.created[0].emit("click");
    assert.deepEqual(host.events, ["notify", "restore", "show", "focus", ["framedock:generation-notification-click", payload.target]]);
    assert.equal(host.notify(payload), false);
    const failed = { ...payload, id: "canvas:run-1:error", title: "生成失败", target: { kind: "canvas", projectId: "page-1", nodeId: "node-1" } };
    assert.equal(host.notify(failed), true);
    host.created[1].emit("click");
    assert.deepEqual(host.events.at(-1), ["framedock:generation-notification-click", failed.target]);
});

test("拒绝无效目标，系统不支持时不发送", () => {
    const host = setup();
    for (const target of [{ kind: "image" }, { kind: "canvas", projectId: "page-1" }, { kind: "url", url: "https://example.com" }]) {
        assert.throws(() => host.notify({ ...payload, target }), /无效/);
    }
    host.Notification.supported = false;
    assert.equal(host.notify(payload), false);
    assert.equal(host.created.length, 0);
});

test("通知发送失败允许重试，已销毁窗口不跳转", () => {
    const host = setup();
    host.notify(payload);
    host.created[0].emit("failed", {}, "test failure");
    assert.equal(host.notify(payload), true);
    host.window.isDestroyed = () => true;
    host.created[1].emit("click");
    assert.deepEqual(host.events, ["notify", "notify"]);
});
