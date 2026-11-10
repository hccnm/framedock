import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/** 收集 GUI 环境常见的 CLI 工具链目录，补偿 macOS 图形进程缺失的交互式 PATH。 */
export function toolchainBinDirectories(home: string, env: NodeJS.ProcessEnv = process.env) {
    const dirs = [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        path.join(home, ".local", "bin"),
        path.join(home, ".local", "share", "pnpm"),
        path.join(home, ".bun", "bin"),
        path.join(home, ".volta", "bin"),
        path.join(home, ".asdf", "shims"),
        path.join(home, ".local", "share", "mise", "shims"),
        path.join(home, ".fnm", "aliases", "default", "bin"),
        path.join(home, ".local", "share", "fnm", "aliases", "default", "bin"),
        ...(process.platform === "win32" ? [path.join(home, "AppData", "Roaming", "npm")] : []),
        // npm_config_prefix、NVM_DIR 来自环境变量，可能是相对路径：统一规范化为绝对路径。
        ...(env.npm_config_prefix ? [process.platform === "win32" ? path.resolve(env.npm_config_prefix) : path.resolve(env.npm_config_prefix, "bin")] : []),
    ];
    const nvmRoot = path.resolve(env.NVM_DIR || path.join(home, ".nvm"), "versions", "node");
    try {
        dirs.push(...readdirSync(nvmRoot).sort().reverse().map((version) => path.join(nvmRoot, version, "bin")));
    } catch {
        // 没有 nvm 安装时忽略。
    }
    return [...new Set(dirs.filter((dir) => existsSync(dir)))];
}
