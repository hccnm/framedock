import path from "node:path";

import { saveConfig, type AgentRuntimeConfig, type CanvasAgentConfig } from "../config.js";
import { CODEX_COMMAND, codexLoginStatus, probeCodexRuntime } from "./codex.js";
import type { LocalCliId, LocalCliRuntime } from "./types.js";

/** 首期只注册 Codex；Claude Code 后续按同一运行时契约接入。 */
const RUNTIME_DEFS: Array<{ id: LocalCliId; name: string }> = [{ id: "codex", name: "Codex CLI" }];

export class CliRuntimeError extends Error {
    override name = "CliRuntimeError";
    constructor(readonly statusCode: 400 | 409, message: string) {
        super(message);
    }
}

let configRef: CanvasAgentConfig | null = null;
let scanCache: LocalCliRuntime[] | null = null;

/** 绑定 HTTP 服务持有的配置实例，保证运行时选择写回同一份配置。 */
export function bindRuntimeConfig(config: CanvasAgentConfig) {
    configRef = config;
}

/** 显式 CLI 路径的唯一校验入口：必须为绝对路径（Node path 语义），并规范化后再探测与保存。 */
export function normalizeExplicitCliPath(executablePath?: string) {
    const trimmed = executablePath?.trim();
    if (!trimmed) return undefined;
    if (!path.isAbsolute(trimmed)) throw new CliRuntimeError(400, `CLI 路径必须是绝对路径：${trimmed}`);
    return path.resolve(trimmed);
}

/** 查询本机 CLI 运行时；默认使用缓存，rescan 时强制重新探测。 */
export async function listLocalRuntimes(rescan = false): Promise<LocalCliRuntime[]> {
    if (!scanCache || rescan) scanCache = await Promise.all(RUNTIME_DEFS.map((def) => scanRuntime(def)));
    return withSelection(scanCache);
}

/** 选择运行时；显式路径必须为绝对路径且重新探测通过，留空则恢复自动发现。不接受任意命令或 argv。 */
export async function selectLocalRuntime(id: string, executablePath?: string): Promise<LocalCliRuntime> {
    const def = requireDef(id);
    const config = requireConfig();
    const normalizedPath = normalizeExplicitCliPath(executablePath);
    if (normalizedPath) {
        const detection = await probeCodexRuntime(normalizedPath);
        if (!detection.available || detection.executablePath !== normalizedPath) throw new CliRuntimeError(400, `指定的 CLI 路径不可用：${normalizedPath}`);
    }
    const runtime: AgentRuntimeConfig = { selectedId: def.id, ...(normalizedPath ? { executablePath: normalizedPath } : {}), ...(config.runtime?.env ? { env: config.runtime.env } : {}) };
    config.runtime = runtime;
    saveConfig(config);
    scanCache = [await scanRuntime(def)];
    return withSelection(scanCache)[0];
}

/** 测试运行时：重新探测路径、版本与登录状态，不改变当前选择。 */
export async function testLocalRuntime(id: string, executablePath?: string): Promise<LocalCliRuntime> {
    const def = requireDef(id);
    let probePath: string | undefined;
    try {
        probePath = normalizeExplicitCliPath(executablePath) ?? effectiveExplicitPath(def.id);
    } catch (error) {
        // 显式相对路径等校验失败不进入探测，直接作为测试失败诊断返回。
        return {
            id: def.id,
            name: def.name,
            available: false,
            selected: (requireConfig().runtime?.selectedId || def.id) === def.id,
            executablePath: executablePath?.trim() || undefined,
            diagnostics: [{ code: "invalid-explicit-path", message: error instanceof Error ? error.message : String(error) }],
        };
    }
    const detection = await probeCodexRuntime(probePath);
    return {
        id: def.id,
        name: def.name,
        available: detection.available,
        selected: (requireConfig().runtime?.selectedId || def.id) === def.id,
        executablePath: detection.executablePath,
        version: detection.version,
        authStatus: detection.available && detection.executablePath ? await codexLoginStatus(detection.executablePath) : "unknown",
        diagnostics: detection.skipped,
    };
}

/** 解析当前对话应使用的本机 CLI 启动参数；显式路径失效时给出明确诊断，不悄悄换用其他 CLI。 */
export async function resolveCodexLaunch(): Promise<{ executablePath: string; env: NodeJS.ProcessEnv }> {
    const config = requireConfig();
    const explicit = normalizeExplicitCliPath(config.runtime?.executablePath);
    const detection = await probeCodexRuntime(explicit);
    if (detection.available && detection.executablePath) return { executablePath: detection.executablePath, env: { ...process.env, ...(config.runtime?.env || {}) } };
    throw new Error(explicit ? `指定的 Codex CLI 路径不可用：${explicit}，请在设置中更新或清空该路径` : `没有找到可用的本机 ${CODEX_COMMAND} CLI，请安装后重试或在设置中手动指定路径`);
}

async function scanRuntime(def: { id: LocalCliId; name: string }): Promise<LocalCliRuntime> {
    const explicit = effectiveExplicitPath(def.id);
    const detection = await probeCodexRuntime(explicit);
    return {
        id: def.id,
        name: def.name,
        available: detection.available,
        selected: false,
        executablePath: detection.executablePath,
        version: detection.version,
        authStatus: detection.available && detection.executablePath ? await codexLoginStatus(detection.executablePath) : "unknown",
        diagnostics: explicit && !detection.available ? [{ code: "explicit-path-unavailable", message: `指定的路径不可用：${explicit}` }, ...detection.skipped] : detection.skipped,
    };
}

/** 当前选择对应的显式路径；仅在已选中该运行时且配置了路径时生效。 */
function effectiveExplicitPath(id: LocalCliId) {
    const config = requireConfig();
    return (config.runtime?.selectedId || id) === id ? config.runtime?.executablePath || undefined : undefined;
}

function withSelection(runtimes: LocalCliRuntime[]): LocalCliRuntime[] {
    const selectedId = requireConfig().runtime?.selectedId || RUNTIME_DEFS[0].id;
    return runtimes.map((item) => ({ ...item, selected: item.id === selectedId }));
}

function requireConfig(): CanvasAgentConfig {
    if (!configRef) throw new CliRuntimeError(409, "运行时配置尚未初始化");
    return configRef;
}

function requireDef(id: string): { id: LocalCliId; name: string } {
    const def = RUNTIME_DEFS.find((item) => item.id === id);
    if (!def) throw new CliRuntimeError(400, "未知的本机 CLI 类型");
    return def;
}
