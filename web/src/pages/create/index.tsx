import { useEffect, useState, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { App, Button, Select, theme } from "antd";
import { ArrowUpRight, BadgeCheck, FolderOpen, Plus } from "lucide-react";
import { LocalAgentPanel } from "@/components/agent/local-agent-panel";
import { SkillMedia } from "@/components/skills/skill-media";
import { fetchSkillCatalog, type MarketSkill } from "@/services/api/skill-market";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { isDesktopHost } from "@/lib/desktop-host";
import "./create.css";

export default function CreatePage() {
    const { token } = theme.useToken();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const folders = useCanvasStore((state) => state.projectFolders);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const saveError = useCanvasStore((state) => state.saveError);
    const installed = useAgentSkillStore((state) => state.skills);
    const [folderId, setFolderId] = useState<string | null>(null);
    const [catalog, setCatalog] = useState<MarketSkill[]>([]);
    const [error, setError] = useState("");
    const [reload, setReload] = useState(0);
    const [tab, setTab] = useState("inspiration");
    const [category, setCategory] = useState("精选");
    const [opening, setOpening] = useState(false);
    useEffect(() => {
        let disposed = false;
        setError("");
        void fetchSkillCatalog().then((items) => { if (!disposed) setCatalog(items); }).catch((cause) => { if (!disposed) setError(cause instanceof Error ? cause.message : "创作灵感加载失败"); });
        return () => { disposed = true; };
    }, [reload]);
    const categories = ["精选", ...new Set(catalog.flatMap((item) => item.tagsCn))];
    const items = catalog.filter((item) => (category === "精选" ? item.source === "official-featured" : item.tagsCn.includes(category)) && (tab !== "skills" || installed.some((skill) => skill.name === item.name && skill.enabled)));
    const useIdea = (item: MarketSkill) => {
        const skill = installed.find((entry) => entry.name === item.name && entry.enabled);
        if (skill) useAgentSkillStore.getState().selectSkill(skill, item.guidePrompt || skill.interface?.defaultPrompt || `$${skill.name}`);
        else {
            useAgentSkillStore.getState().clearSelection();
            useAgentStore.getState().setAgentState({ prompt: item.guidePrompt || `帮我创作${item.displayNameZh}，先和我确认创作需求。` });
        }
        document.querySelector<HTMLElement>(".creation-input [contenteditable]")?.focus();
    };
    const blank = () => {
        try {
            const id = useCanvasStore.getState().createProject("新的创作", folderId);
            navigate(`/canvas/${id}`);
        } catch (cause) { message.error(cause instanceof Error ? cause.message : "创建失败"); }
    };
    return <main className="creation-page" style={{ "--create-bg": token.colorBgLayout, "--create-panel": token.colorBgContainer, "--create-text": token.colorText, "--create-muted": token.colorTextSecondary, "--create-border": token.colorBorderSecondary, "--create-dot": token.colorFillSecondary, "--create-hover": token.colorFillTertiary } as CSSProperties}>
        <header className="creation-top"><span>让想法自由生长</span><div>{isDesktopHost() && <Button type="text" loading={opening} icon={<FolderOpen size={14} />} onClick={() => {
            if (opening) return;
            setOpening(true);
            void useCanvasStore.getState().openProjectDirectory().then((route) => { if (route) navigate(route); }).catch((cause) => message.error(cause instanceof Error ? cause.message : "打开失败")).finally(() => setOpening(false));
        }}>打开项目目录</Button>}<Link to="/projects">项目库 <ArrowUpRight size={13} /></Link></div></header>
        <section className="creation-hero" aria-labelledby="creation-title">
            <img className="creation-logo" src="/logo.svg" alt="FrameDock" width={42} height={42} />
            <h1 id="creation-title">脑海里的画面，是什么样的？</h1>
            <div className="creation-composer-wrap"><LocalAgentPanel landing autoConnect projectFolderId={folderId} />
                <div className="creation-project"><FolderOpen size={14} /><Select aria-label="选择创作所属项目" variant="borderless" placeholder="选择项目" allowClear value={folderId ?? undefined} onChange={(value) => setFolderId(value ?? null)} options={folders.map((folder) => ({ value: folder.id, label: folder.name }))} notFoundContent="暂无项目，可在项目库创建" /><Button type="text" size="small" icon={<Plus size={13} />} disabled={!hydrated || !!saveError} onClick={blank}>空白画布</Button></div>
            </div>
            {saveError && <p role="alert">{saveError}</p>}
            <p className="creation-caption">文字、图像、音频、视频，从一个想法开始。</p>
        </section>
        <section className="creation-discover" aria-label="创作灵感与技能">
            <div className="creation-discover-heading"><div className="creation-tabs" role="tablist" aria-label="创作内容"><button id="inspiration-tab" role="tab" aria-selected={tab === "inspiration"} aria-controls="creation-results" onClick={() => setTab("inspiration")}>创作灵感</button><button id="skills-tab" role="tab" aria-selected={tab === "skills"} aria-controls="creation-results" onClick={() => setTab("skills")}>我的技能</button></div><Link to="/skills">探索全部技能 <ArrowUpRight size={13} /></Link></div>
            <nav className="creation-categories" aria-label="灵感分类">{categories.map((item) => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</nav>
            <div id="creation-results" role="tabpanel" aria-labelledby={tab === "inspiration" ? "inspiration-tab" : "skills-tab"}>
                {error ? <p role="alert">{error} <Button type="text" onClick={() => setReload((value) => value + 1)}>重试</Button></p> : !catalog.length ? <p role="status">正在加载创作灵感…</p> : items.length ? <div className="creation-grid">{items.map((item) => <article className="creation-card" key={item.name}>
                    <div className="creation-cover">{item.coverUrl ? <SkillMedia src={item.coverUrl} title={item.displayNameZh} preview /> : <img src="/logo.svg" alt="" />}<Button className="creation-use" onClick={() => useIdea(item)}>用这个创意 <ArrowUpRight size={13} /></Button></div>
                    <div className="creation-card-copy"><button onClick={() => navigate(`/skills?skill=${encodeURIComponent(item.name)}`)}>{item.displayNameZh}</button><p>{item.summaryZh}</p><span>@{item.authorCn || "创作社区"}{item.source.startsWith("official") && <BadgeCheck size={12} />}</span></div>
                </article>)}</div> : <div className="creation-no-results"><p>{tab === "skills" ? "还没有这个分类的已启用技能" : "这个分类还没有创作灵感"}</p><Link to="/skills">浏览技能库 <ArrowUpRight size={13} /></Link></div>}
            </div>
        </section>
    </main>;
}
