import { expect, test } from "bun:test";
import { resolveToolCardStatus } from "../src/components/agent/agent-tool-status";

test("structured execution status wins over task counters and output wording", () => {
    const summary = "共 1 个任务，空闲 1，排队 0，运行中 0，成功 0，失败 0";
    expect(resolveToolCardStatus("completed", summary)).toBe("completed");
    expect(resolveToolCardStatus("completed", "失败 1")).toBe("completed");
    expect(resolveToolCardStatus("inProgress", "上次错误")).toBe("running");
    expect(resolveToolCardStatus("failed", "已完成")).toBe("failed");
    expect(resolveToolCardStatus("completed", summary, "连接失败")).toBe("failed");
    expect(resolveToolCardStatus("cancelled", "已完成")).toBe("canceled");
    expect(resolveToolCardStatus("", "执行失败")).toBe("failed");
});
