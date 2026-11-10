import { describe, expect, test } from "bun:test";

import { collectComfyOutputs, dedupeOutputs, readExecutionError, readHistoryStatus, refineOutputKind } from "../src/lib/comfyui/output";
import type { ComfyOutput } from "../src/types/comfyui";

const saveImage = (nodeId: string, filename: string) => ({ [nodeId]: { images: [{ filename, subfolder: "", type: "output" }] } });

describe("output classification", () => {
    test("reads the file extension for ordinary nodes", () => {
        expect(collectComfyOutputs(saveImage("9", "shot_00001_.png"), { "9": "SaveImage" })).toEqual([{ kind: "image", nodeId: "9", classType: "SaveImage", file: { filename: "shot_00001_.png", subfolder: "", type: "output" } }]);
        expect(collectComfyOutputs({ "9": { audio: [{ filename: "a.flac", subfolder: "", type: "output" }] } }, { "9": "SaveAudio" })[0].kind).toBe("audio");
    });

    test("trusts the output key for video nodes that emit mp4 under `gifs`", () => {
        const outputs = collectComfyOutputs({ "9": { gifs: [{ filename: "clip.mp4", subfolder: "", type: "output" }] } }, { "9": "VHS_VideoCombine" });
        expect(outputs[0].kind).toBe("video");
    });

    test("reads text without treating it as a file", () => {
        expect(collectComfyOutputs({ "2": { text: ["ComfyUI 文本输出测试"] } }, { "2": "ShowText|pysssss" })).toEqual([{ kind: "text", nodeId: "2", classType: "ShowText|pysssss", text: "ComfyUI 文本输出测试" }]);
        expect(collectComfyOutputs({ "2": { text: [{ text: "hello", extra: 1 }] } }, { "2": "Text" })[0].text).toBe("hello");
    });

    test("refines the kind from the downloaded content type", () => {
        const output = { kind: "image", nodeId: "9", classType: "SaveImage" } as ComfyOutput;
        expect(refineOutputKind(output, "video/mp4")).toBe("video");
        expect(refineOutputKind(output, "audio/wav; charset=binary")).toBe("audio");
        expect(refineOutputKind(output, "image/webp")).toBe("image");
        expect(refineOutputKind(output, "")).toBe("image");
    });
});

describe("debug output filtering", () => {
    test("uses metadata and explicit selections rather than class-name blacklists", () => {
        const outputs = { a: { text: ["formal"] }, b: { text: ["intermediate"] } };
        expect(collectComfyOutputs(outputs, { a: "PreviewButFormal", b: "Ordinary" }, { nodeInfo: { PreviewButFormal: { output_node: true }, Ordinary: { has_intermediate_output: true } } }).map((o) => o.text)).toEqual(["formal"]);
        expect(collectComfyOutputs(outputs, { a: "Whatever", b: "Anything" }, { outputNodeIds: ["b"] }).map((o) => o.text)).toEqual(["intermediate"]);
    });

    test("drops previews once a real output node produced something", () => {
        const outputs = collectComfyOutputs({ ...saveImage("9", "final.png"), "10": { images: [{ filename: "preview.png", subfolder: "", type: "temp" }] } }, { "9": "SaveImage", "10": "PreviewImage" });
        expect(outputs.map((item) => item.file?.filename)).toEqual(["final.png"]);
    });

    test("keeps previews when the workflow has no real output", () => {
        const outputs = collectComfyOutputs({ "10": { images: [{ filename: "preview.png", subfolder: "", type: "temp" }] } }, { "10": "PreviewImage" });
        expect(outputs.map((item) => item.file?.filename)).toEqual(["preview.png"]);
    });

    test("returns nothing for missing or empty outputs", () => {
        expect(collectComfyOutputs(undefined, {})).toEqual([]);
        expect(collectComfyOutputs({}, {})).toEqual([]);
        expect(collectComfyOutputs({ "9": {} }, { "9": "SaveImage" })).toEqual([]);
    });
});

describe("deduplication", () => {
    test("keeps one entry per node, file and text", () => {
        const output = { kind: "image", nodeId: "9", classType: "SaveImage", file: { filename: "a.png", subfolder: "", type: "output" } } as ComfyOutput;
        expect(dedupeOutputs([output, { ...output }])).toHaveLength(1);
        expect(dedupeOutputs([output, { ...output, file: { ...output.file!, subfolder: "sub" } } as ComfyOutput])).toHaveLength(2);
        const text = { kind: "text", nodeId: "2", classType: "Text", text: "same" } as ComfyOutput;
        expect(dedupeOutputs([text, { ...text }])).toHaveLength(1);
        expect(dedupeOutputs([text, { ...text, text: "other" }])).toHaveLength(2);
    });
});

describe("history status and errors", () => {
    test("only a returned entry is terminal", () => {
        expect(readHistoryStatus(undefined)).toBe("pending");
        expect(readHistoryStatus({ status: { status_str: "success" } })).toBe("success");
        expect(readHistoryStatus({})).toBe("success");
    });

    test("reports the execution error with node, class and message", () => {
        const item = {
            status: {
                status_str: "error",
                messages: [
                    ["execution_start", {}],
                    ["execution_error", { node_id: "9", node_type: "SaveImage", exception_type: "RuntimeError", exception_message: "  failed to save  " }],
                ],
            },
        };
        expect(readHistoryStatus(item)).toBe("error");
        expect(readExecutionError(item)).toEqual({ nodeId: "9", nodeType: "SaveImage", exceptionType: "RuntimeError", message: "failed to save" });
    });

    test("treats an error status without messages as an error", () => {
        expect(readHistoryStatus({ status: { status_str: "error" } })).toBe("error");
        expect(readExecutionError({ status: { status_str: "error" } })).toBeUndefined();
    });
});
