import { collectCliCandidates, isExecutableFile, parseCliVersion, PROBE_TIMEOUT_MS } from "./executables.js";
import { isUnsafeWindowsCmdTarget, runCliCommand } from "./process.js";
import type { LocalCliDiagnostic } from "./types.js";

export type CliDetection = { available: boolean; executablePath?: string; version?: string; skipped: LocalCliDiagnostic[] };
export type VersionProbeVerdict = { version?: string; diagnostic?: LocalCliDiagnostic };
type CandidateProbe = { path: string; version?: string; diagnostic?: LocalCliDiagnostic };

/** 解读一次 --version 探测结果：必须正常退出、输出确认 CLI 身份且含可识别版本号。 */
export function interpretVersionProbe(command: string, path: string, code: number | null, output: string): VersionProbeVerdict {
    if (code === null) return { diagnostic: { code: "probe-failed", message: `无法启动 ${path}（超时或执行失败），已跳过` } };
    if (code !== 0) return { diagnostic: { code: "probe-exit", message: `${path} --version 以退出码 ${code} 结束，已跳过` } };
    if (!new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(output)) return { diagnostic: { code: "identity-unconfirmed", message: `${path} 的输出未确认 ${command} 身份，已跳过` } };
    const version = parseCliVersion(output);
    if (!version) return { diagnostic: { code: "version-unreadable", message: `${path} 未返回可识别的版本号，已跳过` } };
    return { version };
}

/** 并行探测候选路径，按候选顺序取第一个可用结果；坏 shim 记入诊断并跳过。 */
export async function detectCli(command: string, options: { explicitPath?: string; env?: NodeJS.ProcessEnv } = {}): Promise<CliDetection> {
    const candidates = await collectCliCandidates(command, options);
    const probes = await Promise.all(candidates.map((candidate) => probeCandidate(command, candidate)));
    const skipped = probes.flatMap((probe) => probe.diagnostic || []);
    if (options.explicitPath) {
        // 显式路径失效时给出明确诊断，不悄悄换成另一个 CLI。
        const explicit = probes[0];
        return { available: Boolean(explicit?.version), executablePath: explicit?.version ? explicit.path : undefined, version: explicit?.version, skipped };
    }
    const winner = probes.find((probe) => probe.version);
    return { available: Boolean(winner), executablePath: winner?.path, version: winner?.version, skipped };
}

/** 单个候选的真实探测：文件存在不等于可用，必须成功执行 --version 并确认身份。 */
async function probeCandidate(command: string, candidate: string): Promise<CandidateProbe> {
    if (isUnsafeWindowsCmdTarget(candidate)) return { path: candidate, diagnostic: { code: "unsafe-path", message: `${candidate} 包含不允许的字符，已跳过` } };
    if (!(await isExecutableFile(candidate))) return { path: candidate };
    const result = await runCliCommand(candidate, ["--version"], PROBE_TIMEOUT_MS);
    const { version, diagnostic } = interpretVersionProbe(command, candidate, result.code, `${result.stdout}\n${result.stderr}`);
    return version ? { path: candidate, version } : { path: candidate, diagnostic };
}
