import "./browser-globals";
import { describe, expect, test } from "bun:test";
import { runComfyTest } from "../src/lib/comfyui/test-run";
import { useConfigStore } from "../src/stores/use-config-store";
import { readFileSync, readdirSync } from "node:fs";
import nodeInfo from "./fixtures/comfy-node-info.json";
import { createWorkflowFields, buildRunWorkflow, workflowOutputKinds } from "../src/lib/comfyui/workflow";
import { prepareWorkbenchRun, workbenchPromptField } from "../src/lib/comfyui/workbench";
import type { ComfyWorkflow } from "../src/types/comfyui";

const templates: ComfyWorkflow[] = JSON.parse(readFileSync(new URL("../../verification/workflow-parameters/author-workflows.json", import.meta.url), "utf8"));

describe("saved workflow profiles", () => {
    for (const source of templates) {
        test(`${source.name}: correct prompt, settings and immutable graph`, () => {
            const expectedPrompt = source.workflow["248"] ? "248:text" : source.workflow["277"] ? "277:text" : source.workflow["138"] ? "138:value" : "214:prompt";
            expect(workbenchPromptField(source.fields)?.id).toBe(expectedPrompt);
            const configured = structuredClone(source);
            expect(configured.workflow).toEqual(source.workflow);
            expect(configured.fields.map((field) => field.defaultValue)).toEqual(source.fields.map((field) => field.defaultValue));
            const prompt = workbenchPromptField(configured.fields)!;
            expect(prompt.id).toBe(expectedPrompt);
            const seed = configured.fields.find((field) => field.presetRole === "seed")!;
            expect(seed.nodeId).not.toBe("231");
            const original = structuredClone(configured);
            const mediaValues = Object.fromEntries(configured.fields.filter((field) => field.referenceInput).map((field) => [field.id, "uploaded.png"]));
            const prepared = prepareWorkbenchRun(configured, { ...mediaValues, [seed.id]: 123 }, { [seed.id]: false }, prompt.id, "新的正向提示词");
            const payload = buildRunWorkflow(prepared.workflow.workflow, prepared.workflow.fields, { ...prepared.values, ...mediaValues });
            expect(payload[prompt.nodeId].inputs[prompt.inputKey]).toBe("新的正向提示词");
            expect(payload[seed.nodeId].inputs[seed.inputKey]).toBe(123);
            expect(prepared.workflow.fields.find((field) => field.id === seed.id)?.randomize).toBe(false);
            expect(configured).toEqual(original);
            for (const field of configured.fields.filter((field) => field.label === "负向提示词")) expect(payload[field.nodeId].inputs[field.inputKey]).toEqual(source.workflow[field.nodeId].inputs[field.inputKey]);
            for (const [id, node] of Object.entries(source.workflow)) for (const [key, value] of Object.entries(node.inputs)) if (Array.isArray(value)) expect(payload[id].inputs[key]).toEqual(value);
            if (source.workflow["138"]) {
                const images = configured.fields.filter((field) => field.presetRole === "image").sort((a, b) => a.order - b.order);
                expect(images.map((field) => field.nodeId)).toEqual(source.workflow["161"] ? ["137", "139", "146", "159", "160", "161"] : ["137", "139"]);
                expect(configured.fields.find((field) => field.id === "156:frame_rate")?.enabled).toBe(false);
            }
        });
    }

    test("saved workflow aliases remain data and are never automatically merged", () => {
        const video = templates.find((workflow) => workflow.workflow["136"]);
        expect(video?.aliasIds?.length).toBeGreaterThan(0);
        expect(templates).toHaveLength(5);
    });

    test("classifies outputs by output nodes and permits explicit custom types", () => {
        for (const source of templates) {
            const expected = source.workflow["138"] ? ["video"] : ["image"];
            expect(workflowOutputKinds(source)).toEqual(expected);
            expect(structuredClone(source).outputKinds).toEqual(expected);
        }
        expect(workflowOutputKinds({ ...templates[0], outputKinds: ["audio", "text"] })).toEqual(["audio", "text"]);
        expect(workflowOutputKinds({ ...templates[0], outputKinds: [] })).toEqual([]);
        expect(templates.map((w) => structuredClone(w)).every((workflow) => workflow.name.includes("-") && !workflow.name.includes("（"))).toBe(true);
    });

    test("builds one to six H3 references without orphan links or template mutation", () => {
        const source = templates.find((workflow) => workflow.workflow["161"])!;
        const workflow = structuredClone(source);
        const refs = workflow.fields.filter((field) => field.referenceInput).sort((a, b) => a.order - b.order);
        for (let count = 1; count <= 6; count++) {
            const values = Object.fromEntries(refs.slice(0, count).map((field, index) => [field.id, `uploaded-${index}.png`]));
            const graph = buildRunWorkflow(workflow.workflow, workflow.fields, values);
            expect(Object.keys(graph["136"].inputs).filter((key) => key.startsWith("ref_images."))).toHaveLength(count);
            refs.forEach((field, index) => expect(Boolean(graph[field.nodeId])).toBe(index < count));
            for (const node of Object.values(graph)) for (const value of Object.values(node.inputs)) if (Array.isArray(value) && typeof value[0] === "string") expect(graph[value[0]]).toBeDefined();
            expect(workflow.workflow).toEqual(source.workflow);
        }
        const disabled = workflow.fields.map((field) => (field.id === refs[0].id ? { ...field, enabled: false } : field));
        const withoutDisabled = buildRunWorkflow(workflow.workflow, disabled, { [refs[0].id]: "stale.png", [refs[1].id]: "selected.png" });
        expect(withoutDisabled[refs[0].nodeId]).toBeUndefined();
        expect(withoutDisabled["136"].inputs["ref_images.ref_image_0"]).toEqual([refs[1].nodeId, 0]);
        const sparse = buildRunWorkflow(workflow.workflow, workflow.fields, { [refs[3].id]: "only.png" });
        expect(sparse["136"].inputs["ref_images.ref_image_0"]).toEqual([refs[3].nodeId, 0]);
        expect(() => buildRunWorkflow(workflow.workflow, workflow.fields, {})).toThrow("至少选择 1");
    });

    test("three-view prompt starts from the author text and permits edits without changing the template", () => {
        const workflow = structuredClone(templates.find((item) => item.workflow["206"])!);
        const prompt = workbenchPromptField(workflow.fields)!;
        const original = String(prompt.defaultValue);
        const edited = prepareWorkbenchRun(workflow, {}, {}, prompt.id, "用户修改的提示词");
        expect(buildRunWorkflow(edited.workflow.workflow, edited.workflow.fields, edited.values)[prompt.nodeId].inputs[prompt.inputKey]).toBe("用户修改的提示词");
        const reset = prepareWorkbenchRun(workflow, {}, {}, prompt.id, original);
        expect(buildRunWorkflow(reset.workflow.workflow, reset.workflow.fields, reset.values)[prompt.nodeId].inputs[prompt.inputKey]).toBe(original);
        expect(workflow.workflow[prompt.nodeId].inputs[prompt.inputKey]).toBe(original);
    });

    test("submission keeps a fixed seed and sends an intentionally empty negative prompt", async () => {
        const originalFetch = globalThis.fetch;
        const config = useConfigStore.getState().config;
        const workflow = structuredClone(templates.find((item) => item.workflow["248"] && !item.workflow["231"])!);
        const prompt = workbenchPromptField(workflow.fields)!;
        const seed = workflow.fields.find((field) => field.presetRole === "seed")!;
        const negative = workflow.fields.find((field) => field.label === "负向提示词")!;
        let submitted: Record<string, { inputs: Record<string, unknown> }> | undefined;
        useConfigStore.setState({ config: { ...config, proxyEnabled: false } });
        globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
            if (String(input).endsWith("/prompt")) {
                submitted = JSON.parse(String(init?.body)).prompt;
                return Response.json({ prompt_id: "test" });
            }
            if (String(input).endsWith("/history/test")) return Response.json({ test: { outputs: { result: { text: ["完成"] } }, status: { status_str: "success", completed: true } } });
            throw new Error(`Unexpected request: ${input}`);
        }) as typeof fetch;
        try {
            const prepared = prepareWorkbenchRun(workflow, { [seed.id]: 321, [negative.id]: "" }, { [seed.id]: false }, prompt.id, "正向描述");
            await runComfyTest({ baseUrl: "http://localhost:8188", ...prepared, media: {}, signal: new AbortController().signal, onProgress: () => {} });
            expect(submitted![seed.nodeId].inputs[seed.inputKey]).toBe(321);
            expect(submitted![negative.nodeId].inputs[negative.inputKey]).toBe("");
            const randomized = prepareWorkbenchRun(workflow, { [seed.id]: "" }, { [seed.id]: true }, prompt.id, "正向描述");
            await runComfyTest({ baseUrl: "http://localhost:8188", ...randomized, media: {}, signal: new AbortController().signal, onProgress: () => {} });
            expect(Number.isSafeInteger(submitted![seed.nodeId].inputs[seed.inputKey])).toBe(true);
        } finally {
            globalThis.fetch = originalFetch;
            useConfigStore.setState({ config });
        }
    });

    test("stale prompt selection falls back to the configured positive field", () => {
        const workflow = structuredClone(templates[0]);
        expect(workbenchPromptField(workflow.fields, "deleted:text")?.presetRole).toBe("prompt");
    });

    test("cleared or invalid fixed numeric values are rejected, random values remain optional", () => {
        const workflow = structuredClone(templates[0]);
        const seed = workflow.fields.find((field) => field.presetRole === "seed")!;
        expect(() => prepareWorkbenchRun(workflow, { [seed.id]: "" }, { [seed.id]: false }, "", "")).toThrow("有效参数");
        expect(() => prepareWorkbenchRun(workflow, { [seed.id]: "bad" }, { [seed.id]: false }, "", "")).toThrow("有效参数");
        expect(() => prepareWorkbenchRun(workflow, { [seed.id]: "" }, { [seed.id]: true }, "", "")).not.toThrow();
    });
});
