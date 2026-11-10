import { PROBE_TIMEOUT_MS } from "./executables.js";
import { detectCli } from "./detection.js";
import { runCliCommand } from "./process.js";
import type { LocalCliAuthStatus } from "./types.js";

export const CODEX_COMMAND = "codex";

/** 探测本机 Codex CLI；显式路径失效时保留诊断信息。 */
export function probeCodexRuntime(explicitPath?: string) {
    return detectCli(CODEX_COMMAND, { explicitPath });
}

/** 读取本机 Codex 登录状态；只解析状态文本，不读取或返回凭据内容。 */
export async function codexLoginStatus(executablePath: string): Promise<LocalCliAuthStatus> {
    const result = await runCliCommand(executablePath, ["login", "status"], PROBE_TIMEOUT_MS);
    const output = `${result.stdout}\n${result.stderr}`;
    if (/not logged in/i.test(output)) return "unauthenticated";
    if (/logged in/i.test(output) || result.code === 0) return "authenticated";
    return "unknown";
}
