import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

/** desktop 包根目录（编译产物所在 dist 的上一级）。 */
export const desktopRoot = path.dirname(__dirname);

/** 安装包从 Contents/Resources 读取资源，源码运行沿用仓库布局。 */
function resourceRoot() {
    return app.isPackaged ? process.resourcesPath : path.join(desktopRoot, "..");
}

/** 开发模式可用 FRAMEDOCK_WEB_DIST 覆盖。 */
export function resolveWebDist() {
    return path.resolve((!app.isPackaged && process.env.FRAMEDOCK_WEB_DIST) || path.join(resourceRoot(), "web", "dist"));
}

/** 开发模式可用 FRAMEDOCK_AGENT_ENTRY 覆盖。 */
export function resolveAgentEntry() {
    return path.resolve((!app.isPackaged && process.env.FRAMEDOCK_AGENT_ENTRY) || path.join(resourceRoot(), "canvas-agent", "dist", "index.js"));
}

export function resolveAppIcon() {
    return path.join(resourceRoot(), app.isPackaged ? "framedock-icon.png" : "web/public/framedock-icon.png");
}

/** Canvas Agent 与桌面壳共享的用户配置文件。 */
export function agentConfigFile() {
    return path.join(os.homedir(), ".framedock", "canvas-agent.json");
}

/** 读取 Canvas Agent 配置；文件缺失或损坏时返回空对象。 */
export function readAgentConfig() {
    try {
        const parsed = JSON.parse(fs.readFileSync(agentConfigFile(), "utf8")) as Record<string, unknown>;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}
