import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "framedock-create-ui-"));
os.homedir = () => directory;
process.env.PORT = "17381";
const executablePath = path.join(directory, "codex");
await fs.copyFile(new URL("../../canvas-agent/src/server/fixtures/codex-cli.cjs", import.meta.url), executablePath);
await fs.chmod(executablePath, 0o700);
await fs.mkdir(path.join(directory, ".framedock"));
await fs.writeFile(path.join(directory, ".framedock", "canvas-agent.json"), JSON.stringify({ url: "http://127.0.0.1:17381", token: "creation-isolated-test", origins: ["http://127.0.0.1:3011"], runtime: { selectedId: "codex", executablePath } }));
const requests: unknown[] = [];
http.createServer(async (req, res) => {
    if (req.url === "/receipt") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ count: requests.length })); return; }
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const chunk = { id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-text", choices: [{ index: 0, delta: { role: "assistant", content: "隔离验收完成：已收到创作需求。" }, finish_reason: null }] };
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
    res.write(`data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } })}\n\n`);
    res.end("data: [DONE]\n\n");
}).listen(17382, "127.0.0.1");
const { startHttpServer } = await import("../../canvas-agent/src/server/http.ts");
startHttpServer();
