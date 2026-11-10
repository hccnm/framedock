import { fetchAgentJson } from "./canvas-agent";

export type LocalCliAuthStatus = "authenticated" | "unauthenticated" | "unknown";
export type LocalCliRuntime = {
    id: string;
    name: string;
    available: boolean;
    selected: boolean;
    executablePath?: string;
    version?: string;
    authStatus?: LocalCliAuthStatus;
    diagnostics?: Array<{ code: string; message: string }>;
};
type RuntimeListResponse = { ok?: boolean; data?: LocalCliRuntime[] };

/** 读取本机 CLI 运行时列表（带缓存，rescan 强制重新探测）。 */
export function fetchLocalRuntimes(endpoint: string, token: string) {
    return fetchAgentJson<RuntimeListResponse>(endpoint, token, "/agent/runtimes");
}

/** 强制重新扫描本机 CLI。 */
export function rescanLocalRuntimes(endpoint: string, token: string) {
    return fetchAgentJson<RuntimeListResponse>(endpoint, token, "/agent/runtimes/rescan", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
}

/** 选择运行时；只接受已验证的 id 和可选可执行路径，路径由 Agent 重新探测校验。 */
export function selectLocalRuntime(endpoint: string, token: string, id: string, executablePath?: string) {
    return fetchAgentJson<{ ok?: boolean; data?: LocalCliRuntime }>(endpoint, token, "/agent/runtime", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, executablePath }) });
}

/** 测试运行时：返回真实路径、版本与登录状态，不改变选择。 */
export function testLocalRuntime(endpoint: string, token: string, id: string, executablePath?: string) {
    return fetchAgentJson<{ ok?: boolean; data?: LocalCliRuntime }>(endpoint, token, "/agent/runtime/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, executablePath }) });
}
