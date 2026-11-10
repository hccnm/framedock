import { nanoid } from "nanoid";
import { desktopBridge } from "@/lib/desktop-host";
import type { GenerationNotification } from "@/types/desktop-host";

export function notifyGeneration(notification: GenerationNotification) {
    const host = desktopBridge();
    if (host) void Promise.resolve().then(() => host.notifyGeneration(notification)).catch((error) => console.warn("生成任务系统通知发送失败：", error));
}

export function notifyCanvasGeneration(projectId: string, nodeId: string, status: "success" | "error", label: string, runId = nanoid(), counts?: { success: number; failed: number }) {
    notifyGeneration({
        id: `canvas:${projectId}:${nodeId}:${runId}:${status}`,
        title: `${label}生成${status === "error" ? "失败" : counts?.failed ? "部分失败" : "完成"}`,
        body: counts?.failed ? `${counts.success} 项成功，${counts.failed} 项失败。点击查看画布任务。` : `点击返回创作页查看${status === "error" ? "任务与失败原因" : "任务结果"}。`,
        target: { kind: "canvas", projectId, nodeId },
    });
}

export function notifyWorkbenchGeneration(kind: "image" | "video", log: { id: string; status: string; title: string; successCount?: number; failCount?: number }) {
    const label = kind === "image" ? "图像" : "视频";
    const status = log.status === "failed" ? "失败" : log.failCount ? "部分失败" : "完成";
    notifyGeneration({
        id: `${kind}:${log.id}:${log.status}`,
        title: `${label}生成${status}`,
        body: log.failCount ? `${log.title} · ${log.successCount ?? 0} 项成功，${log.failCount} 项失败。点击查看任务。` : `${log.title} · 点击查看任务${log.status === "failed" ? "与失败原因" : "结果"}。`,
        target: { kind, logId: log.id },
    });
}
