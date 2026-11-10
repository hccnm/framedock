import { desktopBridge } from "@/lib/desktop-host";
import { useAgentStore } from "@/stores/use-agent-store";
import { fetchAgentJson } from "./canvas-agent";

export type CodexImageRequest = {
    projectId: string; nodeId: string; requestId: string; prompt: string;
    references: { name: string; dataUrl: string }[];
    options?: { size?: string; quality?: string; background?: string; count?: number };
};
export type CodexImageResult = {
    projectId: string; nodeId: string; requestId: string; threadId: string; turnId: string;
    images: { itemId: string; dataUrl: string; revisedPrompt: string; turnId?: string; transparentBackground?: boolean }[];
};

export async function generateCodexNodeImage(input: CodexImageRequest, signal: AbortSignal) {
    const desktop = desktopBridge();
    const agent = useAgentStore.getState();
    const connection = desktop ? await desktop.getAgentConnection() : { url: agent.url, token: agent.token };
    if (!connection?.url || !connection.token) throw new Error("请先连接本机 Codex CLI；Codex 生图渠道无需配置 API Key");
    return fetchAgentJson<CodexImageResult>(connection.url.replace(/\/+$/, ""), connection.token, "/agent/codex/image", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal,
    });
}
