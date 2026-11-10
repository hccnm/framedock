import React from "react";
import { createRoot } from "react-dom/client";
import { App, ConfigProvider } from "antd";
import { ConfigComfyUi } from "../../src/components/layout/config-comfyui";
import { useComfyUiStore } from "../../src/stores/use-comfyui-store";
import { useConfigStore } from "../../src/stores/use-config-store";
import "../../src/styles/globals.css";

const definitions = {
    ForeignText: { input: { required: { prompt: ["STRING", { multiline: true }] } }, output: ["STRING"] },
    ForeignWeights: { input: { required: { weights: [["models\\example.safetensors"]] } }, output: ["MODEL"] },
    ForeignResult: { input: { required: { content: ["STRING"], model: ["MODEL"] } }, output: ["STRING"], output_node: true },
};
const rawFetch = window.fetch.bind(window);
let lastGraph: Record<string, { inputs: Record<string, unknown> }> = {};
const requests: string[] = [];
Object.assign(window, { foundationFixture: { requests, getGraph: () => lastGraph } });
window.fetch = async (input, init) => {
    const url = String(input);
    if (!url.includes("fixture.invalid")) return rawFetch(input, init);
    requests.push(`${init?.method || "GET"} ${new URL(url).pathname}`);
    if (url.includes("/object_info/")) {
        const name = decodeURIComponent(url.split("/").pop()!);
        return Response.json({ [name]: definitions[name as keyof typeof definitions] });
    }
    if (url.endsWith("/prompt")) {
        lastGraph = JSON.parse(String(init?.body)).prompt;
        return Response.json({ prompt_id: "fixture-only-no-generation" });
    }
    if (url.includes("/history/")) return Response.json({ "fixture-only-no-generation": { outputs: { result: { custom_result: [String(lastGraph.primary.inputs.prompt)] } }, status: { completed: true, status_str: "success" } } });
    throw new Error(`Unexpected fixture request: ${url}`);
};
await useComfyUiStore.persist.rehydrate();
useComfyUiStore.setState({ hydrated: true, baseUrl: "http://fixture.invalid" });
useConfigStore.setState((state) => ({ config: { ...state.config, proxyEnabled: false } }));
createRoot(document.getElementById("root")!).render(
    <ConfigProvider>
        <App>
            <main style={{ padding: 24, maxWidth: 1200, margin: "auto" }}>
                <h1>工作流基座隔离验收</h1>
                <p>仅模拟 ComfyUI 协议，不连接真实生成服务。</p>
                <ConfigComfyUi />
            </main>
        </App>
    </ConfigProvider>,
);
