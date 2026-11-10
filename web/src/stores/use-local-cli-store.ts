import { create } from "zustand";
import i18n from "@/i18n";

import { fetchLocalRuntimes, rescanLocalRuntimes, selectLocalRuntime, testLocalRuntime, type LocalCliRuntime } from "@/services/api/local-cli";

type LocalCliStore = {
    runtimes: LocalCliRuntime[];
    loading: boolean;
    scanning: boolean;
    testingId: string;
    loaded: boolean;
    error: string;
    /** 读取运行时列表；connectable 为 false 时不发起请求。 */
    load: (endpoint: string, token: string, connectable: boolean, rescan?: boolean) => Promise<void>;
    select: (endpoint: string, token: string, id: string, executablePath?: string) => Promise<void>;
    test: (endpoint: string, token: string, id: string, executablePath?: string) => Promise<LocalCliRuntime | null>;
    clearError: () => void;
};

const rt = (key: string, options?: Record<string, unknown>) => i18n.t(`agent.cli.${key}`, options);

export const useLocalCliStore = create<LocalCliStore>((set, get) => ({
    runtimes: [],
    loading: false,
    scanning: false,
    testingId: "",
    loaded: false,
    error: "",
    load: async (endpoint, token, connectable, rescan = false) => {
        if (!connectable || (get().loading && !rescan)) return;
        set(rescan ? { scanning: true, error: "" } : { loading: true, error: "" });
        try {
            const { data = [] } = await (rescan ? rescanLocalRuntimes(endpoint, token) : fetchLocalRuntimes(endpoint, token));
            set({ runtimes: data, loaded: true });
        } catch (error) {
            set({ error: error instanceof Error ? error.message : rt(rescan ? "rescanFailed" : "loadFailed") });
        } finally {
            set(rescan ? { scanning: false } : { loading: false });
        }
    },
    select: async (endpoint, token, id, executablePath) => {
        set({ error: "" });
        try {
            const { data } = await selectLocalRuntime(endpoint, token, id, executablePath);
            set({ runtimes: get().runtimes.map((item) => (item.id === id ? data || { ...item, selected: true } : { ...item, selected: false })) });
        } catch (error) {
            set({ error: error instanceof Error ? error.message : rt("selectFailed") });
            throw error;
        }
    },
    test: async (endpoint, token, id, executablePath) => {
        set({ testingId: id, error: "" });
        try {
            const { data = null } = await testLocalRuntime(endpoint, token, id, executablePath);
            // 测试结果只返回给调用方展示，不写入运行时列表，也不冒充当前选择。
            return data;
        } catch (error) {
            set({ error: error instanceof Error ? error.message : rt("testFailed") });
            return null;
        } finally {
            set({ testingId: "" });
        }
    },
    clearError: () => set({ error: "" }),
}));
