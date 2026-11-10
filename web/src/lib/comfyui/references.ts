import type { ComfyApiNode, ComfyObjectInfo, ComfyReferenceGroup, ComfyWorkflowField } from "@/types/comfyui";
import { inputDefinition, isLinkInput, mediaType, readObjectInfoEntry } from "./definition";

type Graph = Record<string, ComfyApiNode>;

/** Saved bindings are data, including bindings from workflows imported before group metadata was stored. */
export function configuredReferenceGroups(fields: ComfyWorkflowField[]): ComfyReferenceGroup[] {
    const groups = new Map<string, ComfyReferenceGroup>();
    for (const field of [...fields].sort((a, b) => a.order - b.order)) {
        const target = field.referenceInput;
        if (!target) continue;
        const prefix = target.inputKey.replace(/\d+$/, "");
        const dynamic = prefix !== target.inputKey;
        const id = `${target.nodeId}:${dynamic ? prefix : target.inputKey}`;
        const group = groups.get(id) || { id, nodeId: target.nodeId, kind: dynamic ? "dynamic" : "fixed", min: 0, ...(dynamic ? { prefix, startIndex: target.startIndex ?? 0 } : {}), bindings: [] };
        if (!target.optional) group.min = 1;
        group.bindings.push({ inputKey: target.inputKey, fieldIds: [field.id] });
        groups.set(id, group);
    }
    return [...groups.values()];
}

function mediaSources(graph: Graph, fields: ComfyWorkflowField[], info: ComfyObjectInfo, link: [string, number], expected: string, seen = new Set<string>()): string[] {
    const [id] = link;
    if (seen.has(id) || !graph[id]) return [];
    seen.add(id);
    const candidates = fields.filter((field) => field.nodeId === id && field.type === expected);
    if (candidates.length) return candidates.map((field) => field.id);
    return [
        ...new Set(
            Object.entries(graph[id].inputs).flatMap(([key, value]) => {
                if (!isLinkInput(value)) return [];
                const entry = inputDefinition(info[graph[id].class_type], key);
                if (
                    entry &&
                    !readObjectInfoEntry(entry.entry)
                        ?.type.split(",")
                        .some((type) => type === "*" || type === "ANY" || mediaType(type) === expected)
                )
                    return [];
                return mediaSources(graph, fields, info, value, expected, seen);
            }),
        ),
    ];
}

export function discoverReferenceGroups(graph: Graph, fields: ComfyWorkflowField[], info: ComfyObjectInfo): ComfyReferenceGroup[] {
    const groups = new Map<string, ComfyReferenceGroup>();
    for (const [nodeId, node] of Object.entries(graph))
        for (const [inputKey, link] of Object.entries(node.inputs)) {
            if (!isLinkInput(link)) continue;
            const definition = inputDefinition(info[node.class_type], inputKey);
            const expected = mediaType(definition?.entry[0]);
            if (!definition || !expected || (!definition.group && definition.required)) continue;
            const ids = mediaSources(graph, fields, info, link, expected);
            if (ids.length !== 1) continue;
            const template = definition.template;
            const id = `${nodeId}:${definition.group ?? inputKey}`;
            const group: ComfyReferenceGroup = groups.get(id) || {
                id,
                nodeId,
                kind: template ? "dynamic" : "fixed",
                min: template?.min ?? 0,
                max: template ? (template.max ?? template.names?.length) : 1,
                ...(template?.prefix ? { prefix: `${definition.group}.${template.prefix}`, startIndex: 0 } : {}),
                ...(template?.names ? { names: template.names.map((name) => `${definition.group}.${name}`) } : {}),
                bindings: [],
            };
            group.bindings.push({ inputKey, fieldIds: ids });
            groups.set(id, group);
        }
    for (const group of groups.values()) {
        group.bindings.sort((a, b) => (group.names ? group.names.indexOf(a.inputKey) - group.names.indexOf(b.inputKey) : Number(a.inputKey.match(/\d+$/)?.[0] ?? 0) - Number(b.inputKey.match(/\d+$/)?.[0] ?? 0)));
    }
    return [...groups.values()];
}

/** Reindex consumer edges, never bypass an existing processing node on the branch. */
export function applyReferenceGroups(run: Graph, template: Graph, fields: ComfyWorkflowField[], values: Record<string, unknown>, groups: ComfyReferenceGroup[], info: ComfyObjectInfo = {}, outputNodeIds: string[] = []) {
    const byId = new Map(fields.map((field) => [field.id, field]));
    const removedRoots: string[] = [];
    const omittedFields = new Set<string>();
    for (const group of groups) {
        if (!run[group.nodeId]) throw new Error(`参考输入目标节点缺失：${group.nodeId}`);
        for (const binding of group.bindings) {
            const reachable = new Set<string>();
            const visit = (id: string) => {
                if (reachable.has(id) || !template[id]) return;
                reachable.add(id);
                for (const value of Object.values(template[id].inputs)) if (isLinkInput(value)) visit(value[0]);
            };
            const link = template[group.nodeId]?.inputs[binding.inputKey];
            if (isLinkInput(link)) visit(link[0]);
            for (const id of binding.fieldIds) {
                const field = byId.get(id);
                if (!field || !reachable.has(field.nodeId)) throw new Error(`参考输入绑定与原图不符：${group.nodeId} · ${binding.inputKey} · ${id}`);
            }
        }
        const active = group.bindings.filter((binding) => {
            const chosen = binding.fieldIds.filter((id) => byId.get(id)?.enabled && values[id] !== undefined && values[id] !== "");
            if (chosen.length && chosen.length !== binding.fieldIds.length) throw new Error(`参考分支输入不完整：${group.nodeId} · ${binding.inputKey}`);
            if (chosen.length) return true;
            for (const id of binding.fieldIds) omittedFields.add(id);
            const link = template[group.nodeId]?.inputs[binding.inputKey];
            if (isLinkInput(link)) removedRoots.push(link[0]);
            return false;
        });
        if (active.length < group.min) throw new Error(`参考输入 ${group.nodeId} · ${group.id}：至少选择 ${group.min} 个素材`);
        if (group.max !== undefined && active.length > group.max) throw new Error(`参考输入 ${group.nodeId} · ${group.id}：最多 ${group.max} 个素材`);
        for (const binding of group.bindings) delete run[group.nodeId].inputs[binding.inputKey];
        active.forEach((binding, index) => {
            const key = group.kind === "fixed" ? binding.inputKey : (group.names?.[index] ?? (group.prefix ? `${group.prefix}${index + (group.startIndex ?? 0)}` : undefined));
            if (!key) throw new Error(`参考输入缺少动态插槽定义：${group.id}`);
            const link = template[group.nodeId]?.inputs[binding.inputKey];
            if (!isLinkInput(link)) throw new Error(`参考输入缺少原始连线：${group.nodeId} · ${binding.inputKey}`);
            run[group.nodeId].inputs[key] = [...link];
        });
    }
    const ancestors = (roots: Iterable<string>, allowed?: Set<string>) => {
        const result = new Set<string>();
        const visit = (id: string) => {
            if (result.has(id) || !run[id] || (allowed && !allowed.has(id))) return;
            result.add(id);
            for (const value of Object.values(run[id].inputs)) if (isLinkInput(value)) visit(value[0]);
        };
        for (const root of roots) visit(root);
        return result;
    };
    const candidates = ancestors(removedRoots);
    const needed = new Set<string>();
    for (const [id, node] of Object.entries(run)) {
        if (candidates.has(id)) {
            if (info[node.class_type]?.output_node || outputNodeIds.includes(id)) needed.add(id);
            continue;
        }
        for (const value of Object.values(node.inputs)) if (isLinkInput(value) && candidates.has(value[0])) needed.add(value[0]);
    }
    const kept = ancestors(needed, candidates);
    for (const id of candidates) if (!kept.has(id)) delete run[id];
    for (const id of omittedFields) {
        const field = byId.get(id)!;
        if (run[field.nodeId]) throw new Error(`未选参考素材仍被其他节点使用：${field.label} · ${field.id}`);
    }
}
