import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { useConfigStore, type AiConfig, type WebdavSyncConfig } from "@/stores/use-config-store";
import { usePromptSourceStore, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import { useComfyUiStore } from "@/stores/use-comfyui-store";
import type { ComfyPresetRoles, ComfyWorkflow } from "@/types/comfyui";
import type { PromptSource } from "@/services/api/prompt-source-presets";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    config: AiConfig;
    webdav: WebdavSyncConfig;
    promptSources: {
        sources: PromptSource[];
        schedule: PromptSourceSchedule;
    };
    /** Workflow definitions only: no run state, no media and no cached history responses. */
    comfyui: {
        baseUrl: string;
        presetWorkflowIds: ComfyPresetRoles;
        workflows: ComfyWorkflow[];
        pollIntervalSeconds: number;
    };
};

export function exportAppConfig() {
    const { config, webdav } = useConfigStore.getState();
    const { sources, schedule } = usePromptSourceStore.getState();
    const { baseUrl, presetWorkflowIds, workflows, pollIntervalSeconds } = useComfyUiStore.getState();
    const data: AppConfigFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), config, webdav, promptSources: { sources, schedule }, comfyui: { baseUrl, presetWorkflowIds, workflows, pollIntervalSeconds } };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "infinite-canvas-config.json");
}

export async function importAppConfig(file: File) {
    let data: AppConfigFile;
    try {
        data = JSON.parse(await file.text()) as AppConfigFile;
    } catch {
        throw new Error(i18n.t("config.invalidFile"));
    }
    if (data.app !== "infinite-canvas" || data.version !== 1 || !data.config || !data.webdav || !data.promptSources) throw new Error(i18n.t("config.invalidFile"));
    useConfigStore.setState({ config: data.config, webdav: data.webdav });
    usePromptSourceStore.setState(data.promptSources);
    // Files exported before ComfyUI existed simply carry no workflows.
    if (data.comfyui) useComfyUiStore.setState(data.comfyui);
}
