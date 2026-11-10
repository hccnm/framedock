import { useEffect, useState } from "react";
import { App, Input, Switch } from "antd";
import { Puzzle, Search } from "lucide-react";
import { ensurePluginsLoaded, setPluginEnabled } from "@/lib/canvas/plugin-loader";
import { isBundledPluginUrl } from "@/lib/canvas/plugin-registry";
import { usePluginStore, type InstalledPlugin } from "@/stores/canvas/use-plugin-store";
import "../extensions.css";

export default function PluginsPage() {
    const plugins = usePluginStore((state) => state.plugins);
    const { message } = App.useApp();
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [busyId, setBusyId] = useState("");
    useEffect(() => {
        let active = true;
        void ensurePluginsLoaded().catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "插件加载失败"); }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);
    const bundled = plugins.filter((item) => item.local && isBundledPluginUrl(item.url));
    const filtered = bundled.filter((item) => `${item.name} ${item.description || ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    const toggle = async (plugin: InstalledPlugin, enabled: boolean) => {
        setBusyId(plugin.id);
        try { await setPluginEnabled(plugin, enabled); message.success(enabled ? "插件已启用" : "插件已停用"); }
        catch (cause) { message.error(cause instanceof Error ? cause.message : "插件状态更新失败"); }
        finally { setBusyId(""); }
    };
    return <main className="fh-library fh-extension-page">
        <header className="fh-hero"><h1>插件</h1><p>为创作画布启用新的节点与工具。</p></header>
        <section className="fh-content">
            <div className="fh-toolbar"><span className="fh-tab">随包插件</span><Input aria-label="搜索插件" placeholder="搜索插件" prefix={<Search size={14} />} value={query} onChange={(event) => setQuery(event.target.value)} allowClear /></div>
            <p className="fh-extension-hint">当前仅支持随应用提供的插件。启用后可在画布节点菜单中使用，状态自动保存在本机。</p>
            {error && <p role="alert">{error}</p>}
            {loading ? <div className="fh-empty" role="status">正在读取随包插件…</div> : filtered.length ? <div className="fh-extension-list">{filtered.map((plugin) => <article className="fh-extension-row" key={plugin.id}>
                <Puzzle size={20} strokeWidth={1.5} aria-hidden="true" />
                <div className="fh-extension-copy"><h2>{plugin.name}<small>v{plugin.version}</small></h2><p>{plugin.description || plugin.id}</p></div>
                <label className="fh-extension-toggle"><span>{plugin.enabled ? "已启用" : "已停用"}</span><Switch aria-label={`${plugin.enabled ? "停用" : "启用"}${plugin.name}`} checked={plugin.enabled} loading={busyId === plugin.id} disabled={!!busyId} onChange={(enabled) => void toggle(plugin, enabled)} /></label>
            </article>)}</div> : <div className="fh-empty"><Puzzle size={40} strokeWidth={1} /><h2>{query.trim() ? "没有匹配的插件" : "暂无随包插件"}</h2><p>{query.trim() ? "换个关键词试试。" : "请确认当前应用包含插件清单与对应文件。"}</p></div>}
        </section>
    </main>;
}
