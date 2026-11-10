import { coerceFieldValue } from "./mapping";
import { defaultFieldValue, isMediaFieldType } from "./workflow";
import type { ComfyWorkflow, ComfyWorkflowField } from "@/types/comfyui";

export function workbenchPromptField(fields: ComfyWorkflowField[], selectedId = "") {
    const textFields = fields.filter((field) => field.enabled && (field.type === "text" || field.type === "textarea"));
    return textFields.find((field) => field.id === selectedId) || textFields.find((field) => field.presetRole === "prompt");
}

export function prepareWorkbenchRun(workflow: ComfyWorkflow, values: Record<string, unknown>, randomEnabled: Record<string, boolean>, promptFieldId: string, prompt: string) {
    const run = structuredClone(workflow);
    for (const field of run.fields) {
        if (field.id in randomEnabled) field.randomize = randomEnabled[field.id];
    }
    const resolved = Object.fromEntries(
        run.fields
            .filter((field) => field.enabled && !isMediaFieldType(field.type))
            .map((field) => {
                const raw = field.id === promptFieldId ? prompt : (values[field.id] ?? defaultFieldValue(field));
                const value = (field.type === "text" || field.type === "textarea") && raw === "" ? "" : coerceFieldValue(field, raw);
                if ((field.type === "number" || field.type === "slider") && !field.randomize && (value === undefined || (field.min !== undefined && Number(value) < field.min) || (field.max !== undefined && Number(value) > field.max))) {
                    throw new Error(`请填写有效参数：${field.label || field.inputKey}`);
                }
                return [field.id, value];
            }),
    );
    return { workflow: run, values: resolved };
}
