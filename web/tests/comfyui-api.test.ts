import "./browser-globals";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { ComfyPromptError, describeComfyError, downloadComfyOutput, fetchComfyHistory, fetchComfyObjectInfo, fetchComfyQueue, isValidComfyBaseUrl, normalizeComfyBaseUrl, submitComfyPrompt, testComfyConnection, uploadComfyMedia } from "../src/services/api/comfyui";
import { useConfigStore } from "../src/stores/use-config-store";

const BASE = "http://192.168.11.2:8188";
const realFetch = globalThis.fetch;
let calls: Array<{ url: string; init: RequestInit }> = [];

/** Every service function goes through `fetch`, so one recorder covers the whole module. */
function respond(handler: (url: string, init: RequestInit) => Response) {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const request = init || {};
        calls.push({ url, init: request });
        return handler(url, request);
    }) as typeof fetch;
}

const json = (body: unknown, contentType = "application/json") => new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": contentType } });

function setProxy(enabled: boolean) {
    useConfigStore.setState({ config: { ...useConfigStore.getState().config, proxyEnabled: enabled, proxyUrl: "http://127.0.0.1:23210" } });
}

beforeEach(() => {
    calls = [];
    setProxy(false);
});

afterEach(() => {
    globalThis.fetch = realFetch;
    setProxy(false);
});

describe("address handling", () => {
    test("normalises a usable address and rejects the rest", () => {
        expect(normalizeComfyBaseUrl(" http://host:8188/// ")).toBe("http://host:8188");
        expect(normalizeComfyBaseUrl("https://host")).toBe("https://host");
        expect(normalizeComfyBaseUrl("host:8188")).toBe("");
        expect(normalizeComfyBaseUrl("")).toBe("");
        expect(isValidComfyBaseUrl("host:8188")).toBe(false);
        expect(isValidComfyBaseUrl("http://host:8188")).toBe(true);
    });

    test("refuses to call anything without a valid address", async () => {
        await expect(testComfyConnection("host:8188")).rejects.toThrow();
    });
});

describe("connection test", () => {
    test("returns the version and the first device", async () => {
        respond(() => json({ system: { comfyui_version: "0.33.0", os: "posix" }, devices: [{ name: "cuda:0 NVIDIA A100-SXM4-80GB" }] }));
        expect(await testComfyConnection(BASE)).toEqual({ version: "0.33.0", device: "cuda:0 NVIDIA A100-SXM4-80GB" });
        expect(calls[0].url).toBe(`${BASE}/system_stats`);
    });

    test("falls back to the OS when no device is reported, and reports HTTP errors", async () => {
        respond(() => json({ system: { comfyui_version: "0.33.0", os: "posix" } }));
        expect((await testComfyConnection(BASE)).device).toBe("posix");

        respond(() => new Response(JSON.stringify({ error: { message: "not found" } }), { status: 404 }));
        await expect(testComfyConnection(BASE)).rejects.toThrow("not found");
    });
});

describe("media upload", () => {
    test("posts a renamed file and returns ComfyUI's stored name", async () => {
        respond(() => json({ name: "canvas-abcd1234.png", subfolder: "sub", type: "input" }));
        const uploaded = await uploadComfyMedia(BASE, new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "我的素材.png");

        expect(uploaded).toEqual({ name: "canvas-abcd1234.png", subfolder: "sub", type: "input" });
        expect(calls[0].url).toBe(`${BASE}/upload/image`);
        expect(calls[0].init.method).toBe("POST");
        const form = calls[0].init.body as FormData;
        expect(form.get("type")).toBe("input");
        expect(form.get("overwrite")).toBe("false");
        // A conflict-free name avoids overwriting an existing ComfyUI input file.
        expect((form.get("image") as File).name).toMatch(/^canvas-[A-Za-z0-9_-]{8}\.png$/);
    });

    test("uses the WAV extension for audio with an extensionless canvas title", async () => {
        respond(() => json({ name: "uploaded.wav" }));
        await uploadComfyMedia(BASE, new Blob(["sound"], { type: "audio/wav" }), "绑匪音色");
        expect(((calls[0].init.body as FormData).get("image") as File).name).toMatch(/\.wav$/);
    });

    test("fails when ComfyUI rejects the upload or answers without a name", async () => {
        respond(() => json({}));
        await expect(uploadComfyMedia(BASE, new Blob(["x"]), "a.png")).rejects.toThrow();
        respond(() => new Response(JSON.stringify({ name: "not-saved.wav" }), { status: 400 }));
        await expect(uploadComfyMedia(BASE, new Blob(["x"]), "voice.wav")).rejects.toThrow();
    });
});

describe("prompt submission", () => {
    const workflow = { "3": { class_type: "KSampler", inputs: { seed: 1 } } };

    test("sends the workflow and returns the prompt ID", async () => {
        respond(() => json({ prompt_id: "adea5398-6430" }));
        expect(await submitComfyPrompt(BASE, workflow)).toBe("adea5398-6430");
        expect(JSON.parse(String(calls[0].init.body)).prompt).toEqual(workflow);
    });

    test("keeps node, class and input for a validation failure", async () => {
        respond(() =>
            json(
                {
                    error: { type: "invalid_prompt", message: "Prompt outputs failed validation", details: "" },
                    node_errors: { "3": { class_type: "KSampler", errors: [{ message: "Value not in list", details: "value not in list", extra_info: { input_name: "sampler_name" } }] } },
                },
                "application/json",
            ),
        );
        const error = await submitComfyPrompt(BASE, workflow).catch((failure) => failure);
        expect(error).toBeInstanceOf(ComfyPromptError);
        expect((error as ComfyPromptError).nodeErrors[0]).toEqual({ nodeId: "3", classType: "KSampler", input: "sampler_name", message: "Value not in list", details: "value not in list" });
        expect(describeComfyError(error)).toBe("Value not in list\nKSampler · sampler_name\nvalue not in list");
    });

    test("reports a missing custom node from the top-level error", async () => {
        respond(() => json({ error: { type: "prompt_outputs_failed_validation", message: "Failed to validate prompt", details: "Node ID '#12' does not exist" } }, "application/json"));
        await expect(submitComfyPrompt(BASE, workflow)).rejects.toThrow("Failed to validate prompt\nNode ID '#12' does not exist");
    });

    test("treats an HTTP rejection without a prompt ID as a failure", async () => {
        respond(() => new Response(JSON.stringify({ error: { message: "server busy" } }), { status: 400, headers: { "content-type": "application/json" } }));
        await expect(submitComfyPrompt(BASE, workflow)).rejects.toThrow("server busy");
    });
});

describe("history and queue", () => {
    test("an empty history means the prompt is still running", async () => {
        respond(() => json({}));
        expect(await fetchComfyHistory(BASE, "p1")).toBeUndefined();
    });

    test("returns the entry once it exists", async () => {
        respond(() => json({ p1: { status: { status_str: "success", completed: true }, outputs: { "9": { images: [{ filename: "a.png" }] } } } }));
        const item = await fetchComfyHistory(BASE, "p1");
        expect(item?.status?.status_str).toBe("success");
        expect(calls[0].url).toBe(`${BASE}/history/p1`);
    });

    test("lists the prompt IDs that are actually running", async () => {
        respond(() => json({ queue_running: [[1, "running-id", {}, {}]], queue_pending: [[2, "pending-id", {}, {}]] }));
        expect([...(await fetchComfyQueue(BASE))]).toEqual(["running-id"]);
    });
});

describe("output download", () => {
    const file = { filename: "shot.png", subfolder: "sub dir", type: "output" as const };

    test("requests /view with the file coordinates and returns bytes", async () => {
        respond(() => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200, headers: { "content-type": "image/png" } }));
        const downloaded = await downloadComfyOutput(BASE, file);
        expect(downloaded.contentType).toBe("image/png");
        expect(downloaded.blob.size).toBe(4);
        expect(calls[0].url).toContain("/view?");
        expect(calls[0].url).toContain("filename=shot.png");
        expect(calls[0].url).toContain("subfolder=sub+dir");
        expect(calls[0].url).toContain("type=output");
    });

    test("fails on a non-OK response and on an empty body", async () => {
        respond(() => new Response("gone", { status: 404 }));
        await expect(downloadComfyOutput(BASE, file)).rejects.toThrow();
        respond(() => new Response(new Uint8Array([]), { status: 200 }));
        await expect(downloadComfyOutput(BASE, file)).rejects.toThrow();
    });
});

describe("local proxy wrapping", () => {
    test("prefixes every request while the proxy is on and stops once it is off", async () => {
        respond(() => json({ system: { comfyui_version: "0.33.0" }, devices: [] }));
        setProxy(true);
        await testComfyConnection(BASE);
        expect(calls[0].url).toBe(`http://127.0.0.1:23210/${BASE}/system_stats`);

        setProxy(false);
        await testComfyConnection(BASE);
        expect(calls[1].url).toBe(`${BASE}/system_stats`);
    });
});

describe("network failures", () => {
    test("explains a blocked or refused connection in one message", async () => {
        globalThis.fetch = (async () => {
            throw new TypeError("Failed to fetch");
        }) as typeof fetch;
        await expect(testComfyConnection(BASE)).rejects.toThrow("代理");

        globalThis.fetch = (async () => {
            throw new DOMException("Aborted", "AbortError");
        }) as typeof fetch;
        await expect(testComfyConnection(BASE)).rejects.toThrow("超时");
    });

    test("preserves desktop connection failures for metadata and generation", async () => {
        respond(() => new Response(JSON.stringify({ error: { message: "无法连接上游服务 http://192.168.11.2:8188：连接被拒绝，请检查服务是否启动及地址、端口是否正确。" } }), { status: 502, headers: { "content-type": "application/json" } }));
        await expect(fetchComfyObjectInfo(BASE, ["KSampler"])).rejects.toThrow("连接被拒绝");
        await expect(submitComfyPrompt(BASE, {})).rejects.toThrow("连接被拒绝");
    });

    test("reports HTTP failures before JSON errors for a plain-text gateway response", async () => {
        respond(() => new Response("fetch failed", { status: 502 }));
        await expect(testComfyConnection(BASE)).rejects.toThrow("HTTP 502");
        await expect(submitComfyPrompt(BASE, {})).rejects.toThrow("HTTP 502");
    });

    test("reports a body that is not JSON", async () => {
        respond(() => new Response("<html>proxy error</html>", { status: 200, headers: { "content-type": "text/html" } }));
        await expect(testComfyConnection(BASE)).rejects.toThrow();
    });
});
