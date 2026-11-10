/** A completed status query may legitimately contain words such as “失败 0”. */
export function resolveToolCardStatus(status: string, text: string, error = "") {
    status = status.toLowerCase();
    if (["failed", "error"].includes(status) || error.trim()) return "failed";
    if (["declined", "rejected", "cancelled", "canceled", "interrupted"].includes(status)) return "canceled";
    if (status === "noop") return "noop";
    if (["inprogress", "in_progress", "running", "started", "pending"].includes(status)) return "running";
    if (["completed", "succeeded", "success"].includes(status)) return "completed";
    if (/未生效|无需|没有找到|没有.*可|已存在/.test(text)) return "noop";
    if (/拒绝|取消/.test(text)) return "canceled";
    if (/失败|错误|failed|error/i.test(text)) return "failed";
    if (/完成|成功/.test(text)) return "completed";
    return "recorded";
}
