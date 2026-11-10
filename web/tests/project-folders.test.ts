import "./browser-globals";
import { beforeEach, describe, expect, test } from "bun:test";
import { normalizeProjectName, useCanvasStore } from "../src/stores/canvas/use-canvas-store";

beforeEach(() => {
    useCanvasStore.setState({ projects: [], projectFolders: [], deletedProjects: [] });
});

describe("项目与创作页归类", () => {
    test("同一项目包含多个稳定 ID 的创作页，移动后内容保留", () => {
        const store = useCanvasStore.getState();
        const first = store.createProjectFolder("项目 A");
        const second = store.createProjectFolder("项目 B");
        const page = store.createProject("分镜", first);
        const other = store.createProject("配乐", first);
        const original = useCanvasStore.getState().openProject(page)!;
        store.assignProjectFolder(page, second);
        expect(useCanvasStore.getState().openProject(page)).toEqual({ ...original, projectFolderId: second, updatedAt: expect.any(String) });
        expect(useCanvasStore.getState().openProject(other)?.projectFolderId).toBe(first);
        store.assignProjectFolder(page, null);
        expect(useCanvasStore.getState().openProject(page)?.projectFolderId).toBeNull();
    });

    test("解散项目原子解除归类，保留创作 ID、内容及删除记录", () => {
        const store = useCanvasStore.getState();
        const folder = store.createProjectFolder("短片");
        const id = store.createProject("画布", folder);
        store.updateProject(id, { viewport: { x: 20, y: 30, k: 2 }, showImageInfo: true });
        const original = useCanvasStore.getState().openProject(id)!;
        store.dissolveProjectFolder(folder);
        expect(useCanvasStore.getState().projectFolders).toHaveLength(0);
        expect(useCanvasStore.getState().openProject(id)).toEqual({ ...original, projectFolderId: null });
        expect(useCanvasStore.getState().deletedProjects).toHaveLength(0);
    });

    test("重命名保持归类；导入使用新 ID 且不继承外部项目", () => {
        const store = useCanvasStore.getState();
        const folder = store.createProjectFolder("A");
        const id = store.createProject("画布", folder);
        store.renameProject(id, "  新名称  ");
        store.renameProjectFolder(folder, "新项目");
        const page = useCanvasStore.getState().openProject(id)!;
        expect(page.title).toBe("新名称");
        expect(page.projectFolderId).toBe(folder);
        expect(useCanvasStore.getState().projectFolders[0].name).toBe("新项目");
        const imported = store.importProject(page);
        expect(imported).not.toBe(id);
        expect(useCanvasStore.getState().openProject(imported)?.projectFolderId).toBeNull();
    });

    test("拒绝空名和无效项目；Unicode 名称按码点截取", () => {
        expect(() => normalizeProjectName("  ")).toThrow();
        expect(Array.from(normalizeProjectName("😀".repeat(60)))).toHaveLength(50);
        expect(() => useCanvasStore.getState().createProject("画布", "missing")).toThrow("项目不存在");
        expect(useCanvasStore.getState().projects).toHaveLength(0);
    });
});
