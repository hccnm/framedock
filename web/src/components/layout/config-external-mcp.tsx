import { App, Button, Segmented, Switch } from "antd";
import { Copy, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { LocalAgentPanel } from "@/components/agent/local-agent-panel";
import { useCopyText } from "@/hooks/use-copy-text";
import { fetchExternalMcp, resetExternalMcpToken, setExternalMcpEnabled, type ExternalMcpStatus } from "@/services/api/canvas-agent";
import { useAgentStore } from "@/stores/use-agent-store";

export function ConfigExternalMcp() {
    const { message, modal } = App.useApp();
    const copyText = useCopyText();
    const endpoint = useAgentStore((state) => state.url);
    const token = useAgentStore((state) => state.token);
    const [status, setStatus] = useState<ExternalMcpStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [mode, setMode] = useState("发给 Agent");

    useEffect(() => {
        let active = true;
        setStatus(null);
        setError("");
        if (endpoint && token) void fetchExternalMcp(endpoint, token).then((value) => { if (active) setStatus(value); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "读取服务状态失败"); });
        return () => { active = false; };
    }, [endpoint, token]);

    const update = async (enabled?: boolean, resetToken = false) => {
        setBusy(true);
        setError("");
        try {
            setStatus(await (resetToken ? resetExternalMcpToken(endpoint, token) : enabled === undefined ? fetchExternalMcp(endpoint, token) : setExternalMcpEnabled(endpoint, token, enabled)));
            if (resetToken) message.success("访问令牌已重置，请更新外部客户端配置。");
        } catch (reason) {
            const detail = reason instanceof Error ? reason.message : "更新服务状态失败";
            setError(detail);
            message.error(detail);
        } finally {
            setBusy(false);
        }
    };
    const config = status?.enabled ? JSON.stringify({ mcpServers: { framedock: { type: "http", url: status.url, headers: { Authorization: `Bearer ${status.token}` } } } }, null, 2) : "";
    const instructions = status?.enabled ? `请添加一个名为 framedock 的 HTTP MCP 服务，地址为 ${status.url}，请求头 Authorization 为 Bearer ${status.token}。连接后调用 canvas_list_projects 确认连接成功。\n\n此服务可以读取和修改 FrameDock 项目，生成操作会使用应用中配置的模型或 ComfyUI。执行生成前先确认用户意图。` : "";
    const content = mode === "发给 Agent" ? instructions : config;

    return (
        <div className="space-y-7 py-2">
            <LocalAgentPanel headless autoConnect />
            <div className="flex items-start justify-between gap-6">
                <div>
                    <h3 className="m-0 text-base font-semibold">允许外部 Agent 调用</h3>
                    <p className="mt-2 text-sm opacity-60">通过本机 HTTP MCP 连接 FrameDock，查看项目、操作画布并调用创作工具。</p>
                </div>
                <Switch aria-label="允许外部 Agent 调用" checked={status?.enabled || false} loading={busy} disabled={!status} onChange={(enabled) => void update(enabled)} />
            </div>
            <div className="flex items-center justify-between gap-3 border-y border-current/10 py-4">
                <div><strong>{status?.enabled ? "已启动" : "未启动"}</strong><span className="ml-3 text-sm opacity-60">{status?.enabled ? "仅允许本机连接，需使用下方访问令牌。" : "开启后外部 Agent 才能连接；复制配置不会自动开启。"}</span></div>
                <div className="flex shrink-0 items-center gap-1">
                    <Button type="text" disabled={!status || busy} onClick={() => modal.confirm({ title: "重置访问令牌？", content: "旧令牌将立即失效，正在连接的外部请求会断开。重置后需更新外部客户端配置。", okText: "重置令牌", cancelText: "取消", onOk: () => update(undefined, true) })}>重置令牌</Button>
                    <Button type="text" icon={<RefreshCw size={14} />} disabled={!endpoint || !token} loading={busy} onClick={() => void update()}>刷新</Button>
                </div>
            </div>
            {(!endpoint || !token) && <p className="text-sm opacity-60">请先启动桌面版并等待创作助手连接。</p>}
            {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="m-0 text-base font-semibold">连接方式</h3><Segmented value={mode} options={["发给 Agent", "手动配置"]} onChange={(value) => setMode(String(value))} /></div>
            <p className="text-sm opacity-60">{mode === "发给 Agent" ? "复制以下内容发给外部 Agent，让它添加连接配置。内容含访问令牌，请仅交给你信任的客户端。" : "将配置加入支持 HTTP MCP 和自定义请求头的客户端。不同客户端的配置字段可能略有差异。"}</p>
            {status?.enabled ? <div className="rounded-xl border border-current/10 p-4"><div className="mb-3 flex justify-end"><Button type="text" icon={<Copy size={14} />} onClick={() => copyText(content)}>复制</Button></div><pre className="m-0 whitespace-pre-wrap break-all text-sm leading-6">{content}</pre></div> : <div className="rounded-xl border border-dashed border-current/15 p-6 text-center text-sm opacity-50">开启服务后显示连接地址与配置</div>}
            <p className="text-xs leading-6 opacity-60">应用需保持运行。关闭后拒绝新的连接和工具调用，已经开始的生成任务不会自动取消。连接地址使用固定端口，访问令牌在关闭、重新开启及应用重启后保持不变；仅重置令牌后需更新客户端配置。应用重启后默认关闭，重新开启即可使用原配置。当前开放现有全部画布工具，画布操作面向最近激活的创作页，内置助手执行任务时拒绝外部调用；涉及生成的操作可能产生模型费用或占用远程 GPU。</p>
        </div>
    );
}
