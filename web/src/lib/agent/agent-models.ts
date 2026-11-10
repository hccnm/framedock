import { useAgentStore, type AgentEngine, type AgentModel, type AgentReasoningEffort } from "@/stores/use-agent-store";
import { useConfigStore, encodeChannelModel, decodeChannelModel } from "@/stores/use-config-store";
import { fetchAgentJson } from "@/services/api/canvas-agent";

export async function waitForAgentConfig() {
    if (!useConfigStore.persist.hasHydrated()) await new Promise<void>((resolve) => {
        const unsubscribe = useConfigStore.persist.onFinishHydration(() => { unsubscribe(); resolve(); });
        if (useConfigStore.persist.hasHydrated()) { unsubscribe(); resolve(); }
    });
}

/** 与图像/视频生成共用应用渠道，凭据只在发送任务时读取。 */
export async function loadAgentModelOptions(endpoint?: string, token?: string, engine: AgentEngine = "api") {
    if (engine === "codex") {
        if (!endpoint || !token) throw new Error("请先连接本地 Agent 服务");
        const { data: models = [] } = await fetchAgentJson<{ data?: AgentModel[] }>(endpoint, token, "/agent/codex/models");
        const selected = models.find((item) => item.model === useAgentStore.getState().model) || models.find((item) => item.isDefault) || models[0];
        return { models, model: selected?.model || "", reasoningEffort: selected?.defaultReasoningEffort || "" as const };
    }
    await waitForAgentConfig();
    const { config } = useConfigStore.getState();
    const models: AgentModel[] = config.channels.flatMap((channel) => channel.models.filter((item) => item.capability === "text").map((item) => ({
        id: encodeChannelModel(channel.id, item.name), model: encodeChannelModel(channel.id, item.name), displayName: `${channel.name} · ${item.name}`,
        defaultReasoningEffort: "medium" as const, supportedReasoningEfforts: [],
    })));
    const saved = useAgentStore.getState().model;
    return { models, model: models.find((item) => item.model === saved)?.model || models.find((item) => item.model === config.textModel)?.model || models[0]?.model || "", reasoningEffort: "" as AgentReasoningEffort | "" };
}

export async function agentProvider(model: string, endpoint: string) {
    const target = new URL(endpoint);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || !["http:", "https:"].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new Error("渠道密钥仅可发送到本机 Agent 服务");
    await waitForAgentConfig();
    const decoded = decodeChannelModel(model);
    const channel = useConfigStore.getState().config.channels.find((item) => item.id === decoded?.channelId);
    if (!channel || !decoded || !channel.models.some((item) => item.name === decoded.model && item.capability === "text") || !channel.apiKey.trim()) throw new Error("请先在设置中配置文本模型和 API Key");
    return { protocol: channel.apiFormat, baseUrl: channel.baseUrl.trim(), apiKey: channel.apiKey, model: decoded.model };
}
