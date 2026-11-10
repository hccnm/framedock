import { Button } from "antd";
import { PlugZap, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";

export function AgentConnectView({ theme, enabled, connected, activity, connectError, onToggleEnabled }: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    url: string;
    token: string;
    enabled: boolean;
    connected: boolean;
    activity: string;
    connectError: string;
    onUrlChange: (value: string) => void;
    onTokenChange: (value: string) => void;
    onToggleEnabled: () => void;
}) {
    const { t } = useTranslation();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            <div className="space-y-4">
                <div>
                    <div className="text-base font-semibold leading-6">{t("agent.connect.title")}</div>
                    <div className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>{t("agent.connect.description")}</div>
                </div>
                <Button type="text" icon={<Settings className="size-4" />} onClick={() => openConfigDialog(false, "channels")}>{t("agent.connect.configureProvider")}</Button>
                <div className="flex items-center justify-between gap-3 text-sm">
                    <span style={{ color: theme.node.muted }}>{t(connectError ? "agent.status.failed" : connected ? "agent.status.connected" : enabled ? "agent.status.connecting" : "agent.status.disconnected")}</span>
                    <Button type="text" icon={<PlugZap className="size-4" />} onClick={onToggleEnabled}>{t(enabled ? "agent.connect.disconnect" : "agent.connect.connect")}</Button>
                </div>
                {connectError ? <div role="alert" className="text-xs leading-5" style={{ color: theme.node.text }}>{connectError}</div> : activity ? <div className="text-xs leading-5" style={{ color: theme.node.muted }}>{activity}</div> : null}
            </div>
        </div>
    );
}
