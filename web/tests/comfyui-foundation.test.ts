import "./browser-globals";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { analyzeWorkflow, buildRunWorkflow, patchWorkflowField, workflowOutputKinds } from "../src/lib/comfyui/workflow";
import { preflightComfyRun } from "../src/lib/comfyui/prepare";
import { workbenchPromptField } from "../src/lib/comfyui/workbench";
import { collectComfyOutputs, refineOutputKind } from "../src/lib/comfyui/output";
import type { ComfyApiNode, ComfyObjectInfo, ComfyWorkflow } from "../src/types/comfyui";
import realInfo from "./fixtures/comfy-node-info.json";

const info: ComfyObjectInfo = {
    FileWidget: { input: { required: { file: [["old.png"], { image_upload: true }] } }, output: ["IMAGE"] },
    VoiceWidget: { input: { required: { recording: ["COMBO", { options: ["old.wav"], audio_upload: true }] } }, output: ["AUDIO"] },
    Words: { input: { required: { value: ["STRING", { multiline: true }] } }, output: ["STRING"] },
    Process: { input: { required: { picture: ["IMAGE"], amount: ["INT", { min: 1, max: 10 }] } }, output: ["STRING", "IMAGE"] },
    Anything: {
        input: {
            required: { prompt: ["STRING", { multiline: true }], seed: ["INT", { control_after_generate: true }], steps: ["INT", { min: 1, max: 100 }] },
            optional: {
                bank: ["COMFY_AUTOGROW_V3", { template: { input: { required: { picture: ["IMAGE"] } }, prefix: "item_", min: 0, max: 3 } }],
                voices: ["COMFY_AUTOGROW_V3", { template: { input: { required: { voice: ["AUDIO"] } }, names: ["a", "b"], min: 0 } }],
            },
        },
        output: ["IMAGE"],
    },
    Sink: { input: { required: { frames: ["IMAGE"], format: [["video/mp4", "image/png"]] } }, output: ["CUSTOM_FILES"], output_node: true },
};
const graph: Record<string, ComfyApiNode> = {
    text: { class_type: "Words", inputs: { value: "original prompt" } },
    first: { class_type: "FileWidget", inputs: { file: "old.png" } },
    second: { class_type: "FileWidget", inputs: { file: "old.png" } },
    resize: { class_type: "Process", inputs: { picture: ["second", 0], amount: 2 } },
    audio: { class_type: "VoiceWidget", inputs: { recording: "old.wav" } },
    gen: { class_type: "Anything", inputs: { prompt: ["text", 0], seed: 21, steps: 4, "bank.item_0": ["first", 0], "bank.item_1": ["resize", 1], "voices.a": ["audio", 0] } },
    save: { class_type: "Sink", inputs: { frames: ["gen", 0], format: "video/mp4" } },
};
const record = (g = graph, metadata = info): ComfyWorkflow => ({ id: "custom", name: "custom", description: "", workflow: structuredClone(g), ...analyzeWorkflow(g, metadata), createdAt: "", updatedAt: "" });
const build = (w: ComfyWorkflow, values: Record<string, unknown>) => buildRunWorkflow(w.workflow, w.fields, values, w);

describe("protocol-driven foundation", () => {
    test("identifies upload flags, typed paths, groups, roles and outputs", () => {
        const w = record();
        expect(w.fields.find((f) => f.id === "first:file")).toMatchObject({ type: "image", enabled: true });
        expect(w.fields.find((f) => f.id === "audio:recording")).toMatchObject({ type: "audio", enabled: true });
        expect(workbenchPromptField(w.fields)?.id).toBe("text:value");
        expect(w.fields.find((f) => f.id === "gen:seed")).toMatchObject({ presetRole: "seed", randomize: false });
        expect(w.referenceGroups?.map((g) => g.bindings.length)).toEqual([2, 1]);
        expect(workflowOutputKinds(w)).toEqual(["video"]);
    });
    test("sparse inputs retain processing and nonzero output slots without mutating the template", () => {
        const w = record(),
            original = structuredClone(w),
            run = build(w, { "second:file": "b.png", "audio:recording": "a.wav" });
        expect(run.gen.inputs["bank.item_0"]).toEqual(["resize", 1]);
        expect(run.resize.inputs).toEqual({ picture: ["second", 0], amount: 2 });
        expect(run.second.inputs.file).toBe("b.png");
        expect(run.first).toBeUndefined();
        expect(w).toEqual(original);
    });
    test("zero references prune exclusive branches and preserve scalar parameters", () => {
        const run = build(record(), {});
        for (const id of ["first", "second", "resize", "audio"]) expect(run[id]).toBeUndefined();
        expect(run.gen.inputs).toEqual({ prompt: ["text", 0], seed: 21, steps: 4 });
    });
    test("dynamic group bounds are independent", () => {
        const metadata = structuredClone(info);
        metadata.Anything.input!.optional!.bank[1]!.template = { input: { required: { picture: ["IMAGE"] } }, prefix: "item_", min: 2, max: 2 };
        const w = record(graph, metadata);
        expect(() => build(w, { "second:file": "b.png" })).toThrow("至少选择 2");
        expect(build(w, { "first:file": "a.png", "second:file": "b.png" }).gen.inputs["bank.item_1"]).toEqual(["resize", 1]);
        w.referenceGroups![0].max = 1;
        expect(() => build(w, { "first:file": "a.png", "second:file": "b.png" })).toThrow("最多 1");
    });
    test("named dynamic elements follow names rather than numeric guesses", () => {
        const g = structuredClone(graph),
            metadata = structuredClone(info);
        g.gen.inputs["bank.style"] = g.gen.inputs["bank.item_1"];
        g.gen.inputs["bank.identity"] = g.gen.inputs["bank.item_0"];
        delete g.gen.inputs["bank.item_0"];
        delete g.gen.inputs["bank.item_1"];
        metadata.Anything.input!.optional!.bank[1]!.template = { input: { required: { picture: ["IMAGE"] } }, names: ["identity", "style"], min: 0 };
        const run = build(record(g, metadata), { "second:file": "b.png" });
        expect(run.gen.inputs["bank.identity"]).toEqual(["resize", 1]);
        expect(run.gen.inputs["bank.style"]).toBeUndefined();
    });
    test("fixed first/last sockets never change meaning", () => {
        const g = structuredClone(graph),
            metadata = structuredClone(info);
        delete g.gen.inputs["bank.item_0"];
        delete g.gen.inputs["bank.item_1"];
        delete g.gen.inputs["voices.a"];
        delete g.audio;
        g.gen.inputs.first_frame = ["first", 0];
        g.gen.inputs.last_frame = ["resize", 1];
        metadata.Anything.input!.optional = { first_frame: ["IMAGE"], last_frame: ["IMAGE"] };
        const run = build(record(g, metadata), { "second:file": "b.png" });
        expect(run.gen.inputs.last_frame).toEqual(["resize", 1]);
        expect(run.gen.inputs.first_frame).toBeUndefined();
    });
    test("missing media shared with a required consumer is rejected", () => {
        const g = structuredClone(graph);
        g.another = { class_type: "Sink", inputs: { frames: ["first", 0], format: "image/png" } };
        expect(() => build(record(g), {})).toThrow("仍被其他节点使用");
    });
    test("selected media shared by optional consumers retains both connections", () => {
        const g = structuredClone(graph);
        g.gen.inputs["bank.item_1"] = ["first", 0];
        delete g.second;
        delete g.resize;
        const run = build(record(g), { "first:file": "a.png" });
        expect(run.gen.inputs["bank.item_0"]).toEqual(["first", 0]);
        expect(run.gen.inputs["bank.item_1"]).toEqual(["first", 0]);
    });
    test("renaming all classes and IDs and reversing object order preserves identification", () => {
        const ids = Object.keys(graph),
            names = Object.keys(info),
            mapping = Object.fromEntries(ids.map((id, i) => [id, `unrelated_${ids.length - i}`])),
            classes = Object.fromEntries(names.map((name, i) => [name, `ForeignType_${i}`]));
        const metadata = Object.fromEntries(names.map((name) => [classes[name], info[name]]));
        const g = Object.fromEntries(
            Object.entries(graph)
                .reverse()
                .map(([id, n]) => [
                    mapping[id],
                    {
                        ...n,
                        class_type: classes[n.class_type],
                        inputs: Object.fromEntries(
                            Object.entries(n.inputs)
                                .reverse()
                                .map(([key, v]) => [key, Array.isArray(v) ? [mapping[v[0]], v[1]] : v]),
                        ),
                    },
                ]),
        );
        const w = record(g, metadata),
            run = build(w, { [`${mapping.second}:file`]: "b.png" });
        expect(workbenchPromptField(w.fields)?.id).toBe(`${mapping.text}:value`);
        expect(run[mapping.gen].inputs["bank.item_0"]).toEqual([mapping.resize, 1]);
    });
});

describe("configuration and diagnostics", () => {
    test("ambiguous prompt and seed roles remain unset; an explicit prompt selection works", () => {
        const g = structuredClone(graph);
        g.other = { class_type: "Anything", inputs: { prompt: "another prompt", seed: 99, steps: 4 } };
        const w = record(g);
        expect(workbenchPromptField(w.fields)).toBeUndefined();
        expect(w.fields.filter((f) => f.presetRole === "seed")).toHaveLength(0);
        expect(w.diagnostics?.map((i) => i.code)).toContain("ambiguous-prompt");
        expect(workbenchPromptField(w.fields, "other:prompt")?.id).toBe("other:prompt");
    });
    test("refresh preserves saved IDs, roles, labels, ordering, defaults, aliases and execution blocks", () => {
        const w = record();
        w.aliasIds = ["old-id"];
        w.executionBlockedReason = "draft";
        w.fields[0] = { ...w.fields[0], label: "我的提示词", order: 91, enabled: false, defaultValue: "saved" };
        const refreshed = { ...w, ...analyzeWorkflow(w.workflow, info, w) };
        for (const key of ["id", "aliasIds", "executionBlockedReason", "workflow"] as const) expect(refreshed[key]).toEqual(w[key]);
        for (const old of w.fields) expect(refreshed.fields.find((f) => f.id === old.id)).toMatchObject(old);
    });
    test("a path mismatch only suggests; accepting it synchronizes a hidden field and graph", () => {
        const g = { model: { class_type: "Weights", inputs: { asset: "same.safetensors" } } },
            metadata = { Weights: { input: { required: { asset: [["Folder\\same.safetensors", "Other\\different.safetensors"]] } } } } satisfies ComfyObjectInfo;
        const w = record(g, metadata);
        w.fields[0].enabled = false;
        expect(w.diagnostics?.find((i) => i.code === "invalid-option")?.suggestions).toEqual(["Folder\\same.safetensors"]);
        expect(() => preflightComfyRun(w, {})).toThrow("不接受");
        const fixed = patchWorkflowField(w, "model:asset", { defaultValue: "Folder\\same.safetensors" });
        expect(fixed.fields[0].enabled).toBe(false);
        expect(fixed.fields[0].defaultValue).toBe(fixed.workflow.model.inputs.asset);
        expect(() => preflightComfyRun(fixed, {})).not.toThrow();
        expect(w.workflow.model.inputs.asset).toBe("same.safetensors");
    });
    test("without definitions new media is not guessed and saved fields are retained", () => {
        expect(record(graph, {}).fields.find((f) => f.id === "first:file")?.type).toBe("text");
        expect(record(graph, {}).referenceGroups).toEqual([]);
        const w = record();
        expect(analyzeWorkflow(w.workflow, undefined, w).fields).toEqual(w.fields);
    });
    test("missing nodes and dangling links are preflight errors", () => {
        expect(() => preflightComfyRun(record(graph, {}), {})).toThrow("不存在");
        const g = structuredClone(graph);
        g.save.inputs.frames = ["missing", 0];
        expect(() => build(record(g), {})).toThrow("上游节点 #missing");
    });
    test("the builder never inserts nodes or interprets project placeholder strings", () => {
        const g = { x: { class_type: "TextEncodeZImageOmni", inputs: { auto_resize_images: true, prompt: "__REQUIRED_PROJECT_CONVENTION__" } } };
        expect(buildRunWorkflow(g, [], {})).toEqual(g);
    });
    test("unknown files require MIME or an explicit output type", () => {
        const result = { x: { files: [{ filename: "unknown.blob", type: "output" }] } },
            file = collectComfyOutputs(result, { x: "Foreign" })[0];
        expect(file.kind).toBe("file");
        expect(refineOutputKind(file, "video/mp4")).toBe("video");
        expect(() => refineOutputKind(file, "application/octet-stream")).toThrow("配置工作流输出类型");
        expect(collectComfyOutputs(result, { x: "Foreign" }, { outputKinds: ["audio"] })[0].kind).toBe("audio");
    });
    test("the product core contains no author/model-specific branches", () => {
        for (const name of ["workflow.ts", "definition.ts", "references.ts", "output.ts", "prepare.ts"])
            expect(readFileSync(new URL(`../src/lib/comfyui/${name}`, import.meta.url), "utf8")).not.toMatch(/MiniMaxH3|TextEncodeZImage|WorkFisher|sheep_workflow_|minimax_h3|\["136"\]|\['136'\]/);
    });
});
for (const filename of ["01_角色_作者原文_API.json", "02_三视图_作者原文_API.json", "03_场景_作者原文_API.json", "04_H3_作者原文_六参考_API.json", "05_角色含SeedVR2_作者原文_API.json"])
    test(`real template without author script: ${filename}`, () => {
        const g = JSON.parse(readFileSync(new URL(`../../verification/naked-sheep-import/导入资料/workflows/${filename}`, import.meta.url), "utf8")),
            w = record(g, realInfo as ComfyObjectInfo);
        expect(w.fields.length).toBeGreaterThan(0);
        expect(w.fields.filter((f) => f.presetRole === "prompt")).toHaveLength(1);
        expect(workflowOutputKinds(w).length).toBeGreaterThan(0);
        expect(w.workflow).toEqual(g);
    });

test("all sparse image/voice combinations preserve independent numbering and valid links", () => {
    const w = record();
    for (let mask = 0; mask < 8; mask++) {
        const values = Object.fromEntries(["first:file", "second:file", "audio:recording"].filter((_, i) => mask & (1 << i)).map((id) => [id, "selected-file"]));
        const run = build(w, values);
        expect(Object.keys(run.gen.inputs).filter((key) => key.startsWith("bank."))).toHaveLength(Number(Boolean(mask & 1)) + Number(Boolean(mask & 2)));
        expect(Object.keys(run.gen.inputs).filter((key) => key.startsWith("voices."))).toHaveLength(Number(Boolean(mask & 4)));
        for (const node of Object.values(run)) for (const value of Object.values(node.inputs)) if (Array.isArray(value)) expect(run[value[0]]).toBeDefined();
    }
});
test("declared port types are validated before media upload", () => {
    const g = structuredClone(graph);
    g.gen.inputs["bank.item_0"] = ["audio", 0];
    expect(() => build(record(g), { "audio:recording": "voice.wav" })).toThrow("类型");
});
test("explicit STRING outputs accept arbitrary history keys and text-file MIME", () => {
    expect(collectComfyOutputs({ node: { result: ["hello"] } }, { node: "Unknown" }, { nodeInfo: { Unknown: { output: ["STRING"], output_node: true } } })[0].text).toBe("hello");
    expect(refineOutputKind({ kind: "file", nodeId: "node", classType: "Unknown" }, "text/plain")).toBe("text");
});
test("an optional uploader with a V1 typed output does not validate stale file inventory", () => {
    const metadata = structuredClone(info);
    metadata.FileWidget.input!.required!.file = [["old.png"]];
    expect(build(record(graph, metadata), { "first:file": "just-uploaded.png" }).first.inputs.file).toBe("just-uploaded.png");
});

test("invalid options and missing required media fail before any upload or submission", async () => {
    const { runComfyTest } = await import("../src/lib/comfyui/test-run");
    const originalFetch = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        seen.push(url);
        if (url.includes("/object_info/")) return Response.json(info);
        throw new Error("Upload or submit must not be reached");
    }) as typeof fetch;
    try {
        const g = structuredClone(graph);
        g.save.inputs.format = "unsupported";
        await expect(
            runComfyTest({ baseUrl: "http://fixture.invalid", workflow: record(g), values: {}, media: { "first:file": { name: "local.png", blob: new Blob(["png"]) } }, signal: new AbortController().signal, onProgress: () => {} }),
        ).rejects.toThrow("不接受");
        expect(seen.every((url) => url.includes("/object_info/"))).toBe(true);
        seen.length = 0;
        const required = { first: graph.first, second: graph.second };
        await expect(
            runComfyTest({ baseUrl: "http://fixture.invalid", workflow: record(required), values: {}, media: { "first:file": { name: "local.png", blob: new Blob(["png"]) } }, signal: new AbortController().signal, onProgress: () => {} }),
        ).rejects.toThrow("缺少媒体输入");
        expect(seen.every((url) => url.includes("/object_info/"))).toBe(true);
    } finally {
        globalThis.fetch = originalFetch;
    }
});

test("polymorphic processing branches preserve their original path and output slot", () => {
    const metadata = structuredClone(info);
    metadata.Process.input!.required!.picture = ["*"];
    metadata.Process.output = ["STRING", "*"];
    const run = build(record(graph, metadata), { "second:file": "b.png" });
    expect(run.gen.inputs["bank.item_0"]).toEqual(["resize", 1]);
    expect(run.resize.inputs.picture).toEqual(["second", 0]);
});

test("stale reference bindings fail instead of silently using another branch", () => {
    const w = record();
    w.referenceGroups![0].bindings[0].fieldIds = ["second:file"];
    expect(() => build(w, { "second:file": "b.png" })).toThrow("绑定与原图不符");
});
test("an explicitly chosen output on an optional branch is never silently pruned", () => {
    const w = record();
    w.outputNodeIds = ["resize"];
    expect(() => build(w, {})).toThrow("仍被其他节点使用");
});

test("a filename prefix is never mistaken for an output format", () => {
    const w = record(
        { save: { class_type: "OpaqueSink", inputs: { frames: ["image", 0], filename_prefix: "video/example" } }, image: graph.first },
        { ...info, OpaqueSink: { input: { required: { frames: ["IMAGE"], filename_prefix: ["STRING"] } }, output: [], output_node: true } },
    );
    expect(workflowOutputKinds(w)).toEqual(["image"]);
});
