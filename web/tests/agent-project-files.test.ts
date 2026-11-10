import "./browser-globals";
import { afterAll, afterEach, expect, test } from "bun:test";
import { assertCanvasToolTarget, isSiteTool, runSiteTool } from "../src/lib/agent/agent-site-tools";
import { isCanvasWriteTool, toolName } from "../src/components/agent/agent-event-formatters";
import type { CanvasDesktopBridge } from "../src/types/desktop-host";

const originalWindow = globalThis.window;
Object.assign(globalThis, { window: {} });
afterAll(() => { if (originalWindow) globalThis.window = originalWindow; else Reflect.deleteProperty(globalThis, "window"); });
afterEach(() => { delete window.canvasDesktop; });

test("项目文件工具使用本轮页面而非当前页面，保留相对路径并返回最新正文", async () => {
    const calls: unknown[] = [];
    let text = "第一版剧情";
    window.canvasDesktop = { projects: {
        listFiles: async (pageId: string, path: string, scope?: string) => { calls.push([pageId, path, scope]); return { directory: path, entries: [{ name: "第一集.md", path: "剧情/第一集.md", kind: "file" }] }; },
        readFile: async (pageId: string, path: string, scope?: string) => { calls.push([pageId, path, scope]); return { path, content: text, modifiedAt: "now" }; },
    } } as CanvasDesktopBridge;
    const context = { canvasSnapshot: { projectId: "current-page", nodes: [], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } } };
    const navigate = () => { throw new Error("文件读取不应跳转页面"); };
    expect(isSiteTool("project_list_files")).toBe(true);
    expect(isCanvasWriteTool("project_read_file")).toBe(false);
    expect(toolName("project_read_file")).toBe("读取项目文件");
    expect(await runSiteTool("project_list_files", { projectId: "turn-page", projectFileScope: "scope-a", path: "剧情" }, navigate, context)).toMatchObject({ entries: [{ path: "剧情/第一集.md" }] });
    expect(await runSiteTool("project_read_file", { projectId: "turn-page", projectFileScope: "scope-a", path: "剧情/第一集.md" }, navigate, context)).toMatchObject({ content: "第一版剧情" });
    text = "其他 Agent 更新后的剧情";
    expect(await runSiteTool("project_read_file", { projectId: "turn-page", projectFileScope: "scope-a", path: "剧情/第一集.md" }, navigate, context)).toMatchObject({ content: text });
    expect(calls).toEqual([["turn-page", "剧情", "scope-a"], ["turn-page", "剧情/第一集.md", "scope-a"], ["turn-page", "剧情/第一集.md", "scope-a"]]);
    await expect(runSiteTool("project_list_files", { projectId: "turn-page" }, navigate, context)).rejects.toThrow("未绑定项目目录");
    expect(() => assertCanvasToolTarget("canvas_apply_ops", "turn-page", context.canvasSnapshot)).toThrow("创作页已切换");
    expect(() => assertCanvasToolTarget("comfyui_run_workflow", "turn-page", context.canvasSnapshot)).toThrow("创作页已切换");
    expect(() => assertCanvasToolTarget("canvas_apply_ops", "current-page", context.canvasSnapshot)).not.toThrow();
    await expect(runSiteTool("project_list_files", {}, navigate, context)).rejects.toThrow("没有关联项目");
});

test("浏览器模式明确提示桌面文件读取不可用", async () => {
    delete window.canvasDesktop;
    await expect(runSiteTool("project_list_files", { projectId: "page" }, () => {})).rejects.toThrow("需要桌面应用");
});
