import '../../web/tests/browser-globals';
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { analyzeWorkflow, buildRunWorkflow, isMediaFieldType } from '../../web/src/lib/comfyui/workflow';
import type { ComfyWorkflow } from '../../web/src/types/comfyui';

const [mode, stateFile, baselineFile, definitionFile] = process.argv.slice(2);
const state = JSON.parse(readFileSync(stateFile, 'utf8')).state;
if (definitionFile) { const info=JSON.parse(readFileSync(definitionFile,'utf8')); state.workflows=state.workflows.map((w:ComfyWorkflow)=>({...w,...analyzeWorkflow(w.workflow,info,w)})); }
const cases = state.workflows.flatMap((workflow: ComfyWorkflow) => {
    const images = workflow.fields.filter(f => f.enabled && f.type === 'image').sort((a,b) => a.order-b.order);
    const audios = workflow.fields.filter(f => f.enabled && f.type === 'audio').sort((a,b) => a.order-b.order);
    const variants = Array.from({length: images.length + 1}, (_, count) => images.slice(0,count));
    if (images.length > 1) variants.push(images.slice(-1));
    return variants.flatMap((selected, index) => [[], audios].map(voices => {
        const values = Object.fromEntries([...selected, ...voices].map(f => [f.id, `validation-${f.order}.${f.type === 'audio' ? 'wav' : 'png'}`]));
        for (const f of workflow.fields.filter(f => f.enabled && !isMediaFieldType(f.type))) values[f.id] = f.defaultValue as string;
        try { if (workflow.executionBlockedReason) throw new Error(workflow.executionBlockedReason); return { workflowId: workflow.id, index, voices: voices.length, graph: buildRunWorkflow(workflow.workflow, workflow.fields, values, workflow) }; }
        catch { return { workflowId: workflow.id, index, voices: voices.length, rejected: true }; }
    }));
});
if (mode === '--capture') { writeFileSync(baselineFile, JSON.stringify(cases), {mode:0o600}); console.log(`Captured ${cases.length} local request cases, no submissions`); }
else {
    const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
    const failures = cases.filter((item: unknown, index: number) => !isDeepStrictEqual(item, baseline[index]));
    console.log(JSON.stringify({workflows: state.workflows.length, cases: cases.length, mismatches: failures.map((x: {workflowId:string,index:number,voices:number}) => ({workflowId:x.workflowId,index:x.index,voices:x.voices})), submitted:false}, null, 2));
    process.exitCode = failures.length || cases.length !== baseline.length ? 1 : 0;
}
