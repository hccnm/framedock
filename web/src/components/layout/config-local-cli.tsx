import { Button } from "antd";
import { MonitorDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AgentRuntimeView } from "@/components/agent/agent-runtime-view";
import { canvasThemes } from "@/lib/canvas-theme";
import { isDesktopHost } from "@/lib/desktop-host";
import { useThemeStore } from "@/stores/use-theme-store";
import { useAgentStore } from "@/stores/use-agent-store";

/** 设置页「本机 CLI」分区：桌面环境直接管理；浏览器环境提示需要桌面版，已手动连接本地 Agent 的开发场景可用。 */
export function ConfigLocalCli() {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const token = useAgentStore((state) => state.token);
    const openPanel = useAgentStore((state) => state.openPanel);
    const connectable = isDesktopHost() || Boolean(token.trim());

    if (connectable) return <AgentRuntimeView theme={theme} />;
    return (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <MonitorDown className="size-8 text-stone-400" />
            <div className="text-sm font-semibold">{t("config.localCli.desktopRequired")}</div>
            <div className="max-w-md text-xs leading-5 text-stone-500">{t("config.localCli.desktopRequiredDescription")}</div>
            <Button size="small" className="!h-7 !px-2" onClick={openPanel}>
                {t("config.localCli.openAgentPanel")}
            </Button>
        </div>
    );
}
