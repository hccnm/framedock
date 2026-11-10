import { useEffect } from "react";
import { App, Button, Dropdown } from "antd";
import { Bot, ChevronDown, RefreshCw, Settings2, Terminal } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useLocation } from "react-router-dom";
import { activateAgentEngine } from "@/services/api/agent-engine";
import { useAgentStore, type AgentEngine } from "@/stores/use-agent-store";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useLocalCliStore } from "@/stores/use-local-cli-store";
import { useConfigStore } from "@/stores/use-config-store";

export function AgentEnginePicker() {
    const { message } = App.useApp();
    const { pathname } = useLocation();
    const { engine, switchingEngine, connected, url, token, sending, waiting, loadingThreads, conversation, setAgentState } = useAgentStore(useShallow(({ engine, switchingEngine, connected, url, token, sending, waiting, loadingThreads, conversation, setAgentState }) => ({ engine, switchingEngine, connected, url, token, sending, waiting, loadingThreads, conversation, setAgentState })));
    const { runtimes, loading, scanning, error, load } = useLocalCliStore();
    const busy = switchingEngine || sending || waiting || loadingThreads || conversation.status === "preparing" || conversation.status === "running";
    useEffect(() => { if (connected) void load(url, token, true); }, [connected, url, token, load]);
    const choose = async (next: AgentEngine) => {
        if (next === engine || busy || !connected) return;
        setAgentState({ switchingEngine: true });
        try {
            const result = await activateAgentEngine(url, token, next, sessionStorage.getItem("canvas-agent-client-id") || "", useAgentStore.getState().permissionMode);
            useAgentSkillStore.getState().clearSelection();
            localStorage.setItem("canvas-agent-engine", next);
            setAgentState({ engine: next, conversation: result.conversation, activeThreadId: result.conversation.threadId, activeTurnId: "", messages: [], threads: [], models: [], model: "", reasoningEffort: "", tokenUsage: null, pendingApprovals: [], pendingTool: null });
        } catch (cause) {
            void message.error(cause instanceof Error ? cause.message : "Agent 切换失败");
        } finally {
            setAgentState({ switchingEngine: false });
        }
    };
    return <Dropdown trigger={["click"]} placement="topLeft" menu={{ selectedKeys: [engine], items: [
        { key: "api", icon: <Bot size={15} />, label: <span>内置 Agent<small className="block text-xs opacity-50">使用应用模型渠道，无需安装 CLI</small></span>, disabled: busy || !connected, onClick: () => void choose("api") },
        { type: "divider" },
        { key: "local", type: "group", label: "本地 CLI", children: runtimes.length ? runtimes.map((runtime) => ({ key: runtime.id, icon: <Terminal size={15} />, label: <span>{runtime.name}<small className="block text-xs opacity-50">{runtime.available ? `${runtime.version || "已检测到"} · ${runtime.authStatus === "authenticated" ? "已登录" : runtime.authStatus === "unauthenticated" ? "未登录" : "登录状态未知"}` : "未检测到，请安装或在设置中指定路径"}</small></span>, disabled: busy || !connected || !runtime.available || runtime.authStatus === "unauthenticated", onClick: () => void choose("codex") })) : [{ key: "empty", label: loading ? "正在检测本地 CLI…" : error || "连接本地服务后检测 CLI", disabled: true }] },
        { key: "scan", icon: <RefreshCw size={14} className={scanning ? "animate-spin" : ""} />, label: "重新检测", disabled: busy || !connected || scanning, onClick: () => void load(url, token, connected, true) },
        { key: "settings", icon: <Settings2 size={14} />, label: "Agent 设置", onClick: () => { if (pathname === "/") useConfigStore.getState().openConfigDialog(false, "local-cli"); else { setAgentState({ activeTab: "setup" }); useAgentStore.getState().openPanel(); } } },
    ] }}><Button type="text" className="!min-w-0 !px-2 !text-xs" title={engine === "api" ? "内置 Agent" : "Codex CLI"} aria-label={`选择 Agent：${engine === "api" ? "内置 Agent" : "Codex CLI"}`} loading={switchingEngine} icon={engine === "api" ? <Bot size={15} /> : <Terminal size={15} />}><span className="agent-engine-label">{engine === "api" ? "内置 Agent" : "Codex CLI"}</span><ChevronDown className="agent-engine-chevron" size={12} /></Button></Dropdown>;
}
