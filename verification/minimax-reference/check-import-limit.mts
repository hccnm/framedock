import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../web/package.json", import.meta.url));
const { unzipSync } = require("fflate");
const endpoint = "http://127.0.0.1:17379";
const headers = { "content-type": "application/json", "x-canvas-agent-token": "framedock-isolated-ui-test" };
const name = "multilingual-hand-drawn-story-video";
const entries = unzipSync(await fs.readFile(new URL(`../../web/public/skill-market/packages/${name}.zip`, import.meta.url)));
const files = Object.fromEntries(Object.entries(entries).map(([key, bytes]) => [key, Buffer.from(bytes as Uint8Array).toString("base64")]));
const body = JSON.stringify({ files, interface: { displayName: "多语言手绘故事视频制作", defaultPrompt: `$${name}` } });
assert.ok(Buffer.byteLength(body) > 30 * 1024 * 1024);
const imported = await fetch(`${endpoint}/agent/api/skills/import`, { method: "POST", headers, body });
const importedData = await imported.json();
assert.equal(imported.status, 201, JSON.stringify(importedData));
assert.equal(importedData.data.name, name);
const skillPath = importedData.data.path;
for (const [relative, bytes] of Object.entries(entries)) {
    if (relative === "agents/openai.yaml") continue;
    assert.deepEqual(await fs.readFile(new URL(relative, `file://${skillPath.replace(/SKILL.md$/, "")}`)), Buffer.from(bytes as Uint8Array));
}
async function oversized(route: string, megabytes: number) {
    const req = http.request(`${endpoint}${route}`, { method: "POST", headers: { ...headers, "content-length": megabytes * 1024 * 1024 } });
    const result = new Promise<{ status: number; body: string }>((resolve, reject) => {
        req.on("response", (res) => { let body = ""; res.on("data", (chunk) => body += chunk); res.on("end", () => resolve({ status: res.statusCode!, body })); });
        req.on("error", reject);
    });
    const chunk = Buffer.alloc(1024 * 1024, " ");
    for (let i = 0; i < megabytes; i++) if (!req.write(chunk)) await once(req, "drain");
    req.end();
    return result;
}
const before = await (await fetch(`${endpoint}/agent/api/skills`, { headers })).text();
const rejected = await oversized("/agent/api/skills/import", 257);
assert.equal(rejected.status, 413);
assert.match(rejected.body, /256 MB/);
const after = await (await fetch(`${endpoint}/agent/api/skills`, { headers })).text();
assert.equal(after, before, "超限请求不得留下技能或更改目录");
const ordinary = await oversized("/agent/api/skills", 31);
assert.match(ordinary.body, /request entity too large/);
assert.ok(ordinary.status >= 400);
const unauthorized = await fetch(`${endpoint}/agent/api/skills/import`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
assert.equal(unauthorized.status, 401);
const report = { largePackage: name, requestBytes: Buffer.byteLength(body), resourceFiles: Object.keys(entries).length, imported: imported.status, oversized: rejected.status, unchangedAfterRejection: true, ordinary31MBRejected: true, unauthorized: unauthorized.status };
await fs.writeFile(new URL("import-limit-validation.json", import.meta.url), JSON.stringify(report, null, 2));
console.log(report);
