import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";

export function CanvasCodexImageStatus({ node, isRunning, compact }: { node: CanvasNodeData; isRunning: boolean; compact?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const run = node.metadata?.codexImageRun;
    const labels = { preparing: "准备参考图…", running: "Codex 正在生成…", saving: "保存生成图片…", success: "生成完成", error: "生成失败", cancelled: "已取消" };
    const interrupted = !isRunning && run && ["preparing", "running", "saving"].includes(run.status);
    if (compact) return <p role={run?.error ? "alert" : "status"} title={run?.error} className="truncate text-[11px] leading-5" style={{ color: theme.node.muted }}>{run?.error || (interrupted ? "上次生成已中断，可重新生成" : run ? labels[run.status] : "使用本机 Codex 登录")}</p>;
    return <div className="text-[11px] leading-5" style={{ color: theme.node.muted }}>
        <p role="status">{interrupted ? "上次生成已中断，可重新生成" : run ? labels[run.status] : "使用本机 Codex 登录"}</p>
        {run?.error && <p role="alert" className="whitespace-pre-wrap break-words">{run.error}</p>}
    </div>;
}
