import i18n from "@/i18n";
import type { ComfyApiNode, ComfyObjectInfo, ComfyObjectInfoInput, ComfyPresetRole, ComfyWorkflow, ComfyOutputKind, ComfyWorkflowField, ComfyWorkflowFieldType, ComfyWorkflowDiagnostic } from "@/types/comfyui";
import { dynamicInput, fieldMediaType, inputDefinition, isLinkInput, mediaType, numberValue, readObjectInfoEntry, uploadType, workflowNodeInfo } from "./definition";
import { applyReferenceGroups, configuredReferenceGroups, discoverReferenceGroups } from "./references";
export { isLinkInput } from "./definition";

export const UNIQUE_PRESET_ROLES: ComfyPresetRole[] = ["prompt", "strength", "width", "height", "seed"];
export const PRESET_ROLES: ComfyPresetRole[] = ["prompt", "image", "strength", "width", "height", "seed"];
const SEED_NAME_RULE = /^(seed|noise_seed)$/i;
const PROMPT_NAME_RULE = /^(text|prompt|positive)$/i;
type Graph = Record<string, ComfyApiNode>;
type Definition = Pick<ComfyWorkflow, "nodeInfo" | "referenceGroups" | "outputNodeIds">;

export function parseWorkflowFile(text: string): Graph {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error(i18n.t("comfyui.import.invalidJson"));
    }
    return validateWorkflow(parsed);
}

export function validateWorkflow(parsed: unknown): Graph {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(i18n.t("comfyui.import.notApiFormat"));
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.nodes) || Array.isArray(record.links)) throw new Error(i18n.t("comfyui.import.uiFormat"));
    if (!Object.keys(record).length) throw new Error(i18n.t("comfyui.import.empty"));
    const graph: Graph = {};
    for (const [id, raw] of Object.entries(record)) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(i18n.t("comfyui.import.invalidNode"));
        const node = raw as Partial<ComfyApiNode>;
        if (!node.class_type || typeof node.class_type !== "string") throw new Error(i18n.t("comfyui.import.noClassType"));
        graph[id] = { class_type: node.class_type, inputs: node.inputs && typeof node.inputs === "object" && !Array.isArray(node.inputs) ? structuredClone(node.inputs) : {}, ...(node._meta ? { _meta: structuredClone(node._meta) } : {}) };
    }
    return graph;
}

/** Protocol metadata determines controls. Field-name conventions only suggest scalar roles. */
export function inferFieldShape(inputKey: string, value: unknown, entry?: ComfyObjectInfoInput) {
    const info = readObjectInfoEntry(entry);
    const media = uploadType(entry);
    if (media) return { type: media };
    if (info?.options?.length) return { type: "dropdown" as const, options: info.options };
    if (info?.type === "BOOLEAN" || typeof value === "boolean") return { type: "boolean" as const };
    if (SEED_NAME_RULE.test(inputKey) || info?.config.control_after_generate) return { type: "number" as const, randomize: false };
    if (info?.type === "INT" || info?.type === "FLOAT") {
        const min = numberValue(info.config.min),
            max = numberValue(info.config.max),
            step = numberValue(info.config.step);
        return { type: min !== undefined && max !== undefined ? ("slider" as const) : ("number" as const), min, max, step };
    }
    if (info?.type === "STRING") return { type: info.config.multiline === true ? ("textarea" as const) : ("text" as const) };
    if (PROMPT_NAME_RULE.test(inputKey) || /^(negative|negative_prompt)$/i.test(inputKey)) return { type: "textarea" as const };
    if (typeof value === "number") return { type: "number" as const };
    return { type: "text" as const };
}

export function isMediaFieldType(type: ComfyWorkflowFieldType) {
    return type === "image" || type === "video" || type === "audio";
}

function promptOrigins(graph: Graph, fields: ComfyWorkflowField[], info: ComfyObjectInfo, link: [string, number], negative: boolean, seen = new Set<string>()): string[] {
    const [id, slot] = link;
    const token = `${id}:${slot}:${negative}`;
    if (seen.has(token) || !graph[id]) return [];
    seen.add(token);
    const nodeInfo = info[graph[id].class_type];
    const output = nodeInfo?.output_name?.[slot]?.toLowerCase();
    const isNegative = output === "negative" || negative;
    const localText = fields.filter((f) => f.nodeId === id && (f.type === "text" || f.type === "textarea"));
    const negativeText = localText.filter((f) => /^(negative|negative_prompt)$/i.test(f.inputKey));
    const positiveText = localText.filter((f) => /^(text|prompt|positive|value)$/i.test(f.inputKey));
    const direct = isNegative && negativeText.length ? negativeText : positiveText;
    if (direct.length) return direct.map((f) => f.id);
    return Object.entries(graph[id].inputs).flatMap(([key, value]) => {
        if (!isLinkInput(value)) return [];
        const type = readObjectInfoEntry(inputDefinition(nodeInfo, key)?.entry)?.type;
        if (!/^(text|prompt|conditioning|positive|negative|negative_prompt|value)$/i.test(key) && type !== "STRING" && type !== "CONDITIONING") return [];
        if (!isNegative && /negative/i.test(key)) return [];
        return promptOrigins(graph, fields, info, value, isNegative || /negative/i.test(key), seen);
    });
}

/** Existing explicit choices win. Inference never picks the first of multiple candidates. */
export function assignPresetRoles(fields: ComfyWorkflowField[]): ComfyWorkflowField[] {
    const roles: Array<[ComfyPresetRole, (f: ComfyWorkflowField) => boolean]> = [
        ["prompt", (f) => (f.type === "text" || f.type === "textarea") && PROMPT_NAME_RULE.test(f.inputKey)],
        ["seed", (f) => (f.type === "number" || f.type === "slider") && SEED_NAME_RULE.test(f.inputKey)],
        ["strength", (f) => /^(strength|denoise)$/i.test(f.inputKey)],
        ["width", (f) => /^width$/i.test(f.inputKey)],
        ["height", (f) => /^height$/i.test(f.inputKey)],
    ];
    const result = fields.map((f) => ({ ...f }));
    for (const [role, matches] of roles) {
        if (result.some((f) => f.presetRole === role)) continue;
        const candidates = result.filter((f) => !f.presetRole && matches(f));
        if (candidates.length === 1) Object.assign(candidates[0], { presetRole: role, enabled: true });
    }
    for (const field of result) if (field.type === "image" && !field.presetRole) Object.assign(field, { presetRole: "image", enabled: true });
    for (const field of result) if (field.type === "audio" || field.type === "video") field.enabled = true;
    return result;
}

export function analyzeWorkflow(graph: Graph, objectInfo?: ComfyObjectInfo, existing?: Pick<ComfyWorkflow, "fields" | "nodeInfo" | "referenceGroups" | "outputKinds" | "outputNodeIds">) {
    const info = workflowNodeInfo(graph, { ...existing?.nodeInfo, ...objectInfo });
    const diagnostics: ComfyWorkflowDiagnostic[] = [];
    let fields: ComfyWorkflowField[] = [];
    for (const [nodeId, node] of Object.entries(graph)) {
        const nodeInfo = info[node.class_type];
        if (objectInfo && !objectInfo[node.class_type]) diagnostics.push({ code: "missing-node", severity: "error", nodeId, message: `节点 #${nodeId}（${node.class_type}）在当前 ComfyUI 中不存在` });
        for (const [inputKey, value] of Object.entries(node.inputs)) {
            if (isLinkInput(value)) continue;
            const entry = inputDefinition(nodeInfo, inputKey)?.entry;
            const shape = inferFieldShape(inputKey, value, entry);
            const media = fieldMediaType(node, inputKey, nodeInfo);
            if (media) shape.type = media;
            const config = readObjectInfoEntry(entry)?.config;
            fields.push({
                id: `${nodeId}:${inputKey}`,
                nodeId,
                inputKey,
                nodeTitle: node._meta?.title || nodeInfo?.display_name || node.class_type,
                label: inputKey,
                enabled: Boolean(entry && !config?.advanced && !config?.forceInput && (value === null || typeof value !== "object")),
                order: fields.length,
                defaultValue: structuredClone(value),
                ...shape,
            });
        }
    }
    const positive = new Set(fields.filter((f) => PROMPT_NAME_RULE.test(f.inputKey)).map((f) => f.id));
    const negative = new Set(fields.filter((f) => /^(negative|negative_prompt)$/i.test(f.inputKey)).map((f) => f.id));
    for (const node of Object.values(graph))
        for (const [key, link] of Object.entries(node.inputs)) {
            if (!isLinkInput(link) || !/^(prompt|positive|negative|negative_prompt|conditioning)$/i.test(key)) continue;
            const target = /negative/i.test(key) ? negative : positive;
            for (const id of promptOrigins(graph, fields, info, link, target === negative)) target.add(id);
        }
    const prompts = fields.filter((f) => positive.has(f.id) && !negative.has(f.id) && (f.type === "text" || f.type === "textarea"));
    for (const field of fields) if (negative.has(field.id)) Object.assign(field, { enabled: true, type: "textarea", label: "负向提示词" });
    if (prompts.length === 1) Object.assign(prompts[0], { presetRole: "prompt", enabled: true, type: "textarea", label: "提示词" });
    // Use the complete candidate set rather than assigning another text field after a graph-level ambiguity.
    const seeds = fields.filter((f) => SEED_NAME_RULE.test(f.inputKey) || readObjectInfoEntry(inputDefinition(info[graph[f.nodeId].class_type], f.inputKey)?.entry)?.config.control_after_generate);
    if (seeds.length === 1) Object.assign(seeds[0], { presetRole: "seed", enabled: true });
    fields = assignPresetRoles(fields);
    if (prompts.length !== 1) for (const field of fields) if (field.presetRole === "prompt") delete field.presetRole;
    const inferred = new Map(fields.map((f) => [f.id, f]));
    if (existing) {
        fields = existing.fields.map((saved) => {
            const fresh = inferred.get(saved.id);
            if (!fresh) return { ...saved };
            return { ...fresh, ...saved, ...(fresh.options ? { options: fresh.options } : {}), ...(saved.typeManuallySet ? {} : { type: fresh.type }), min: saved.min ?? fresh.min, max: saved.max ?? fresh.max, step: saved.step ?? fresh.step };
        });
        // Previously configured media inputs stay media without a live definition.
        fields = fields.map((f) => {
            const saved = existing.fields.find((s) => s.id === f.id)!;
            return (!objectInfo && !existing.nodeInfo) || (!inputDefinition(info[graph[f.nodeId]?.class_type], f.inputKey) && isMediaFieldType(saved.type)) ? { ...f, type: saved.type } : f;
        });
        for (const field of inferred.values()) if (!existing.fields.some((f) => f.id === field.id)) fields.push({ ...field, order: fields.length });
    }
    const configured = existing?.referenceGroups ?? configuredReferenceGroups(existing?.fields || []);
    const discovered = discoverReferenceGroups(graph, fields, info).filter(
        (group) =>
            !group.bindings.some((binding) => configured.some((old) => old.nodeId === group.nodeId && old.bindings.some((b) => b.inputKey === binding.inputKey))) &&
            !group.bindings.some((binding) => binding.fieldIds.some((id) => existing?.fields.some((f) => f.id === id && isMediaFieldType(f.type) && !f.referenceInput))),
    );
    const referenceGroups = [...configured, ...discovered];
    for (const group of referenceGroups)
        for (const binding of group.bindings)
            for (const id of binding.fieldIds) {
                const field = fields.find((f) => f.id === id);
                if (field && !field.referenceInput) field.referenceInput = { nodeId: group.nodeId, inputKey: binding.inputKey, optional: group.min === 0, startIndex: group.startIndex };
            }
    if (!fields.some((f) => f.presetRole === "prompt") && prompts.length > 1) diagnostics.push({ code: "ambiguous-prompt", severity: "warning", message: "有多个提示词候选，请在字段配置中指定主提示词；原始文本保持不变" });
    if (!fields.some((f) => f.presetRole === "seed") && fields.filter((f) => SEED_NAME_RULE.test(f.inputKey)).length > 1)
        diagnostics.push({ code: "ambiguous-seed", severity: "warning", message: "有多个种子字段，请在字段配置中指定主种子；原始种子保持不变" });
    if (!existing?.outputKinds && !workflowOutputKinds({ workflow: graph, nodeInfo: info, outputNodeIds: existing?.outputNodeIds }).length)
        diagnostics.push({ code: "unknown-output", severity: "warning", message: "无法唯一识别输出类型，请选择输出类型或输出节点" });
    const result = { fields, nodeInfo: info, referenceGroups, diagnostics };
    diagnostics.push(...validateRunGraph(graph, info));
    return result;
}

export function createWorkflowFields(graph: Graph, objectInfo?: ComfyObjectInfo) {
    return analyzeWorkflow(graph, objectInfo).fields;
}
export function refreshWorkflowFields(workflow: ComfyWorkflow, objectInfo: ComfyObjectInfo) {
    return analyzeWorkflow(workflow.workflow, objectInfo, workflow).fields;
}

export function hasRoleConflict(fields: ComfyWorkflowField[], fieldId: string, role: ComfyPresetRole) {
    return UNIQUE_PRESET_ROLES.includes(role) && fields.some((field) => field.id !== fieldId && field.presetRole === role);
}

/** Used by both field editing and explicitly accepted enum/path suggestions. */
export function patchWorkflowField(workflow: ComfyWorkflow, id: string, patch: Partial<ComfyWorkflowField>): ComfyWorkflow {
    const next = structuredClone(workflow);
    const field = next.fields.find((f) => f.id === id);
    if (!field) return next;
    Object.assign(field, patch);
    if ("defaultValue" in patch) {
        let value = patch.defaultValue;
        if ((field.type === "number" || field.type === "slider") && value !== "" && Number.isFinite(Number(value))) value = Number(value);
        if (field.type === "boolean" && typeof value === "string") value = value === "true";
        if (field.type === "dropdown") value = field.options?.find((option) => String(option) === String(value)) ?? value;
        field.defaultValue = value;
        const node = next.workflow[field.nodeId];
        if (node && !isLinkInput(node.inputs[field.inputKey])) node.inputs[field.inputKey] = value;
    }
    return next;
}

export function validateRunGraph(graph: Graph, info: ComfyObjectInfo = {}): ComfyWorkflowDiagnostic[] {
    const issues: ComfyWorkflowDiagnostic[] = [];
    for (const [nodeId, node] of Object.entries(graph))
        for (const [inputKey, value] of Object.entries(node.inputs)) {
            const base = { nodeId, inputKey, fieldId: `${nodeId}:${inputKey}`, severity: "error" as const };
            if (isLinkInput(value)) {
                if (!graph[value[0]]) issues.push({ ...base, code: "invalid-link", message: `节点 #${nodeId} · ${inputKey}：上游节点 #${value[0]} 不存在` });
                else {
                    const source = info[graph[value[0]].class_type];
                    if (source?.output && (value[1] < 0 || !Number.isInteger(value[1]) || value[1] >= source.output.length)) issues.push({ ...base, code: "invalid-link", message: `节点 #${nodeId} · ${inputKey}：上游输出插槽 ${value[1]} 不存在` });
                    const expected = readObjectInfoEntry(inputDefinition(info[node.class_type], inputKey)?.entry)?.type;
                    const actual = source?.output?.[value[1]];
                    if (expected && actual && !expected.startsWith("COMFY_") && !actual.startsWith("COMFY_")) {
                        const targetTypes = expected.split(","),
                            sourceTypes = actual.split(",");
                        if (![...targetTypes, ...sourceTypes].some((type) => type === "*" || type === "ANY") && !targetTypes.some((type) => sourceTypes.includes(type)))
                            issues.push({ ...base, code: "invalid-link-type", message: `节点 #${nodeId} · ${inputKey}：上游类型 ${actual} 与输入类型 ${expected} 不匹配` });
                    }
                }
                continue;
            }
            const entry = inputDefinition(info[node.class_type], inputKey)?.entry;
            const definition = readObjectInfoEntry(entry);
            if (!definition || fieldMediaType(node, inputKey, info[node.class_type])) continue;
            if (definition.options?.length && !definition.options.includes(value as string | number)) {
                const basename = (v: string) => v.replace(/\\/g, "/").split("/").pop();
                const suggestions = typeof value === "string" && /\.[a-z\d]+$/i.test(value) ? definition.options.filter((option) => typeof option === "string" && basename(option) === basename(value)) : [];
                issues.push({ ...base, code: "invalid-option", suggestions, message: `节点 #${nodeId} · ${inputKey}：当前服务不接受 ${String(value)}，请从可用选项中选择` });
            }
            if (definition.type === "INT" || definition.type === "FLOAT") {
                const min = numberValue(definition.config.min),
                    max = numberValue(definition.config.max);
                if (typeof value !== "number" || !Number.isFinite(value) || (definition.type === "INT" && !Number.isInteger(value)) || (min !== undefined && value < min) || (max !== undefined && value > max))
                    issues.push({ ...base, code: "invalid-number", message: `节点 #${nodeId} · ${inputKey}：数值不符合当前节点定义` });
            }
            if (definition.type === "BOOLEAN" && typeof value !== "boolean") issues.push({ ...base, code: "invalid-boolean", message: `节点 #${nodeId} · ${inputKey}：需要布尔值` });
        }
    for (const [nodeId, node] of Object.entries(graph))
        for (const [key, entry] of Object.entries({ ...info[node.class_type]?.input?.required, ...info[node.class_type]?.input?.optional })) {
            const template = dynamicInput(entry);
            if (!template) continue;
            const count = Object.keys(node.inputs).filter((inputKey) => inputDefinition(info[node.class_type], inputKey)?.group === key).length;
            const max = template.max ?? template.names?.length;
            if (count < (template.min ?? 0) || (max !== undefined && count > max)) issues.push({ code: "invalid-reference-count", severity: "error", nodeId, inputKey: key, message: `节点 #${nodeId} · ${key}：输入数量 ${count} 不符合当前节点定义` });
        }
    return issues;
}

/** One request builder for canvas, Agent, workbench and tests. Saved graphs are never mutated. */
export function buildRunWorkflow(workflow: Graph, fields: ComfyWorkflowField[], values: Record<string, unknown>, definition: Definition = {}) {
    const run = structuredClone(workflow);
    for (const field of fields) {
        if (!field.enabled || !(field.id in values) || values[field.id] === undefined) continue;
        const node = run[field.nodeId];
        if (node && !isLinkInput(node.inputs[field.inputKey])) node.inputs[field.inputKey] = values[field.id];
    }
    applyReferenceGroups(run, workflow, fields, values, definition.referenceGroups ?? configuredReferenceGroups(fields), definition.nodeInfo, definition.outputNodeIds);
    const errors = validateRunGraph(run, definition.nodeInfo);
    if (errors.length) throw new Error(errors.map((issue) => issue.message).join("\n"));
    return run;
}

export const COMFY_OUTPUT_LABELS = { image: "图片", video: "视频", audio: "音频", text: "文本" } as const;

export function workflowOutputKinds(workflow: Pick<ComfyWorkflow, "workflow" | "nodeInfo" | "outputKinds" | "outputNodeIds">): ComfyOutputKind[] {
    if (workflow.outputKinds) return workflow.outputKinds;
    const kinds: ComfyOutputKind[] = [];
    for (const [id, node] of Object.entries(workflow.workflow)) {
        const info = workflow.nodeInfo?.[node.class_type];
        if (workflow.outputNodeIds ? !workflow.outputNodeIds.includes(id) : !info?.output_node || info.has_intermediate_output) continue;
        const formatted = Object.entries(node.inputs)
            .flatMap(([key, value]) => (typeof value === "string" && /^(format|output_format|mime|mime_type|content_type)$/i.test(key) ? [value.split("/")[0]] : []))
            .filter((v): v is ComfyOutputKind => v === "image" || v === "video" || v === "audio");
        const typed = (info?.output || []).map((type) => (type === "STRING" ? ("text" as const) : mediaType(type))).filter((v): v is ComfyOutputKind => Boolean(v));
        const inputs = Object.keys(node.inputs)
            .map((key) => mediaType(inputDefinition(info, key)?.entry[0]))
            .filter((v): v is ComfyOutputKind => Boolean(v));
        kinds.push(...(formatted.length ? formatted : typed.length ? typed : new Set(inputs).size === 1 ? inputs : []));
    }
    return [...new Set(kinds)];
}

export function randomSeed() {
    return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}
export function defaultFieldValue(field: ComfyWorkflowField) {
    if (field.type === "boolean") return field.defaultValue ?? "";
    if (field.type === "dropdown" && typeof field.defaultValue === "number") return field.defaultValue;
    if (field.type === "number" || field.type === "slider") {
        if (field.defaultValue === "" || field.defaultValue === undefined || field.defaultValue === null) return "";
        return Number.isFinite(Number(field.defaultValue)) ? Number(field.defaultValue) : field.defaultValue;
    }
    return field.defaultValue === undefined || field.defaultValue === null ? "" : String(field.defaultValue);
}
