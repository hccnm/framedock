/** 本机 CLI 运行时的公共契约；后续 Claude Code 等新 CLI 按同一契约接入。 */
export type LocalCliId = "codex";
export type LocalCliAuthStatus = "authenticated" | "unauthenticated" | "unknown";
export type LocalCliDiagnostic = { code: string; message: string };

export type LocalCliRuntime = {
    id: LocalCliId;
    name: string;
    available: boolean;
    selected: boolean;
    executablePath?: string;
    version?: string;
    authStatus?: LocalCliAuthStatus;
    diagnostics?: LocalCliDiagnostic[];
};
