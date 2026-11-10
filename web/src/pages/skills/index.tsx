import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App, Button, Checkbox, Input, Modal, Select, Switch, theme as antdTheme } from "antd";
import { BadgeCheck, Box, ChevronLeft, ChevronRight, Download, FileText, Import, ListChecks, MessageSquare, Plus, Puzzle, Search, Share2, SlidersHorizontal, UserRound } from "lucide-react";
import { AgentSkillsView } from "@/components/agent/agent-skills-view";
import { LocalAgentPanel } from "@/components/agent/local-agent-panel";
import { useCopyText } from "@/hooks/use-copy-text";
import { isDesktopHost } from "@/lib/desktop-host";
import { useAgentStore } from "@/stores/use-agent-store";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { deleteCodexSkill, fetchCodexSkill, setCodexSkillEnabled, type AgentSkillSummary } from "@/services/api/canvas-agent";
import { fetchSkillCatalog, importSkillPackage, type MarketSkill } from "@/services/api/skill-market";
import { SkillMedia } from "@/components/skills/skill-media";
import "./skills.css";

const categories = ["全部", "精选", "短剧漫剧", "专业影视", "动画", "商业广告", "电商", "教育", "创意实验", "音频音乐", "平台工具"];
const titleOf = (skill: MarketSkill) => skill.displayNameZh || skill.name;
const downloads = (count: number) => count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);

export default function SkillsPage() {
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const { message, modal } = App.useApp();
    const copyText = useCopyText();
    const connected = useAgentStore((state) => state.connected);
    const url = useAgentStore((state) => state.url);
    const token = useAgentStore((state) => state.token);
    const connectError = useAgentStore((state) => state.connectError);
    const local = useAgentSkillStore((state) => state.skills);
    const errors = useAgentSkillStore((state) => state.errors);
    const { token: colors } = antdTheme.useToken();
    const [catalog, setCatalog] = useState<MarketSkill[]>([]);
    const [catalogError, setCatalogError] = useState("");
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState("全部");
    const [mine, setMine] = useState(false);
    const [uninstalled, setUninstalled] = useState(false);
    const [sort, setSort] = useState("recent");
    const [manager, setManager] = useState<"create" | "manage" | null>(null);
    const [busy, setBusy] = useState("");
    const [slide, setSlide] = useState(0);
    const [reload, setReload] = useState(0);
    const fileRef = useRef<HTMLInputElement>(null);
    const endpoint = url.trim().replace(/\/$/, "");
    useEffect(() => { let active = true; setCatalogError(""); void fetchSkillCatalog().then((items) => { if (active) setCatalog(items); }).catch((error) => { if (active) setCatalogError(String(error)); }); return () => { active = false; }; }, [reload]);
    useEffect(() => { if (connected) void useAgentSkillStore.getState().loadSkills(endpoint, token); }, [connected, endpoint, token]);
    const installed = (skill: MarketSkill) => local.find((item) => item.name === skill.name);
    const refresh = () => useAgentSkillStore.getState().loadSkills(endpoint, token, true);
    const run = async (name: string, action: () => Promise<void>) => {
        if (busy) return;
        setBusy(name);
        try { await action(); } catch (error) { void message.error(error instanceof Error ? error.message : String(error)); }
        finally { setBusy(""); }
    };
    const useInChat = (skill: AgentSkillSummary) => {
        const canvas = useCanvasStore.getState();
        const project = [...canvas.projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        const id = project?.id || canvas.createProject("新的创作");
        useAgentStore.getState().setAgentState({ activeTab: "chat" });
        useAgentStore.getState().openPanel();
        navigate(`/canvas/${id}?skill=${encodeURIComponent(skill.name)}`);
    };
    const install = (skill: MarketSkill) => run(skill.name, async () => {
        if (!connected) throw new Error("请先连接本地技能服务");
        if (!skill.packageUrl) throw new Error("此技能包尚未获取");
        const response = await fetch(skill.packageUrl);
        if (!response.ok) throw new Error("技能包读取失败");
        await importSkillPackage(endpoint, token, await response.arrayBuffer(), { displayName: titleOf(skill), defaultPrompt: `$${skill.name} ${skill.guidePrompt || ""}`.trim() });
        await refresh();
        void message.success("技能已安装");
    });
    const toggle = (skill: AgentSkillSummary, enabled: boolean) => run(skill.name, async () => { await setCodexSkillEnabled(endpoint, token, skill, enabled); await refresh(); });
    const remove = (skill: AgentSkillSummary) => modal.confirm({ title: `删除「${skill.interface?.displayName || skill.name}」？`, content: "删除本机技能及其资源文件，不影响已有对话。", okText: "删除", cancelText: "取消", okButtonProps: { danger: true }, onOk: async () => {
        const detail = await fetchCodexSkill(endpoint, token, skill.name);
        if (!detail.data) throw new Error("无法读取技能版本");
        await deleteCodexSkill(endpoint, token, skill.name, detail.data.revision); await refresh();
    } });
    const localOnly: MarketSkill[] = local.filter((item) => !catalog.some((entry) => entry.name === item.name)).map((item) => ({ name: item.name, displayNameZh: item.interface?.displayName || item.name, summaryZh: item.description, description: item.description, version: "", authorCn: "本地技能", source: "local", downloads: 0, tagsCn: [], categoryCodes: [], showcase: [] }));
    const filtered = [...catalog, ...(mine ? localOnly : [])].filter((skill) => (!mine || installed(skill)) && (!uninstalled || !installed(skill)) && (category === "全部" || category === "精选" && skill.source !== "official" || skill.tagsCn?.includes(category)) && (!query.trim() || `${titleOf(skill)} ${skill.name} ${skill.summaryZh}`.toLowerCase().includes(query.trim().toLowerCase())));
    if (sort === "downloads") filtered.sort((a, b) => b.downloads - a.downloads);
    if (sort === "name") filtered.sort((a, b) => titleOf(a).localeCompare(titleOf(b), "zh-CN"));
    const detail = [...catalog, ...localOnly].find((skill) => skill.name === params.get("skill"));
    const current = detail && installed(detail);
    const media = detail?.showcase?.length ? detail.showcase : detail?.coverUrl ? [detail.coverUrl] : [];
    const info = detail?.structuredInfo?.["zh-CN"];
    const close = () => { setParams({}); setSlide(0); };
    const show = (skill: MarketSkill) => { setParams({ skill: skill.name }); setSlide(0); };
    const skillAction = (skill: MarketSkill) => {
        const item = installed(skill);
        return item ? <Button size="small" type="text" disabled={!connected || !item.enabled || !!busy} icon={<MessageSquare size={14} />} onClick={() => useInChat(item)}>{item.enabled ? "去对话中试试" : "已停用"}</Button> : <Button size="small" type="text" disabled={!connected || !!busy} loading={busy === skill.name} icon={<Download size={14} />} onClick={() => void install(skill)}>安装 Skill</Button>;
    };
    const groups = mine || query ? [{ label: mine ? "我的 Skill" : "搜索结果", items: filtered, cards: true }] : [
        { label: "官方精选", items: filtered.filter((s) => s.source === "official-featured"), cards: true },
        { label: "用户精选", items: filtered.filter((s) => s.source === "community"), cards: true },
        { label: "其他 Skill", items: filtered.filter((s) => s.source === "official"), cards: false },
    ];
    return <main className="skill-page" style={{ "--skill-panel": colors.colorBgContainer, "--skill-background": colors.colorBgLayout, "--skill-text": colors.colorText, "--skill-muted": colors.colorTextSecondary, "--skill-border": colors.colorBorderSecondary, "--skill-hover": colors.controlItemBgActive } as React.CSSProperties}>
        <header className="skill-page-header"><nav className="skill-segments" aria-label="技能与插件"><button aria-current="page"><Puzzle size={15} />技能</button><button onClick={() => navigate("/plugins")}>插件</button></nav></header>
        <div className="skill-controls"><div className="skill-tabs" role="tablist"><button role="tab" aria-selected={!mine} onClick={() => { setMine(false); setUninstalled(false); }}>Skill</button><button role="tab" aria-selected={mine} onClick={() => { setMine(true); setUninstalled(false); }}>我的 Skill</button></div>
            <Input prefix={<Search size={14} />} aria-label="搜索 Skill" placeholder="搜索 Skill..." value={query} allowClear onChange={(event) => setQuery(event.target.value)} />
            <input type="file" accept=".zip" hidden ref={fileRef} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void run("import", async () => { await importSkillPackage(endpoint, token, await file.arrayBuffer()); await refresh(); setMine(true); void message.success("技能已导入"); }); }} />
            <Button icon={<Import size={15} />} disabled={!connected || !!busy} loading={busy === "import"} onClick={() => fileRef.current?.click()}>导入 Skill</Button>
            <Button icon={<SlidersHorizontal size={15} />} onClick={() => setManager("manage")}>管理 Skill</Button>
            <Button type="primary" icon={<Plus size={15} />} disabled={!connected} onClick={() => setManager("create")}>创建 Skill</Button>
        </div>
        <nav className="skill-categories" aria-label="技能分类">{categories.map((item) => <button key={item} aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</nav>
        {!connected && <div className="skill-service" role="status">{connectError || "本地技能服务未连接，可浏览技能和示例。"}{!isDesktopHost() && <Button size="small" onClick={() => useAgentStore.getState().connectAgent()}>连接</Button>}</div>}
        {errors.map((error) => <p key={error} role="alert">{error}</p>)}
        {catalogError ? <p role="alert">{catalogError} <Button onClick={() => setReload(reload + 1)}>重新加载</Button></p> : !catalog.length ? <p role="status">正在读取技能目录…</p> : null}
        {groups.map((group) => <section className="skill-section" key={group.label}><div className="skill-section-title"><h2>{group.label}{(!group.cards || mine || query) && <span> · {group.items.length}</span>}</h2>{(group.label === "其他 Skill" || mine || query) && <div>{!mine && <Checkbox checked={uninstalled} onChange={(event) => setUninstalled(event.target.checked)}>仅显示未安装</Checkbox>}<Select aria-label="技能排序" value={sort} onChange={setSort} options={[{ value: "recent", label: "排序：最近" }, { value: "downloads", label: "排序：下载量" }, { value: "name", label: "排序：名称" }]} /></div>}</div>
            {!group.items.length ? <p className="skill-empty">{mine ? "还没有安装技能" : "暂无符合筛选条件的 Skill"}</p> : <div className={group.cards ? "skill-grid" : "skill-list"}>{group.items.map((skill) => <article key={skill.name} className={`skill-card ${group.cards && skill.coverUrl ? "skill-card-cover" : "skill-card-plain"}`}>
                {group.cards && skill.coverUrl && <div className="skill-card-preview"><SkillMedia src={skill.coverUrl} title={titleOf(skill)} preview /><div className="skill-card-overlay"><Button onClick={() => show(skill)}>查看详情</Button>{skillAction(skill)}</div></div>}
                <div className="skill-card-body"><button className="skill-card-title" onClick={() => show(skill)}>{titleOf(skill)}</button><p title={skill.summaryZh}>{skill.summaryZh}</p><div className="skill-card-meta">{group.cards && <span>@{skill.authorCn || "MiniMax Design"}{skill.source.startsWith("official") && <BadgeCheck size={13} />}</span>}{skill.source !== "local" && <small title="来源目录下载量快照"><Download size={12} />{downloads(skill.downloads)}</small>}</div></div>
                {(!group.cards || !skill.coverUrl) && <div className="skill-card-actions">{skillAction(skill)}{installed(skill) && <Switch size="small" aria-label={`启用 ${titleOf(skill)}`} checked={installed(skill)?.enabled} disabled={!connected || !!busy} onChange={(value) => void toggle(installed(skill)!, value)} />}</div>}
            </article>)}</div>}
        </section>)}
        <Modal open={!!detail} onCancel={close} footer={null} centered width={960} className="skill-detail" destroyOnHidden title={detail && <div><h2>{titleOf(detail)}</h2><div className="skill-detail-meta"><UserRound size={14} />{detail.authorCn || "MiniMax Design"}{detail.source.startsWith("official") && <BadgeCheck size={14} />}<Download size={13} />{downloads(detail.downloads)}{detail.version && <span>v{detail.version}</span>}</div></div>}>
            {detail && <><div className="skill-detail-scroll">{media.length > 0 && <div className="skill-showcase"><SkillMedia key={media[slide]} src={media[slide]} title={`${titleOf(detail)} 示例 ${slide + 1}`} />{media.length > 1 && <div className="skill-carousel"><button aria-label="上一个素材" disabled={slide === 0} onClick={() => setSlide(slide - 1)}><ChevronLeft size={15} /></button><span>{slide + 1}/{media.length}</span><button aria-label="下一个素材" disabled={slide === media.length - 1} onClick={() => setSlide(slide + 1)}><ChevronRight size={15} /></button></div>}</div>}
            <div className="skill-info-grid"><section><h3><FileText size={14} />概览</h3><p>{info?.summary || detail.summaryZh}</p></section><section><h3><ListChecks size={14} />适用场景</h3><div className="skill-tags">{(info?.best_for || detail.tagsCn).map((tag) => <span key={tag}>{tag}</span>)}</div></section><section><h3><MessageSquare size={14} />如何使用</h3><p>{info?.how_to_use || detail.guidePrompt || detail.description}</p></section><section><h3><Box size={14} />产出内容</h3><p>{info?.outputs || detail.summaryZh}</p></section></div></div>
            <footer className="skill-detail-footer"><div>{current ? <><Switch aria-label="启用技能" checked={current.enabled} disabled={!connected || !!busy} onChange={(value) => void toggle(current, value)} /><span>{current.enabled ? "已启用" : "已停用"}</span></> : <span>尚未安装</span>}</div><div>{current?.managed && <Button size="small" type="text" danger onClick={() => remove(current)}>删除</Button>}{detail.packageUrl && <Button size="small" href={detail.packageUrl} download={`${detail.name}.zip`}>下载</Button>}<Button size="small" icon={<Share2 size={14} />} onClick={() => copyText(`${window.location.origin}${import.meta.env.BASE_URL}skills?skill=${encodeURIComponent(detail.name)}`, "技能链接已复制")}>分享</Button>{skillAction(detail)}</div></footer></>}
        </Modal>
        <Modal title={manager === "create" ? "创建 Skill" : "管理本地 Skill"} open={!!manager} onCancel={() => setManager(null)} width={900} footer={null} destroyOnHidden><div className="skill-manager"><AgentSkillsView clientId={sessionStorage.getItem("canvas-agent-client-id") || ""} initialCreate={manager === "create"} /></div></Modal>
        <LocalAgentPanel headless autoConnect />
    </main>;
}
