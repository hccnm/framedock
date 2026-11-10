import '../web/tests/browser-globals';
import fs from 'node:fs/promises';
import { buildRunWorkflow } from '../web/src/lib/comfyui/workflow';
import type { ComfyWorkflow } from '../web/src/types/comfyui';

const base = 'http://192.168.11.2:8188';
const directory = new URL('../verification/general-image-workflows/', import.meta.url);
const records: ComfyWorkflow[] = JSON.parse(await fs.readFile(new URL('workflows.json', directory), 'utf8'));
const report = [];
const request = async (url: string, init?: RequestInit) => {
    const response = await fetch(base + url, init);
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body;
};
const references = [];
for (const filename of ['reference-red.png', 'reference-blue.png', 'reference-green.png']) {
    const bytes = await fs.readFile(new URL(filename, directory));
    const form = new FormData();
    form.append('image', new Blob([bytes], { type: 'image/png' }), filename);
    form.append('type', 'input'); form.append('overwrite', 'false');
    const saved = await request('/upload/image', { method: 'POST', body: form });
    references.push(saved.subfolder ? `${saved.subfolder}/${saved.name}` : saved.name);
}
const loraOnly = process.argv.includes('--lora-only');
for (const record of records.filter(record => !loraOnly || record.id === 'general-z-image')) for (const multi of loraOnly ? [false] : [false, true]) {
    const tag = `${record.id}-${loraOnly ? 'lora-on' : multi ? 'references' : 'text'}`;
    const fields = record.fields.filter(f => f.referenceInput);
    const values: Record<string, unknown> = multi ? Object.fromEntries(fields.slice(0, 3).map((f, i) => [f.id, references[i]])) : {};
    values['4:prompt'] = multi ? 'Combine the red ceramic mug from the first reference, the blue teapot from the second reference, and the green potted plant from the third reference on one wooden table. Keep their colors and shapes. A single product photograph, soft daylight, realistic materials, no panels, no text.' : 'A red ceramic mug and a blue teapot beside a small green potted plant on a wooden table, soft daylight, product photography, realistic materials, no text.';
    values['5:width'] = 768; values['5:height'] = 768;
    values['6:seed'] = 42;
    if (loraOnly) values['11:switch'] = 'On';
    const graph = buildRunWorkflow(record.workflow, record.fields, values);
    await fs.writeFile(new URL(`${tag}-submitted.json`, directory), JSON.stringify(graph, null, 2));
    try {
        const receipt = await request('/prompt', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'framedock-general-verification' }) });
        console.log('QUEUED', tag, receipt.prompt_id);
        let item;
        while (!item) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            const history = await request(`/history/${receipt.prompt_id}`);
            item = history[receipt.prompt_id];
        }
        await fs.writeFile(new URL(`${tag}-history.json`, directory), JSON.stringify(item, null, 2));
        const output = item.outputs?.['10']?.images?.[0];
        if (item.status?.status_str !== 'success' || !output) throw new Error(JSON.stringify(item.status));
        const image = await fetch(`${base}/view?${new URLSearchParams(output)}`);
        await fs.writeFile(new URL(`${tag}.png`, directory), Buffer.from(await image.arrayBuffer()));
        report.push({ tag, success: true, promptId: receipt.prompt_id, output });
        console.log('SUCCESS', tag);
    } catch (error) {
        report.push({ tag, success: false, error: String(error) });
        console.log('FAILED', tag, String(error).slice(0, 1800));
    }
    await fs.writeFile(new URL(loraOnly ? 'lora-results.json' : 'generation-results.json', directory), JSON.stringify(report, null, 2));
}
