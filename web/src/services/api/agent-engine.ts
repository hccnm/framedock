import type { AgentConversationState, AgentEngine, AgentPermissionMode } from "@/stores/use-agent-store";
import { fetchAgentJson } from "./canvas-agent";

export async function activateAgentEngine(endpoint: string, token: string, engine: AgentEngine, clientId: string, permissionMode: AgentPermissionMode, initialize = false) {
    const result = await fetchAgentJson<{ engine: AgentEngine; workspace: { workspacePath: string; activeThreadId?: string }; conversation: AgentConversationState }>(endpoint, token, "/agent/engine", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ engine, clientId, permissionMode, initialize }),
    });
    if (result.engine !== "api" && result.engine !== "codex") throw new Error("Agent 服务版本不匹配，请重启本地 Agent 服务");
    return result;
}
