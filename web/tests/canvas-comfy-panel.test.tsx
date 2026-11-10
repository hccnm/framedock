import "./browser-globals";
import { afterEach, expect, test } from "bun:test";
import { App } from "antd";
import { MemoryRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasComfyPanel } from "../src/components/canvas/canvas-comfy-panel";
import { useComfyUiStore } from "../src/stores/use-comfyui-store";
import { CanvasNodeType } from "../src/types/canvas";
import type { ComfyMode } from "../src/types/comfyui";

const original = useComfyUiStore.getState();
afterEach(() => useComfyUiStore.setState(original));

test("草稿阻断原因显示在画布面板并禁用运行按钮", () => {
    useComfyUiStore.setState({
        baseUrl: "http://comfy.test",
        workflows: [{ id: "draft", name: "H3 草稿", description: "", workflow: {}, fields: [], createdAt: "", updatedAt: "", executionBlockedReason: "项目尾帧校验尚未接入" }],
    });
    const node = { id: "draft-node", type: CanvasNodeType.ComfyUI, position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { comfyMode: "custom" as const, comfyWorkflowId: "draft" } };
    const html = renderToStaticMarkup(<App><MemoryRouter><CanvasComfyPanel node={node} projectId="draft-test" onClose={() => {}} /></MemoryRouter></App>);
    expect(html).toContain("项目尾帧校验尚未接入");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*?运行/);
});

test("画布预设模式也允许选择已配置的图片和视频工作流，运行中锁定选择", () => {
    useComfyUiStore.setState({
        presetWorkflowIds: { text: "image", enhance: "image", edit: "image" },
        workflows: [
            { id: "image", name: "图片工作流", outputKinds: ["image"], description: "", workflow: {}, fields: [], createdAt: "", updatedAt: "" },
            { id: "video", name: "视频工作流", outputKinds: ["video"], description: "", workflow: {}, fields: [], createdAt: "", updatedAt: "" },
        ],
    });
    for (const mode of ["text", "enhance", "edit", "custom"] as ComfyMode[]) {
        const node = { id: "comfy-selection", type: CanvasNodeType.ComfyUI, position: { x: 0, y: 0 }, width: 340, height: 240, metadata: { comfyMode: mode } };
        const idle = renderToStaticMarkup(<App><MemoryRouter><CanvasComfyPanel node={node} projectId="selection-test" onClose={() => {}} /></MemoryRouter></App>);
        expect(idle).toContain('aria-label="工作流"');
        expect(idle).not.toContain("ant-select-disabled");
        const running = renderToStaticMarkup(<App><MemoryRouter><CanvasComfyPanel node={{ ...node, metadata: { ...node.metadata, comfyRunStatus: "running" } }} projectId="selection-test" onClose={() => {}} /></MemoryRouter></App>);
        expect(running).toContain("ant-select-disabled");
    }
});
