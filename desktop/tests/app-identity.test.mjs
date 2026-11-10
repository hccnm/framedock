import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");

test("FrameDock 品牌使用独立数据目录", () => {
    assert.equal(source.match(/app\.setName\("([^"]+)"\)/)?.[1], "FrameDock");
    assert.match(source, /app\.setPath\("userData", path\.join\(app\.getPath\("appData"\), "FrameDock Desktop"\)\)/);
    assert.match(source, /title: "FrameDock"/);
});
