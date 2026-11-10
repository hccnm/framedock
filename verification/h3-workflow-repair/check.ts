import '../../web/tests/browser-globals';
import { readFileSync } from 'node:fs';
import { buildRunWorkflow, isLinkInput } from '../../web/src/lib/comfyui/workflow';
import type { ComfyWorkflow } from '../../web/src/types/comfyui';

// Read-only: builds requests locally and reads model definitions; never calls /prompt.
const [stateFile, successfulWorkflowFile] = process.argv.slice(2);
if (!stateFile || !successfulWorkflowFile) throw new Error('Usage: bun check.ts <comfyui_store.json> <successful workflow.json>');
const state = JSON.parse(readFileSync(stateFile, 'utf8')).state;
const source = JSON.parse(readFileSync(successfulWorkflowFile, 'utf8'));
const workflow: ComfyWorkflow = state.workflows.find((item: ComfyWorkflow) => item.id === 'sheep_workflow_f994ec9021f61205a1820c1f');
if (!workflow) throw new Error('H3 workflow missing');
const response = await fetch(`${state.baseUrl.replace(/\/+$/, '')}/object_info/VAELoader`);
if (!response.ok) throw new Error(`VAELoader metadata: HTTP ${response.status}`);
const info = await response.json();
const available: string[] = info.VAELoader.input.required.vae_name[0];
const errors: string[] = [];
const protectedNodes = ['123', '124', '125', '126', '129', '131', '148', '151', '153', '154', '155', '157', '163', '288'];
for (const id of protectedNodes) {
    if (JSON.stringify(workflow.workflow[id].inputs) !== JSON.stringify(source[id].inputs)) errors.push(`Protected node changed: ${id}`);
}
const vaes = ['149', '150'].map((id) => {
    const name = String(workflow.workflow[id].inputs.vae_name);
    const field = workflow.fields.find((item) => item.nodeId === id && item.inputKey === 'vae_name');
    if (!available.includes(name)) errors.push(`VAELoader ${id}: Value not in list: ${name}`);
    if (field?.defaultValue !== name) errors.push(`VAELoader ${id}: field default differs from graph`);
    if (name !== source[id].inputs.vae_name) errors.push(`VAELoader ${id}: differs from successful workflow`);
    return { nodeId: id, name, available: available.includes(name), defaultMatchesGraph: field?.defaultValue === name };
});
const original = JSON.stringify(workflow);
const refs = workflow.fields.filter((field) => field.referenceInput && field.type === 'image').sort((a, b) => a.order - b.order);
for (let count = 1; count <= 6; count++) {
    const values = { '138:value': 'H3 local validation only', '132:value': 3, '115:megapixels': 0.2,
        ...Object.fromEntries(refs.slice(0, count).map((field, index) => [field.id, `validation-${index}.png`])) };
    const graph = buildRunWorkflow(workflow.workflow, workflow.fields, values);
    if (Object.keys(graph['136'].inputs).filter((key) => key.startsWith('ref_images.')).length !== count) errors.push(`Reference count mismatch: ${count}`);
    for (const node of Object.values(graph)) for (const input of Object.values(node.inputs)) {
        if (isLinkInput(input) && !graph[(input as [string, number])[0]]) errors.push(`Dangling link: ${JSON.stringify(input)}`);
    }
    if (graph['132'].inputs.value !== 3 || graph['115'].inputs.megapixels !== 0.2) errors.push('Run overrides lost');
    for (const id of ['149', '150']) if (!available.includes(String(graph[id].inputs.vae_name))) errors.push(`Run VAE ${id}: Value not in list`);
}
if (JSON.stringify(workflow) !== original) errors.push('Saved template mutated');
console.log(JSON.stringify({ pass: errors.length === 0, workflowId: workflow.id, vaes, protectedNodes, referenceCounts: [1, 2, 3, 4, 5, 6], submitted: false, errors: [...new Set(errors)] }, null, 2));
process.exitCode = errors.length ? 1 : 0;
