import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { defaultFieldValue, isMediaFieldType } from "@/lib/comfyui/workflow";
import type { ComfyWorkflowField } from "@/types/comfyui";

/** A media value a run can resolve into bytes, either from canvas storage or from a picked file. */
export type ComfyMediaValue = {
    name: string;
    storageKey?: string;
    url?: string;
    blob?: Blob;
};

export type ComfyFieldMapping = {
    field: ComfyWorkflowField;
    source: "upstream" | "node" | "missing";
    /** Effective value for non-media fields. */
    value?: unknown;
    /** Resolved media for media fields. */
    media?: ComfyMediaValue;
    /** Upstream resources feeding this field, shown in the mapping preview. */
    resources: CanvasResourceReference[];
};

export type ComfyMappingInput = {
    fields: ComfyWorkflowField[];
    upstream: Record<string, CanvasResourceReference[]>;
    /** Saved node values, keyed by field ID. */
    values: Record<string, unknown>;
    /** Media picked in the workflow test area, keyed by field ID. */
    media?: Record<string, ComfyMediaValue>;
};

/**
 * Maps upstream resources onto enabled fields.
 * Connections explicitly name their workflow field; field order only controls presentation.
 */
export function buildComfyMapping({ fields, upstream, values, media = {} }: ComfyMappingInput): ComfyFieldMapping[] {
    const enabled = fields.filter((field) => field.enabled).sort((left, right) => left.order - right.order);
    return enabled.map((field) => {
        const resources = upstream[field.id] || [];
        if (isMediaFieldType(field.type)) {
            const reference = resources[0];
            if (reference) {
                return { field, source: "upstream", media: mediaFromReference(reference), resources: [reference] };
            }
            const picked = media[field.id];
            if (picked) return { field, source: "node", media: picked, resources: [] };
            return { field, source: "missing", resources: [] };
        }

        if (field.type === "text" || field.type === "textarea") {
            const text = resources
                .map((reference) => reference.text || "")
                .filter(Boolean)
                .join("\n\n");
            if (text) return { field, source: "upstream", value: text, resources };
        }

        const value = coerceFieldValue(field, field.id in values ? values[field.id] : defaultFieldValue(field));
        return { field, source: "node", value, resources: [] };
    });
}

/** Media fields with nothing to send block the run and are reported by name. */
export function missingComfyFields(mapping: ComfyFieldMapping[]) {
    return mapping.filter((item) => item.source === "missing" && !item.field.referenceInput);
}

export function comfyMappingValue(mapping: ComfyFieldMapping) {
    return mapping.value;
}

export function coerceFieldValue(field: ComfyWorkflowField, raw: unknown): unknown {
    if (raw === undefined || raw === null || raw === "") return undefined;
    if (field.type === "boolean") return typeof raw === "boolean" ? raw : undefined;
    if (field.type === "number" || field.type === "slider") {
        const value = Number(raw);
        return Number.isFinite(value) ? value : undefined;
    }
    if (field.type === "dropdown" && field.options?.length) {
        // Keep the literal's original type so ComfyUI still matches its enum.
        return field.options.find((option) => String(option) === String(raw)) ?? raw;
    }
    return String(raw);
}

function mediaFromReference(reference: CanvasResourceReference): ComfyMediaValue {
    return { name: reference.title || reference.label, storageKey: reference.storageKey, url: reference.previewUrl };
}
