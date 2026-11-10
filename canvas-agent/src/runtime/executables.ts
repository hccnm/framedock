import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { toolchainBinDirectories } from "./toolchain-paths.js";

/** 每轮探测的候选数量上限，避免大量坏 shim 拖慢重扫。 */
export const MAX_PROBE_CANDIDATES = 8;
/** CLI 探测命令的超时时间。 */
export const PROBE_TIMEOUT_MS = 5000;

/** 从命令输出中提取语义化版本号。 */
export function parseCliVersion(output: string) {
    return output.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0] || "";
}

/** 展开 Windows 可执行扩展名；POSIX 保持原始名称。 */
export function commandFileNames(command: string, platform = process.platform, pathExt = process.env.PATHEXT || "") {
    if (platform !== "win32") return [command];
    const extensions = [...new Set([".exe", ".cmd", ".bat", ...pathExt.split(";").filter(Boolean).map((item) => item.toLowerCase())])];
    return [command, ...extensions.map((ext) => `${command}${ext}`)];
}

/** 去重并限制候选数量；Windows 路径不区分大小写。 */
export function dedupeCandidates(paths: string[], cap = MAX_PROBE_CANDIDATES) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of paths) {
        const key = process.platform === "win32" ? item.toLowerCase() : item;
        if (!item || seen.has(key)) continue;
        seen.add(key);
        result.push(item);
        if (result.length >= cap) break;
    }
    return result;
}

/** 校验候选路径必须是普通文件且具备执行权限；Windows 只校验普通文件。 */
export async function isExecutableFile(filePath: string) {
    try {
        const stat = await fs.stat(filePath);
        return stat.isFile() && (process.platform === "win32" || Boolean(stat.mode & 0o111));
    } catch {
        return false;
    }
}

/** 按探测顺序收集候选绝对路径：显式路径 → PATH 全部匹配 → 常见工具链目录 → macOS Codex.app。 */
export async function collectCliCandidates(command: string, options: { explicitPath?: string; env?: NodeJS.ProcessEnv; home?: string } = {}) {
    const env = options.env || process.env;
    const home = options.home || os.homedir();
    const names = commandFileNames(command, process.platform, env.PATHEXT || "");
    const fromDir = (dir: string) => names.map((name) => path.join(dir, name));
    // PATH 可能包含相对目录：统一规范化为绝对路径，避免探测和选择依赖 cwd 的可执行文件。
    const pathDirs = (env.PATH || "").split(path.delimiter).filter(Boolean).map((dir) => path.resolve(dir));
    const macOSApp = process.platform === "darwin" ? ["/Applications", path.join(home, "Applications")].flatMap((dir) => fromDir(path.join(dir, "Codex.app", "Contents", "Resources"))) : [];
    const candidates = dedupeCandidates([
        ...(options.explicitPath ? [path.resolve(options.explicitPath)] : []),
        ...pathDirs.flatMap(fromDir),
        ...toolchainBinDirectories(home, env).flatMap(fromDir),
        ...macOSApp,
    ], Number.POSITIVE_INFINITY);
    // 先做存在性校验再限量：图形环境继承的 PATH 常含大量不含 CLI 的目录，若在存在性校验前截断，
    // 工具链里的常见绝对路径（如 /opt/homebrew/bin/codex）会被无效 PATH 项挤出探测名单。
    // 显式路径始终保留，让探测能对失效的显式路径给出明确诊断，而不是悄悄换用其他 CLI。
    const explicit = options.explicitPath ? path.resolve(options.explicitPath) : "";
    const picked: string[] = explicit ? [explicit] : [];
    for (const candidate of candidates) {
        if (picked.length >= MAX_PROBE_CANDIDATES) break;
        if (candidate === explicit) continue;
        if (await isExecutableFile(candidate)) picked.push(candidate);
    }
    return picked;
}
