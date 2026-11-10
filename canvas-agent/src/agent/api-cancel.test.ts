import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV3, simulateReadableStream } from "ai/test";
import { ApiAgent } from "./api.js";
import { CanvasSession } from "../canvas/session.js";

test("interrupt cancels an outstanding canvas operation and keeps a settled partial history", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "framedock-cancel-"));
    try {
        const api = new ApiAgent(dir);
        const thread = await api.create();
        const session = new CanvasSession(thread.id);
        let entered!: () => void;
        const started = new Promise<void>((resolve) => { entered = resolve; });
        let rejectTool!: (error: Error) => void;
        session.callTool = async () => { entered(); return new Promise((_resolve, reject) => { rejectTool = reject; }); };
        session.cancelClientTools = () => rejectTool(new Error("任务已停止"));
        const model = new MockLanguageModelV3({ doStream: {
            stream: simulateReadableStream({ chunks: [
                { type: "tool-call", toolCallId: "pending", toolName: "canvas_get_state", input: "{}" },
                { type: "finish", finishReason: { unified: "tool-calls", raw: "tool_calls" }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } },
            ] }),
        } });
        const run = api.run(thread, { protocol: "openai", baseUrl: "https://example.com/v1", model: "test", apiKey: "test-secret" }, "读取", "读取", "u", {}, [], session, () => undefined, "client", model);
        await started;
        assert.equal(api.interrupt(thread.id), true);
        await run;
        assert.equal(api.interrupt(thread.id), false);
        const saved = await api.read(thread.id);
        assert.equal(saved.chat.at(-1)?.text, "任务已停止");
        assert.equal(saved.settledTurnIds.length, 1);
        assert.equal(session.codexBusy, false);
    } finally { await rm(dir, { recursive: true, force: true }); }
});
