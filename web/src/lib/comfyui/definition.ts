import type { ComfyApiNode, ComfyObjectInfo, ComfyObjectInfoInput, ComfyObjectInfoNode, ComfyWorkflowFieldType } from "@/types/comfyui";

export function isLinkInput(value: unknown): value is [string, number] {
    return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number";
}

export function readObjectInfoEntry(entry?: ComfyObjectInfoInput) {
    if (!Array.isArray(entry) || !entry.length) return undefined;
    const [spec, raw] = entry;
    const config = raw && typeof raw === "object" ? raw : {};
    const values = Array.isArray(spec) ? spec : Array.isArray(config.options) ? config.options : undefined;
    const options = values?.map((item) => (Array.isArray(item) ? item[0] : item)).filter((item): item is string | number => typeof item === "string" || typeof item === "number");
    return { type: typeof spec === "string" ? spec.toUpperCase() : "COMBO", options, config };
}

export function mediaType(type: unknown): ComfyWorkflowFieldType | undefined {
    return typeof type === "string" ? ({ IMAGE: "image", MASK: "image", AUDIO: "audio", VIDEO: "video" } as const)[type.toUpperCase() as "IMAGE"] : undefined;
}

export function uploadType(entry?: ComfyObjectInfoInput) {
    const config = readObjectInfoEntry(entry)?.config;
    for (const type of ["image", "video", "audio"] as const) if (config?.[`${type}_upload`]) return type;
}

/** V1 nodes may expose a single file widget without an explicit upload flag. */
export function fieldMediaType(node: ComfyApiNode, key: string, info?: ComfyObjectInfoNode) {
    const direct = uploadType(inputDefinition(info, key)?.entry);
    if (direct) return direct;
    if (!info || typeof node.inputs[key] !== "string" || !/^(image|video|audio|file|filename|path)$/i.test(key)) return undefined;
    const outputs = [...new Set(info.output?.map(mediaType).filter(Boolean))];
    const widgets = Object.entries(node.inputs).filter(([name, value]) => !isLinkInput(value) && /^(image|video|audio|file|filename|path)$/i.test(name));
    return outputs.length === 1 && widgets.length === 1 ? outputs[0] : undefined;
}

type DynamicTemplate = { input?: { required?: Record<string, ComfyObjectInfoInput>; optional?: Record<string, ComfyObjectInfoInput> }; prefix?: string; names?: string[]; min?: number; max?: number };
export function dynamicInput(entry?: ComfyObjectInfoInput) {
    const info = readObjectInfoEntry(entry);
    if (info?.type !== "COMFY_AUTOGROW_V3") return undefined;
    const template = info.config.template as DynamicTemplate | undefined;
    if (!template?.input || (!template.prefix && !template.names?.length)) return undefined;
    return template;
}

/** Resolve both ordinary socket names and flattened V3 dynamic socket paths. */
export function inputDefinition(node: ComfyObjectInfoNode | undefined, key: string) {
    for (const section of ["required", "optional"] as const) {
        const entries = node?.input?.[section];
        if (entries?.[key]) return { entry: entries[key], required: section === "required" };
        for (const [group, entry] of Object.entries(entries || {})) {
            if (!key.startsWith(`${group}.`)) continue;
            const template = dynamicInput(entry);
            if (!template) continue;
            const member = key.slice(group.length + 1);
            const named = template.names?.includes(member);
            const indexed = template.prefix && member.startsWith(template.prefix) && /^\d+$/.test(member.slice(template.prefix.length));
            if (!named && !indexed) continue;
            const inputs = { ...template.input?.required, ...template.input?.optional };
            const values = Object.values(inputs);
            // Multi-socket dynamic elements require an explicit configuration, not a guessed binding.
            if (values.length !== 1) return undefined;
            return { entry: values[0], required: false, group, template };
        }
    }
}

/** Store only definitions used by this graph; uploaded file inventories are not configuration. */
export function workflowNodeInfo(graph: Record<string, ComfyApiNode>, info: ComfyObjectInfo): ComfyObjectInfo {
    return Object.fromEntries(
        [...new Set(Object.values(graph).map((node) => node.class_type))]
            .filter((type) => info[type])
            .map((type) => {
                const source = info[type];
                const node: ComfyObjectInfoNode = structuredClone({
                    input: source.input,
                    input_order: source.input_order,
                    output: source.output,
                    output_name: source.output_name,
                    output_is_list: source.output_is_list,
                    output_node: source.output_node,
                    has_intermediate_output: source.has_intermediate_output,
                    display_name: source.display_name,
                });
                for (const entries of Object.values(node.input || {}))
                    for (const [key, entry] of Object.entries(entries)) {
                        if (!uploadType(entry)) continue;
                        const parsed = readObjectInfoEntry(entry)!;
                        const { options: _options, ...config } = parsed.config;
                        entries[key] = ["COMBO", config];
                    }
                return [type, node];
            }),
    );
}

export function numberValue(value: unknown) {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
