import './browser-globals';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildRunWorkflow } from '../src/lib/comfyui/workflow';
import type { ComfyWorkflow } from '../src/types/comfyui';

const records: ComfyWorkflow[] = JSON.parse(readFileSync(new URL('../../verification/general-image-workflows/workflows.json', import.meta.url), 'utf8'));
for (const record of records) {
    test(`${record.name}: zero, sparse and full references preserve one-based links`, () => {
        const original = structuredClone(record);
        const refs = record.fields.filter(field => field.referenceInput);
        for (const selected of [[], [refs.at(-1)!], refs]) {
            const graph = buildRunWorkflow(record.workflow, record.fields, Object.fromEntries(selected.map(field => [field.id, 'uploaded.png'])));
            const keys = Object.keys(graph['4'].inputs).filter(key => /image\d+$|images\.image_\d+$/.test(key));
            expect(keys).toHaveLength(selected.length);
            selected.forEach((field, index) => {
                const link = graph['4'].inputs[record.id === 'general-z-image' ? `image${index + 1}` : `images.image_${index + 1}`] as [string, number];
                if (record.id === 'general-z-image') {
                    expect(graph[link[0]]).toMatchObject({ class_type: 'ImageScaleToTotalPixels', inputs: { image: [field.nodeId, 0], upscale_method: 'area', megapixels: 1, resolution_steps: 16 } });
                    expect(graph['4'].inputs.auto_resize_images).toBe(false);
                } else expect(link).toEqual([field.nodeId, 0]);
            });
            expect(Object.values(graph).filter(node => node.class_type === 'ImageScaleToTotalPixels')).toHaveLength(record.id === 'general-z-image' ? selected.length : 0);
            for (const node of Object.values(graph)) for (const value of Object.values(node.inputs)) if (Array.isArray(value)) expect(graph[value[0]]).toBeDefined();
        }
        expect(record).toEqual(original);
    });
    test(`${record.name}: LoRA switches can be changed per run without changing defaults`, () => {
        const switches = record.fields.filter(field => field.inputKey === 'switch');
        expect(switches.length).toBeGreaterThan(0);
        for (const field of switches) {
            const expected = record.id === 'general-z-image' ? 'On' : 'Off';
            const override = expected === 'On' ? 'Off' : 'On';
            expect(field.defaultValue).toBe(expected);
            expect(buildRunWorkflow(record.workflow, record.fields, { [field.id]: override })[field.nodeId].inputs.switch).toBe(override);
            expect(record.workflow[field.nodeId].inputs.switch).toBe(expected);
        }
    });
}

test('Z Image uses the original text workflow LoRA defaults and exposes all three to Agent', () => {
    const record = records.find(record => record.id === 'general-z-image')!;
    const ids = ['11', '12', '9'];
    const names = ['Kook_Zimage_瑶光.safetensors', 'Kook_Zimage_如梦似幻.safetensors', 'Z-Image-Fun-Lora-Distill-8-Steps-2603-ComfyUI.safetensors'];
    ids.forEach((id, index) => {
        const inputs = record.workflow[id].inputs;
        expect(inputs).toMatchObject({ model: [index ? ids[index - 1] : '1', 0], switch: 'On', lora_name: names[index], strength_model: [0.5, 0.7, 0.45][index], strength_clip: 0 });
        for (const key of ['switch', 'lora_name', 'strength_model']) expect(record.fields.find(field => field.id === `${id}:${key}`)?.enabled).toBe(true);
        const values = { [`${id}:switch`]: 'Off', [`${id}:lora_name`]: names[(index + 1) % 3], [`${id}:strength_model`]: 0.25 };
        expect(buildRunWorkflow(record.workflow, record.fields, values)[id].inputs).toMatchObject({ switch: 'Off', lora_name: names[(index + 1) % 3], strength_model: 0.25 });
    });
    expect(record.workflow['6'].inputs.model).toEqual(['9', 0]);
});
