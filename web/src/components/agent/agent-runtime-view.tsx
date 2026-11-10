import { useEffect, useState } from "react";
import { App, Button, Input } from "antd";
import { CheckCircle2, ChevronRight, CircleDashed, CloudOff, RefreshCw, ShieldCheck, ShieldX, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { loadAgentModelOptions } from "@/lib/agent/agent-models";
import { canvasThemes } from "@/lib/canvas-theme";
import { isDesktopHost } from "@/lib/desktop-host";
import { useAgentStore } from "@/stores/use-agent-store";
import { useLocalCliStore } from "@/stores/use-local-cli-store";
import type { LocalCliRuntime } from "@/services/api/local-cli";

/** 本机 CLI 运行时管理视图：扫描状态、路径/版本/登录态、重扫、测试与选择。 */
export function AgentRuntimeView({ theme }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const endpoint = useAgentStore((state) => state.url);
    const token = useAgentStore((state) => state.token);
    const connected = useAgentStore((state) => state.connected);
    const models = useAgentStore((state) => state.models);
    const engine = useAgentStore((state) => state.engine);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const { runtimes, loading, scanning, testingId, error, load, select, test, clearError } = useLocalCliStore();
    const [expandedId, setExpandedId] = useState("");
    const [pathDraft, setPathDraft] = useState("");
    const [testedView, setTestedView] = useState<LocalCliRuntime | null>(null);
    const connectable = Boolean(connected && endpoint && token);

    useEffect(() => {
        if (connectable) void load(endpoint, token, connectable);
    }, [connectable, endpoint, load, token]);

    const authView = (runtime: LocalCliRuntime) => {
        if (!runtime.available) return null;
        if (runtime.authStatus === "authenticated") return { icon: <ShieldCheck className="size-3.5 text-emerald-600" />, label: t("agent.cli.authenticated") };
        if (runtime.authStatus === "unauthenticated") return { icon: <ShieldX className="size-3.5 text-amber-600" />, label: t("agent.cli.unauthenticated") };
        return { icon: <CircleDashed className="size-3.5" style={{ color: theme.node.muted }} />, label: t("agent.cli.authUnknown") };
    };

    const runTest = async (runtime: LocalCliRuntime) => {
        const result = await test(endpoint, token, runtime.id, expandedId === runtime.id && pathDraft.trim() ? pathDraft.trim() : undefined);
        if (!result) return;
        setTestedView(result);
        if (result.available) message.success(t("agent.cli.testPassed", { detail: `${result.executablePath || ""}${result.version ? ` · v${result.version}` : ""}` }));
        else message.error(t("agent.cli.testFailedWithReason", { reason: result.diagnostics?.[0]?.message || t("agent.cli.testFailed") }));
    };

    const chooseRuntime = async (runtime: LocalCliRuntime, executablePath?: string) => {
        try {
            await select(endpoint, token, runtime.id, executablePath);
            setTestedView(null);
            message.success(engine === "codex" ? t("agent.cli.selected", { name: runtime.name }) : "CLI 已配置，可在输入框切换使用");
            // 切换后 app-server 会重启：模型与推理强度必须从新 CLI 重新读取；读取失败时清空旧列表，避免误标实时。
            const options = await loadAgentModelOptions(endpoint, token, engine).catch(() => null);
            if (options) setAgentState(options);
            else setAgentState({ models: [], model: "", reasoningEffort: "" });
        } catch {
            // 错误已写入 store，由上方提示条展示。
        }
    };

    return (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <div className="text-base font-semibold leading-6">{t("agent.cli.title")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                        {t("agent.cli.description")}
                    </div>
                </div>
                <Button size="small" type="text" className="!h-8 shrink-0 !px-2" disabled={!connectable} icon={<RefreshCw className={`size-3.5 ${scanning ? "animate-spin" : ""}`} />} onClick={() => void load(endpoint, token, connectable, true)}>
                    {t("agent.cli.rescan")}
                </Button>
            </div>
            {error ? (
                <div className="rounded-md border px-2.5 py-2 text-xs leading-5" style={{ borderColor: "rgba(220,38,38,.35)", color: "#dc2626" }} onClick={clearError}>
                    {error}
                </div>
            ) : null}
            {!connectable ? (
                <div className="rounded-lg border px-3 py-3 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    {isDesktopHost() ? t("agent.cli.desktopStarting") : t("agent.cli.connectRequired")}
                </div>
            ) : loading ? (
                <div className="rounded-lg border px-3 py-4 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    {t("agent.cli.scanning")}
                </div>
            ) : (
                runtimes.map((runtime) => {
                    const expanded = expandedId === runtime.id;
                    const auth = authView(runtime);
                    const shown = testedView && testedView.id === runtime.id ? testedView : runtime;
                    return (
                        <div key={runtime.id} className="rounded-lg border" style={{ borderColor: engine === "codex" && runtime.selected ? theme.node.activeStroke : theme.node.stroke }}>
                            <button type="button" className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left" onClick={() => setExpandedId(expanded ? "" : runtime.id)}>
                                {runtime.available ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : <CloudOff className="size-4 shrink-0" style={{ color: theme.node.muted }} />}
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-2">
                                        <span className="truncate text-sm font-medium leading-5">{runtime.name}</span>
                                        {runtime.selected ? (
                                            <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] leading-3" style={{ borderColor: theme.node.activeStroke, color: theme.node.activeStroke }}>
                                                {engine === "codex" ? t("agent.cli.selectedBadge") : "已配置"}
                                            </span>
                                        ) : null}
                                    </span>
                                    <span className="mt-0.5 block truncate text-[11px] leading-4" style={{ color: theme.node.muted }}>
                                        {runtime.available ? `${runtime.executablePath || ""}${runtime.version ? ` · v${runtime.version}` : ""}` : t("agent.cli.notInstalled")}
                                    </span>
                                </span>
                                <ChevronRight className={`size-4 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} style={{ color: theme.node.muted }} />
                            </button>
                            {expanded ? (
                                <div className="space-y-2.5 border-t px-3 py-3" style={{ borderColor: theme.node.stroke }}>
                                    {auth ? (
                                        <div className="flex items-center gap-1.5 text-xs leading-5">
                                            {auth.icon}
                                            <span>{t("agent.cli.authLabel", { status: auth.label })}</span>
                                        </div>
                                    ) : null}
                                    {shown.diagnostics?.length ? (
                                        <div className="space-y-1 rounded-md border px-2 py-1.5 text-[11px] leading-4" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                                            {shown.diagnostics.map((item) => (
                                                <div key={item.code}>{item.message}</div>
                                            ))}
                                        </div>
                                    ) : null}
                                    <div className="flex flex-wrap gap-2">
                                        <Button size="small" className="!h-7 !px-2" disabled={!connectable} loading={testingId === runtime.id} icon={<Terminal className="size-3.5" />} onClick={() => void runTest(runtime)}>
                                            {t("agent.cli.test")}
                                        </Button>
                                        {runtime.available && !runtime.selected ? (
                                            <Button size="small" type="text" className="!h-7 !px-2 hover:bg-black/5 dark:hover:bg-white/10" onClick={() => void chooseRuntime(runtime)}>
                                                {t("agent.cli.use")}
                                            </Button>
                                        ) : null}
                                    </div>
                                    <div>
                                        <div className="mb-1 text-[11px] font-medium" style={{ color: theme.node.muted }}>
                                            {engine === "codex" ? t("agent.cli.modelsLabel", { count: models.length }) : "当前使用内置 Agent，可在输入框切换到本地 CLI"}
                                            {engine === "codex" && <span className="ml-1.5 font-normal">{models.length ? t("agent.cli.modelsLive") : t("agent.cli.modelsDefault")}</span>}
                                        </div>
                                        {engine === "codex" && models.length ? (
                                            <div className="truncate text-xs leading-5" style={{ color: theme.node.text }}>
                                                {models.filter((item) => item.isDefault).map((item) => item.displayName).join("、") || models[0].displayName}
                                            </div>
                                        ) : null}
                                    </div>
                                    <label className="grid gap-1.5">
                                        <span className="text-[11px] font-medium" style={{ color: theme.node.muted }}>
                                            {t("agent.cli.customPath")}
                                        </span>
                                        <div className="flex gap-2">
                                            <Input size="small" value={pathDraft} onChange={(event) => setPathDraft(event.target.value)} placeholder={t("agent.cli.customPathPlaceholder")} />
                                            <Button size="small" className="!h-7 shrink-0 !px-2" disabled={!connectable || !pathDraft.trim()} loading={testingId === runtime.id} onClick={() => void chooseRuntime(runtime, pathDraft.trim())}>
                                                {t("agent.cli.savePath")}
                                            </Button>
                                            {runtime.selected ? (
                                                <Button size="small" className="!h-7 shrink-0 !px-2" disabled={!connectable} onClick={() => void chooseRuntime(runtime)}>
                                                    {t("agent.cli.clearPath")}
                                                </Button>
                                            ) : null}
                                        </div>
                                        <span className="text-[11px]" style={{ color: theme.node.faint }}>
                                            {t("agent.cli.customPathHint")}
                                        </span>
                                    </label>
                                    {!runtime.available ? <div className="text-[11px] leading-4" style={{ color: theme.node.muted }}>{t("agent.cli.installHint")}</div> : null}
                                </div>
                            ) : null}
                        </div>
                    );
                })
            )}
            <div className="text-[11px] leading-4" style={{ color: theme.node.faint }}>
                {t("agent.cli.claudeLater")}
            </div>
        </div>
    );
}
