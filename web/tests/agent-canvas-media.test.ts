import "./browser-globals";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { prepareAgentCanvasMedia } from "../src/lib/agent/agent-canvas-media";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
let stored: Map<string, { bytes: Uint8Array; mimeType: string }>;

beforeEach(() => {
    stored = new Map();
    Object.defineProperty(globalThis, "window", { configurable: true, value: { canvasDesktop: { storage: {
        setMedia: async (namespace: string, key: string, value: { bytes: Uint8Array; mimeType: string }) => stored.set(`${namespace}/${key}`, value),
        getMedia: async (namespace: string, key: string) => stored.get(`${namespace}/${key}`) || null,
        removeMedia: async (namespace: string, key: string) => stored.delete(`${namespace}/${key}`),
    } } } });
    Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => {
        const media: { duration: number; onloadedmetadata?: () => void; onerror?: () => void } = { duration: 1 };
        Object.defineProperty(media, "src", { set: () => queueMicrotask(() => media.onloadedmetadata?.()) });
        return media;
    } } });
});

afterEach(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
});

const input = {
    projectId: "ep001", nodeId: "voice-1", nodeType: "audio" as const, title: "音色",
    dataUrl: "data:audio/wav;base64,YWJj", sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    x: 100, y: 200, metadata: { sourcePath: "声音/音色.wav" },
};

test("将音频原字节存入媒体库并创建带存储键的节点", async () => {
    const result = await prepareAgentCanvasMedia(input);
    expect(result.storageKey.startsWith("audio:")).toBe(true);
    expect(result.bytes).toBe(3);
    expect(Array.from(stored.get(`media/${result.storageKey}`)!.bytes)).toEqual([97, 98, 99]);
    expect(result.op).toMatchObject({ id: "voice-1", nodeType: "audio", position: { x: 100, y: 200 }, metadata: { storageKey: result.storageKey, sourcePath: "声音/音色.wav", assetSha256: input.sha256 } });
    await result.discard();
    expect(stored.size).toBe(0);
});

test("哈希或媒体类型不符时不写入存储", async () => {
    await expect(prepareAgentCanvasMedia({ ...input, sha256: "0".repeat(64) })).rejects.toThrow("SHA-256");
    await expect(prepareAgentCanvasMedia({ ...input, nodeType: "video" })).rejects.toThrow("类型");
    expect(stored.size).toBe(0);
});
