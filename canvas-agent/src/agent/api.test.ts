import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { ApiAgent, apiProviderSchema, generateApiSkillDraft } from "./api.js";
import { CanvasSession } from "../canvas/session.js";

const provider = { protocol: "openai" as const, model: "test", baseUrl: "https://example.com/v1", apiKey: "never-persist-this-key" };
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

test("SDK tool loop executes canvas tools, persists replay without credentials or duplicate steps", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "framedock-api-"));
    try {
        const api = new ApiAgent(dir);
        const thread = await api.create();
        let calls = 0;
        const session = new CanvasSession(thread.id);
        session.callTool = async (name) => { assert.equal(name, "canvas_get_state"); calls++; return { nodes: [{ id: "actual-node" }] }; };
        const model = new MockLanguageModelV3({ doStream: [
            { stream: simulateReadableStream({ chunks: [{ type: "tool-call", toolCallId: "tool1", toolName: "canvas_get_state", input: "{}" }, { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage }] }) },
            { stream: simulateReadableStream({ chunks: [{ type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: "画布已读取" }, { type: "text-end", id: "text" }, { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage }] }) },
        ] });
        const events: Array<{ type: string; payload: unknown }> = [];
        await api.run(thread, provider, "读取画布", "读取画布", "user1", {}, [], session, (type, payload) => events.push({ type, payload }), "test-client", model, { name: "canvas-check", description: "检查画布", instructions: "技能专属指令：先读取节点再汇报", path: "/workspace/.agents/skills/canvas-check/SKILL.md", revision: "test", managed: true, enabled: true });
        assert.ok(model.doStreamCalls.every((call) => JSON.stringify(call.prompt).includes("技能专属指令：先读取节点再汇报")));
        const saved = await api.read(thread.id);
        assert.equal(calls, 1);
        assert.equal(model.doStreamCalls.length, 2);
        assert.equal(saved.messages.length, 4);
        assert.equal(saved.chat.at(-1)?.text, "画布已读取");
        assert.equal(saved.settledTurnIds.length, 1);
        assert.ok(saved.chat.every((item) => item.threadId === thread.id && item.turnId && item.itemId));
        assert.ok(events.some((event) => event.type === "agent_event"));
        assert.equal((await readFile(path.join(dir, `${thread.id}.json`), "utf8")).includes(provider.apiKey), false);
        await writeFile(path.join(dir, `${thread.id}.json`), '{"version":99}');
        await assert.rejects(api.read(thread.id), /拒绝覆盖/);
        await assert.rejects(api.read("../outside"), /无效/);
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test("API 工具循环按需读取项目剧情并将正文交回模型", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "framedock-project-api-"));
    try {
        const api = new ApiAgent(dir);
        const thread = await api.create();
        const session = new CanvasSession(thread.id);
        session.callTool = async (name, input) => {
            assert.equal(name, "project_read_file");
            assert.deepEqual(input, { path: "剧情/第一集.md" });
            return { path: "剧情/第一集.md", content: "最新剧情：角色在港口会合", modifiedAt: "now" };
        };
        const model = new MockLanguageModelV3({ doStream: [
            { stream: simulateReadableStream({ chunks: [{ type: "tool-call", toolCallId: "read-story", toolName: "project_read_file", input: JSON.stringify({ path: "剧情/第一集.md" }) }, { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage }] }) },
            { stream: simulateReadableStream({ chunks: [{ type: "text-start", id: "text" }, { type: "text-delta", id: "text", delta: "已读取最新剧情" }, { type: "text-end", id: "text" }, { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage }] }) },
        ] });
        await api.run(thread, provider, "读取最新剧情", "读取最新剧情", "story-request", {}, [], session, () => {}, "test-client", model);
        assert.equal(model.doStreamCalls.length, 2);
        assert.ok(JSON.stringify(model.doStreamCalls[1].prompt).includes("最新剧情：角色在港口会合"));
        assert.equal((await api.read(thread.id)).chat.at(-1)?.text, "已读取最新剧情");
    } finally { await rm(dir, { recursive: true, force: true }); }
});

test("API 模型生成技能草稿并拒绝泄露渠道凭据", async () => {
    const draft = { name: "canvas-check", displayName: "画布检查", description: "检查画布", instructions: "先读取节点，再汇报结果", shortDescription: "", defaultPrompt: "$canvas-check 检查画布" };
    const modelFor = (value: unknown) => new MockLanguageModelV3({ doGenerate: async () => ({ content: [{ type: "text", text: JSON.stringify(value) }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] }) });
    assert.equal((await generateApiSkillDraft(provider, [{ role: "user", text: "检查节点" }], modelFor(draft))).name, "canvas-check");
    await assert.rejects(generateApiSkillDraft(provider, {}, modelFor({ ...draft, instructions: provider.apiKey })), /生成失败/);
});

test("provider rejects credential-bearing URLs and newline secrets", () => {
    assert.equal(apiProviderSchema.safeParse(provider).success, true);
    assert.equal(apiProviderSchema.safeParse({ ...provider, baseUrl: "https://user:secret@example.com/v1" }).success, false);
    assert.equal(apiProviderSchema.safeParse({ ...provider, apiKey: "secret\nheader" }).success, false);
});
