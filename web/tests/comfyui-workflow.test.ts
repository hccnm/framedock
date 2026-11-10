import "./browser-globals";
import nodeInfo from "./fixtures/comfy-node-info.json";

import { describe, expect, test } from "bun:test";

import { buildComfyMapping, coerceFieldValue } from "../src/lib/comfyui/mapping";
import { clampComfyPollSeconds, comfyPollDelayMs, DEFAULT_COMFY_POLL_SECONDS, MIN_COMFY_POLL_SECONDS } from "../src/lib/comfyui/poll";
import {
    assignPresetRoles,
    buildRunWorkflow,
    createWorkflowFields,
    defaultFieldValue,
    hasRoleConflict,
    inferFieldShape,
    isLinkInput,
    isMediaFieldType,
    parseWorkflowFile,
    randomSeed,
    refreshWorkflowFields,
    validateWorkflow,
} from "../src/lib/comfyui/workflow";
import type { ComfyObjectInfo, ComfyWorkflowField } from "../src/types/comfyui";

const T2I = JSON.stringify({
    4: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "sdxl.safetensors" } },
    5: { class_type: "EmptyLatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    6: { class_type: "CLIPTextEncode", _meta: { title: "正向提示词" }, inputs: { text: "a cat", clip: ["4", 1] } },
    3: { class_type: "KSampler", inputs: { seed: 42, steps: 20, cfg: 7, sampler_name: "euler", model: ["4", 0], positive: ["6", 0] } },
});

const field = (patch: Partial<ComfyWorkflowField>): ComfyWorkflowField => ({ id: "x", nodeId: "1", inputKey: "text", nodeTitle: "T", label: "text", type: "text", enabled: true, order: 0, ...patch });

describe("API Format recognition", () => {
    test("accepts a flat node map keyed by node ID", () => {
        const workflow = parseWorkflowFile(T2I);
        expect(Object.keys(workflow)).toEqual(["3", "4", "5", "6"]);
        expect(workflow["3"].class_type).toBe("KSampler");
    });

    test("rejects the UI workflow structure", () => {
        expect(() => parseWorkflowFile(JSON.stringify({ nodes: [], links: [] }))).toThrow();
    });

    test("rejects malformed and empty documents", () => {
        expect(() => parseWorkflowFile("{")).toThrow();
        expect(() => validateWorkflow({})).toThrow();
        expect(() => validateWorkflow({ "1": "KSampler" })).toThrow();
        expect(() => validateWorkflow({ "1": { inputs: { a: 1 } } })).toThrow();
        expect(() => validateWorkflow([{ class_type: "KSampler" }])).toThrow();
    });
});

describe("literal inputs versus graph connections", () => {
    test("treats two-element [nodeId, slot] arrays as links", () => {
        expect(isLinkInput(["4", 1])).toBe(true);
        expect(isLinkInput(["4", 0, "extra"])).toBe(false);
        expect(isLinkInput([4, 1])).toBe(false);
        expect(isLinkInput("text")).toBe(false);
    });

    test("never exposes a link as a field", () => {
        const ids = createWorkflowFields(parseWorkflowFile(T2I)).map((item) => item.id);
        expect(ids).not.toContain("6:clip");
        expect(ids).not.toContain("3:model");
        expect(ids).toContain("6:text");
    });
});

describe("field type inference", () => {
    test("applies the name rules when object info is unavailable", () => {
        expect(inferFieldShape("text", "a cat")).toEqual({ type: "textarea" });
        expect(inferFieldShape("negative", "blurry")).toEqual({ type: "textarea" });
        expect(inferFieldShape("seed", 42)).toEqual({ type: "number", randomize: false });
        expect(inferFieldShape("steps", 20)).toEqual({ type: "number" });
        expect(inferFieldShape("width", 1024)).toEqual({ type: "number" });
        expect(inferFieldShape("image", "a.png")).toEqual({ type: "text" });
        expect(inferFieldShape("video_path", "a.mp4")).toEqual({ type: "text" });
        expect(inferFieldShape("sound_file", "a.mp3")).toEqual({ type: "text" });
        expect(inferFieldShape("generate_audio", true)).toEqual({ type: "boolean" });
        expect(inferFieldShape("enabled", true)).toEqual({ type: "boolean" });
        expect(inferFieldShape("count", 3)).toEqual({ type: "number" });
    });

    test("merges object info for enums, ranges and strings", () => {
        const objectInfo: ComfyObjectInfo = {
            KSampler: {
                input: {
                    required: {
                        sampler_name: [["euler", "dpmpp_2m"], {}],
                        steps: ["INT", { min: 1, max: 100, step: 1 }],
                        cfg: ["FLOAT", { min: 0, max: 20, step: 0.1 }],
                        text: ["STRING", { multiline: true }],
                        tiled: ["BOOLEAN", {}],
                    },
                },
            },
        };
        const fields = createWorkflowFields(
            {
                "3": { class_type: "KSampler", inputs: { sampler_name: "euler", steps: 20, cfg: 7, text: "hi", tiled: false } },
            },
            objectInfo,
        );
        const byKey = Object.fromEntries(fields.map((item) => [item.inputKey, item]));
        expect(byKey.sampler_name.type).toBe("dropdown");
        expect(byKey.sampler_name.options).toEqual(["euler", "dpmpp_2m"]);
        expect(byKey.steps).toMatchObject({ type: "slider", min: 1, max: 100, step: 1 });
        expect(byKey.cfg).toMatchObject({ type: "slider", min: 0, max: 20, step: 0.1 });
        expect(byKey.text.type).toBe("textarea");
        expect(byKey.tiled.type).toBe("boolean");
    });

    test("refreshes existing field controls without altering author defaults or bindings", () => {
        const workflow = {
            id: "test",
            name: "测试",
            description: "",
            createdAt: "",
            updatedAt: "",
            workflow: { "1": { class_type: "ResolutionSelector", inputs: { aspect_ratio: "16:9", megapixels: 2, linked: ["2", 0] } } },
            fields: [
                field({ id: "1:aspect_ratio", inputKey: "aspect_ratio", label: "画面比例", enabled: false, order: 4, defaultValue: "16:9", presetRole: "width" }),
                field({ id: "1:megapixels", inputKey: "megapixels", defaultValue: 2, referenceInput: { nodeId: "3", inputKey: "image_0" } }),
                field({ id: "1:unknown", inputKey: "unknown", options: ["custom"] }),
            ],
        };
        const original = structuredClone(workflow);
        const fields = refreshWorkflowFields(workflow, { ResolutionSelector: { input: { required: { aspect_ratio: ["COMBO", { options: ["1:1", "16:9"] }], megapixels: ["FLOAT", { min: 0.1, max: 16, step: 0.1 }] } } } });
        expect(fields[0]).toMatchObject({ type: "dropdown", options: ["1:1", "16:9"], label: "画面比例", enabled: false, order: 4, defaultValue: "16:9", presetRole: "width" });
        expect(fields[1]).toMatchObject({ type: "slider", min: 0.1, max: 16, step: 0.1, defaultValue: 2, referenceInput: { nodeId: "3", inputKey: "image_0" } });
        expect(fields[2]).toEqual(workflow.fields[2]);
        expect(workflow).toEqual(original);
        expect(defaultFieldValue(field({ type: "dropdown", defaultValue: 2, options: [1, 2] }))).toBe(2);
    });

    test("keeps a manually selected media type when object info is refreshed", () => {
        const workflow = {
            id: "test",
            name: "test",
            description: "",
            createdAt: "",
            updatedAt: "",
            workflow: { "1": { class_type: "CustomLoader", inputs: { file: "voice.wav" } } },
            fields: [field({ id: "1:file", inputKey: "file", type: "audio", typeManuallySet: true })],
        };
        const refreshed = refreshWorkflowFields(workflow, { CustomLoader: { input: { required: { file: [["voice.wav"], {}] } } } });
        expect(refreshed[0].type).toBe("audio");
    });

    test("keeps a seed numeric even though its object info spans the whole 64-bit range", () => {
        const shape = inferFieldShape("seed", 1, ["INT", { min: 0, max: 18446744073709551615, step: 1 }]);
        expect(shape).toEqual({ type: "number", randomize: false });
    });

    test("prefers the media name over a LoadImage file enum", () => {
        const shape = inferFieldShape("image", "example.png", [["example.png", "other.png"], { image_upload: true }]);
        expect(shape).toEqual({ type: "image" });
    });
});

describe("preset roles", () => {
    test("assigns the unambiguous roles and enables those fields", () => {
        const fields = assignPresetRoles([
            field({ id: "6:text", inputKey: "text", type: "textarea", enabled: false }),
            field({ id: "3:seed", inputKey: "seed", type: "number", enabled: false }),
            field({ id: "3:width", inputKey: "width", type: "number", enabled: false }),
            field({ id: "3:height", inputKey: "height", type: "number", enabled: false }),
            field({ id: "3:denoise", inputKey: "denoise", type: "slider", enabled: false }),
            field({ id: "3:steps", inputKey: "steps", type: "slider", enabled: false }),
        ]);
        const roles = Object.fromEntries(fields.map((item) => [item.inputKey, item.presetRole]));
        expect(roles).toEqual({ text: "prompt", seed: "seed", width: "width", height: "height", denoise: "strength", steps: undefined });
        expect(fields.filter((item) => item.presetRole).every((item) => item.enabled)).toBe(true);
        expect(fields.find((item) => item.inputKey === "steps")?.enabled).toBe(false);
    });

    test("takes at most one field per unique role", () => {
        const fields = assignPresetRoles([field({ id: "6:text", inputKey: "text", type: "textarea", enabled: false }), field({ id: "7:text", inputKey: "text", type: "textarea", enabled: false })]);
        expect(fields.filter((item) => item.presetRole === "prompt")).toHaveLength(0);
    });

    test("enables video and audio inputs without giving them the image role", () => {
        const fields = assignPresetRoles([
            field({ id: "1:video", inputKey: "video", type: "video", enabled: false }),
            field({ id: "2:audio", inputKey: "audio", type: "audio", enabled: false }),
            field({ id: "3:text", inputKey: "text", type: "textarea", enabled: false }),
        ]);
        expect(fields.filter((item) => isMediaFieldType(item.type)).every((item) => item.enabled)).toBe(true);
        expect(fields.filter((item) => item.presetRole).map((item) => item.inputKey)).toEqual(["text"]);
    });

    test("reports a conflict only for unique roles", () => {
        const fields = [field({ id: "a", presetRole: "prompt" }), field({ id: "b", presetRole: "image" }), field({ id: "c" })];
        expect(hasRoleConflict(fields, "c", "prompt")).toBe(true);
        expect(hasRoleConflict(fields, "c", "image")).toBe(false);
        expect(hasRoleConflict(fields, "a", "prompt")).toBe(false);
    });
});

describe("poll interval", () => {
    test("raises anything below the minimum and keeps custom seconds", () => {
        expect(MIN_COMFY_POLL_SECONDS).toBe(1);
        expect(clampComfyPollSeconds(0.2)).toBe(1);
        expect(clampComfyPollSeconds(7.5)).toBe(7.5);
        expect(clampComfyPollSeconds(600)).toBe(600);
        expect(clampComfyPollSeconds(Number.NaN)).toBe(DEFAULT_COMFY_POLL_SECONDS);
    });

    test("converts seconds into the poll delay", () => {
        expect(comfyPollDelayMs(3)).toBe(3000);
        expect(comfyPollDelayMs(0)).toBe(1000);
        expect(comfyPollDelayMs()).toBe(DEFAULT_COMFY_POLL_SECONDS * 1000);
    });
});

describe("upstream mapping", () => {
    const fields = [field({ id: "6:text", inputKey: "text", type: "textarea", order: 0 }), field({ id: "7:text", inputKey: "text", type: "textarea", order: 1 }), field({ id: "8:image", inputKey: "image", type: "image", order: 2 })];

    test("maps text to the named field and joins only sources of that field", () => {
        const mapping = buildComfyMapping({
            fields,
            upstream: {
                "7:text": [
                    { kind: "text", label: "文本2", text: "第二段" },
                    { kind: "text", label: "文本3", text: "第三段" },
                ],
                "6:text": [{ kind: "text", label: "文本1", text: "第一段" }],
            },
            values: {},
        });
        expect(mapping[0]).toMatchObject({ source: "upstream", value: "第一段" });
        expect(mapping[1]).toMatchObject({ source: "upstream", value: "第二段\n\n第三段" });
    });

    test("maps media to its named field and reports unconnected media as missing", () => {
        const mapping = buildComfyMapping({
            fields,
            upstream: { "8:image": [{ kind: "image", label: "图片1", storageKey: "image:1", previewUrl: "blob:1" }] },
            values: {},
        });
        expect(mapping[2].source).toBe("upstream");
        expect(mapping[2].media).toEqual({ name: "图片1", storageKey: "image:1", url: "blob:1" });

        const empty = buildComfyMapping({ fields, upstream: {}, values: {} });
        expect(empty[2].source).toBe("missing");
    });

    test("falls back to the saved node value when nothing is connected", () => {
        const mapping = buildComfyMapping({ fields, upstream: {}, values: { "6:text": "手填文本" } });
        expect(mapping[0]).toMatchObject({ source: "node", value: "手填文本" });
    });

    test("ignores disabled fields", () => {
        const mapping = buildComfyMapping({ fields: [field({ id: "1:a", enabled: false }), ...fields], upstream: {}, values: {} });
        expect(mapping).toHaveLength(3);
    });
});

describe("value coercion and seeds", () => {
    test("coerces numbers to numbers and blanks to nothing", () => {
        expect(coerceFieldValue(field({ type: "number" }), "12")).toBe(12);
        expect(coerceFieldValue(field({ type: "slider" }), "1.5")).toBe(1.5);
        expect(coerceFieldValue(field({ type: "number" }), "")).toBeUndefined();
        expect(coerceFieldValue(field({ type: "number" }), "abc")).toBeUndefined();
    });

    test("keeps a dropdown option's literal type so ComfyUI still matches its enum", () => {
        const dropdown = field({ type: "dropdown", options: ["euler", 2] });
        expect(coerceFieldValue(dropdown, "euler")).toBe("euler");
        expect(coerceFieldValue(dropdown, "2")).toBe(2);
    });

    test("keeps booleans and strings", () => {
        expect(coerceFieldValue(field({ type: "boolean" }), true)).toBe(true);
        expect(coerceFieldValue(field({ type: "text" }), 7)).toBe("7");
    });

    test("produces a random integer seed in the safe range", () => {
        const seeds = new Set(Array.from({ length: 64 }, () => randomSeed()));
        expect(seeds.size).toBeGreaterThan(1);
        seeds.forEach((seed) => {
            expect(Number.isInteger(seed)).toBe(true);
            expect(seed).toBeGreaterThanOrEqual(0);
            expect(seed).toBeLessThan(Number.MAX_SAFE_INTEGER);
        });
    });

    test("reads a default per control type", () => {
        expect(defaultFieldValue(field({ type: "number", defaultValue: 8 }))).toBe(8);
        expect(defaultFieldValue(field({ type: "boolean", defaultValue: true }))).toBe(true);
        expect(defaultFieldValue(field({ type: "text", defaultValue: "hi" }))).toBe("hi");
        expect(defaultFieldValue(field({ type: "text" }))).toBe("");
    });
});

describe("run payload", () => {
    const fields = createWorkflowFields(parseWorkflowFile(T2I));

    test("overwrites only the enabled fields and never the template", () => {
        const template = parseWorkflowFile(T2I);
        const enabled = fields.map((item) => (item.id === "6:text" ? { ...item, enabled: true } : { ...item, enabled: false }));
        const run = buildRunWorkflow(template, enabled, { "6:text": "一只猫" });

        expect(run["6"].inputs.text).toBe("一只猫");
        expect(run["6"].inputs.clip).toEqual(["4", 1]);
        expect(run["3"].inputs.seed).toBe(42);
        expect(template["6"].inputs.text).toBe("a cat");
        expect(run["6"]).not.toBe(template["6"]);
    });

    test("ignores values for disabled fields and unknown nodes", () => {
        const run = buildRunWorkflow(
            parseWorkflowFile(T2I),
            fields.map((item) => ({ ...item, enabled: false })),
            { "6:text": "x", "99:none": "y" },
        );
        expect(run["6"].inputs.text).toBe("a cat");
        expect(run["99"]).toBeUndefined();
    });

    test("refuses to overwrite a graph connection even if a field points at one", () => {
        const run = buildRunWorkflow(parseWorkflowFile(T2I), [field({ id: "3:model", nodeId: "3", inputKey: "model", enabled: true })], { "3:model": "not-a-link" });
        expect(run["3"].inputs.model).toEqual(["4", 0]);
    });
});
