import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";

const source = await readFile(new URL("../src/proxy.ts", import.meta.url), "utf8");
const { forwardDesktopRequest } = await import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`);

test("代理将连接失败转换为可展示的 JSON 错误，并保留目标地址", async () => {
    const originalFetch = globalThis.fetch;
    try {
        for (const [code, reason] of [["ECONNREFUSED", "连接被拒绝"], ["ENOTFOUND", "无法解析服务器地址"], ["UND_ERR_CONNECT_TIMEOUT", "连接超时"], ["UNKNOWN", "请求失败"]]) {
            globalThis.fetch = async () => { throw new TypeError("fetch failed", { cause: { code } }); };
            const response = await forwardDesktopRequest(new Request(`app://framedock/proxy/${encodeURIComponent("http://127.0.0.1:8188/prompt")}`, { method: "POST", body: "{}" }));
            assert.equal(response.status, 502);
            assert.match(response.headers.get("content-type"), /application\/json/);
            const data = await response.json();
            assert.ok(data.error.message.includes(reason));
            assert.ok(data.error.message.includes("http://127.0.0.1:8188"));
        }
        globalThis.fetch = async () => Response.json({ prompt_id: "accepted" });
        const response = await forwardDesktopRequest(new Request(`app://framedock/proxy/${encodeURIComponent("http://127.0.0.1:8188/prompt")}`));
        assert.deepEqual(await response.json(), { prompt_id: "accepted" });
    } finally {
        globalThis.fetch = originalFetch;
    }
});
