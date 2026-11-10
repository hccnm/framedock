#!/usr/bin/env node
// 隔离验收用 CLI：只模拟本项目使用的 app-server 协议，不访问模型或用户配置。
if (process.argv.includes("--version")) { console.log("codex-cli 0.1.0"); process.exit(); }
if (process.argv.includes("login")) { console.log("Logged in"); process.exit(); }
let thread = { id: "fixture-codex-thread", cwd: "", createdAt: 1, updatedAt: 1, preview: "CLI 验收对话", turns: [] };
let turnId = "";
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
require("node:readline").createInterface({ input: process.stdin }).on("line", (line) => {
    const { id, method, params = {} } = JSON.parse(line);
    if (id === undefined) return;
    let result = {};
    if (method === "thread/start" || method === "thread/resume") { thread.cwd = params.cwd || thread.cwd; result = { thread }; }
    if (method === "thread/read") result = { thread };
    if (method === "thread/list") result = { data: [thread], nextCursor: null };
    if (method === "mcpServerStatus/list") result = { data: [{ name: "infinite-canvas", authStatus: "unsupported" }], nextCursor: null };
    if (method === "model/list") result = { data: [{ id: "fixture", model: "fixture-codex", displayName: "隔离 Codex 模型", defaultReasoningEffort: "medium", supportedReasoningEfforts: [], isDefault: true }] };
    if (method === "skills/list") result = { data: [{ cwd: thread.cwd, skills: [], errors: [] }] };
    if (method === "turn/start") { turnId = "fixture-turn"; result = { turn: { id: turnId, status: "inProgress", items: [] } }; }
    send({ id, result });
    if (method === "turn/interrupt") send({ method: "turn/completed", params: { threadId: thread.id, turn: { id: turnId, status: "interrupted", items: [] } } });
});
