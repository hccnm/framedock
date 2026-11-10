import { useState } from "react";
import { App, Modal, Switch } from "antd";
import { Puzzle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { setPluginEnabled } from "@/lib/canvas/plugin-loader";
import { isBundledPluginUrl } from "@/lib/canvas/plugin-registry";
import { useThemeStore } from "@/stores/use-theme-store";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";

export function CanvasPluginManagerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { message } = App.useApp();
    const plugins = usePluginStore((state) => state.plugins);
    const [busyId, setBusyId] = useState<string | null>(null);
    const bundled = plugins.filter((item) => item.local && isBundledPluginUrl(item.url));

    const togglePlugin = async (record: InstalledPlugin, enabled: boolean) => {
        setBusyId(record.id);
        try {
            await setPluginEnabled(record, enabled);
            message.success(t(enabled ? "canvas.plugins.enabled" : "canvas.plugins.disabled"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <Modal title={t("canvas.plugins.title")} open={open} onCancel={onClose} footer={null} centered width={640}>
            <div className="space-y-3">
                <div className="text-xs" style={{ color: theme.node.muted }}>当前版本仅支持随应用提供的插件。</div>
                <div className="thin-scrollbar max-h-[52vh] space-y-2 overflow-auto">
                    {bundled.length === 0 ? (
                        <div className="py-10 text-center text-sm" style={{ color: theme.node.muted }}>暂无随包插件</div>
                    ) : bundled.map((record) => (
                        <div key={record.id} className="flex items-center gap-3 rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                            <Puzzle className="size-4 shrink-0" style={{ color: theme.node.muted }} />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 text-sm font-medium" style={{ color: theme.node.text }}>
                                    <span className="truncate">{record.name}</span>
                                    <span className="text-xs" style={{ color: theme.node.muted }}>v{record.version}</span>
                                </div>
                                {record.description && <div className="mt-0.5 truncate text-xs" style={{ color: theme.node.muted }}>{record.description}</div>}
                            </div>
                            <Switch size="small" checked={record.enabled} loading={busyId === record.id} onChange={(enabled) => togglePlugin(record, enabled)} />
                        </div>
                    ))}
                </div>
            </div>
        </Modal>
    );
}
