import { spawn } from "node:child_process";

export type CliCommandResult = { code: number | null; stdout: string; stderr: string };

/** 以数组参数安全执行 CLI 命令，超时后终止子进程；不拼接 shell 命令字符串。 */
export function runCliCommand(file: string, args: string[], timeoutMs: number, env: NodeJS.ProcessEnv = process.env): Promise<CliCommandResult> {
    return new Promise((resolve) => {
        const child = spawnCli(file, args, env);
        let stdout = "";
        let stderr = "";
        let settled = false;
        const finish = (code: number | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
        };
        const timer = setTimeout(() => {
            child.kill();
            finish(null);
        }, timeoutMs);
        child.stdout?.on("data", (chunk) => {
            stdout += chunk;
        });
        child.stderr?.on("data", (chunk) => {
            stderr += chunk;
        });
        child.on("error", () => finish(null));
        child.on("close", (code) => finish(code));
    });
}

/** Windows 上需经 cmd.exe 解释的 .cmd/.bat 目标，必须拒绝可改变命令含义的字符（含 % 环境变量展开）。 */
export function isUnsafeWindowsCmdTarget(file: string, platform = process.platform) {
    return platform === "win32" && /\.(?:cmd|bat)$/i.test(file) && /["%&|<>^\r\n\x00-\x1f]/.test(file);
}

/** Windows 上的 .cmd/.bat 必须经 cmd.exe 解释；对每个参数独立引号包装，不拼接任意命令字符串。 */
function spawnCli(file: string, args: string[], env: NodeJS.ProcessEnv) {
    const stdio: ["ignore", "pipe", "pipe"] = ["ignore", "pipe", "pipe"];
    if (process.platform !== "win32" || !/\.(?:cmd|bat)$/i.test(file)) return spawn(file, args, { stdio, windowsHide: true, env });
    const quoted = args.map((arg) => `"${arg.replace(/"/g, '""')}"`).join(" ");
    return spawn("cmd.exe", ["/d", "/s", "/c", `"${file}" ${quoted}`], { stdio, windowsHide: true, windowsVerbatimArguments: true, env });
}
