/** A single node of a ComfyUI API Format workflow. Link inputs are two-element `[nodeId, slot]` arrays. */
export type ComfyApiNode = {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: { title?: string };
};

export type ComfyWorkflowFieldType = "text" | "textarea" | "number" | "slider" | "dropdown" | "boolean" | "image" | "video" | "audio";

export type ComfyPresetRole = "prompt" | "image" | "strength" | "width" | "height" | "seed";

/** One configurable literal input exposed to the canvas node and the workflow test area. */
export type ComfyWorkflowField = {
    id: string;
    nodeId: string;
    inputKey: string;
    nodeTitle: string;
    label: string;
    type: ComfyWorkflowFieldType;
    typeManuallySet?: boolean;
    enabled: boolean;
    order: number;
    defaultValue?: unknown;
    options?: Array<string | number>;
    min?: number;
    max?: number;
    step?: number;
    randomize?: boolean;
    presetRole?: ComfyPresetRole;
    referenceInput?: { nodeId: string; inputKey: string; optional?: boolean; startIndex?: number };
};

export type ComfyWorkflow = {
    id: string;
    name: string;
    description: string;
    /** Draft-only workflows cannot upload inputs or start a generation. */
    executionBlockedReason?: string;
    outputKinds?: ComfyOutputKind[];
    aliasIds?: string[];
    nodeInfo?: ComfyObjectInfo;
    referenceGroups?: ComfyReferenceGroup[];
    outputNodeIds?: string[];
    diagnostics?: ComfyWorkflowDiagnostic[];
    /** Immutable template; every run starts from a deep copy. */
    workflow: Record<string, ComfyApiNode>;
    fields: ComfyWorkflowField[];
    createdAt: string;
    updatedAt: string;
};

export type ComfyPresetRoles = {
    text: string;
    enhance: string;
    edit: string;
};

export type ComfyRunStatus = "idle" | "uploading" | "queued" | "running" | "processing" | "success" | "error";

export type ComfyNodeMetadata = {
    comfyMode?: ComfyMode;
    comfyWorkflowId?: string;
    comfyValues?: Record<string, unknown>;
    comfyRandomEnabled?: Record<string, boolean>;
    comfyRunStatus?: ComfyRunStatus;
    comfyPromptId?: string;
    comfyError?: string;
    comfyOutputNodeIds?: string[];
};

export type ComfyMode = "text" | "enhance" | "edit" | "custom";

export type ComfyOutputFile = {
    filename: string;
    subfolder?: string;
    type?: "input" | "output" | "temp";
};

export type ComfyOutputKind = "image" | "video" | "audio" | "text";

/** One classified history output, ready to be downloaded and persisted locally. */
export type ComfyOutput = {
    kind: ComfyOutputKind | "file";
    /** Output node ID that produced it, used for deduplication and debug-node filtering. */
    nodeId: string;
    classType: string;
    file?: ComfyOutputFile;
    text?: string;
};

/** Raw `/object_info` response, keyed by `class_type`. */
export type ComfyObjectInfo = Record<string, ComfyObjectInfoNode>;

export type ComfyObjectInfoNode = {
    input?: {
        required?: Record<string, ComfyObjectInfoInput>;
        optional?: Record<string, ComfyObjectInfoInput>;
        hidden?: Record<string, ComfyObjectInfoInput>;
    };
    input_order?: { required?: string[]; optional?: string[] };
    output?: string[];
    output_name?: string[];
    output_is_list?: boolean[];
    output_node?: boolean;
    has_intermediate_output?: boolean;
    display_name?: string | null;
};

/** Describes actual graph edges, including any processing between an upload and its consumer. */
export type ComfyReferenceGroup = {
    id: string;
    nodeId: string;
    kind: "dynamic" | "fixed";
    min: number;
    max?: number;
    prefix?: string;
    names?: string[];
    startIndex?: number;
    bindings: Array<{ inputKey: string; fieldIds: string[] }>;
};

export type ComfyWorkflowDiagnostic = {
    code: string;
    severity: "warning" | "error";
    message: string;
    nodeId?: string;
    inputKey?: string;
    fieldId?: string;
    suggestions?: Array<string | number>;
};

export type ComfyObjectInfoInput = [unknown, Record<string, unknown>?];

export type ComfySystemStats = {
    system?: { comfyui_version?: string; os?: string };
    devices?: Array<{ name?: string; type?: string; vram_total?: number; vram_free?: number }>;
};
