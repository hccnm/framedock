import { useEffect, useRef, useState, type ReactNode } from "react";
import { ConfigProvider, Input, Modal, theme } from "antd";
import { FileText, FolderOpen, Image, Library, PanelLeftClose, PanelLeftOpen, Search, Settings, Sparkles, Puzzle, Workflow, SquarePen, Video } from "lucide-react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { desktopBridge } from "@/lib/desktop-host";
import { AgentPanel } from "@/components/agent/agent-panel";
import { AppTopNav } from "@/components/layout/app-top-nav";
import { AppConfigModal } from "@/components/layout/app-config-modal";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import "./workbench.css";

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    useEffect(() => desktopBridge()?.onGenerationNotificationClick((target) => {
        const query = new URLSearchParams({ [target.kind === "canvas" ? "node" : "task"]: target.kind === "canvas" ? target.nodeId : target.logId });
        navigate(target.kind === "canvas" ? `/canvas/${encodeURIComponent(target.projectId)}?${query}` : `/${target.kind}?${query}`);
    }), [navigate]);
    const canvas = /^\/canvas\/[^/]+/.test(pathname);
    const [collapsed, setCollapsed] = useState(false);
    const [width, setWidth] = useState(264);
    const sidebarRef = useRef<HTMLElement>(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [query, setQuery] = useState("");
    const projects = useCanvasStore((state) => state.projects);
    const folders = useCanvasStore((state) => state.projectFolders);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const recent = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen((open) => !open); } };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
    return <div className={`fh-shell ${collapsed ? "fh-collapsed" : ""}`}>
        {!canvas && <aside ref={sidebarRef} className="fh-sidebar" style={{ width: collapsed ? 64 : width }}>
            <div className="fh-sidebar-tools"><button className="fh-icon" aria-label="搜索项目和创作页" title="搜索 ⌘/Ctrl+K" onClick={() => setSearchOpen(true)}><Search size={16} /></button><button className="fh-icon" aria-label={collapsed ? "展开侧栏" : "折叠侧栏"} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}</button></div>
            <Link className="fh-brand" to="/" title="FrameDock" aria-label="FrameDock 首页"><img src="/logo.svg" alt="" width={22} height={22} /><span>FrameDock</span></Link>
            <nav aria-label="主导航">{[
                { to: "/", label: "开始创作", icon: SquarePen }, { to: "/projects", label: "项目库", icon: FolderOpen },
                { to: "/assets", label: "我的素材", icon: Library }, { to: "/image", label: "图像创作", icon: Image }, { to: "/video", label: "视频创作", icon: Video },
                { to: "/canvas", label: "画布导入与导出", icon: FileText },
                { to: "/skills", label: "技能", icon: Sparkles }, { to: "/plugins", label: "插件", icon: Puzzle }, { to: "/workflows", label: "工作流", icon: Workflow },
            ].map(({ to, label, icon: Icon }) => <NavLink key={to} end={to === "/"} to={to} title={label} className={({ isActive }) => `fh-nav ${isActive ? "active" : ""}`}><Icon size={16} /><span>{label}</span></NavLink>)}</nav>
            <div className="fh-recents"><p className="fh-section-label">最近创作</p>{!recent.length && <p className="fh-section-label">{hydrated ? "暂无创作页" : "正在读取…"}</p>}{recent.map((item) => <Link key={item.id} className="fh-nav" to={`/canvas/${item.id}`} title={item.title}><FileText size={16} /><span>{item.title}</span></Link>)}</div>
            <footer><NavLink className="fh-nav" to="/config" title="设置"><Settings size={16} /><span>设置</span></NavLink><a className="fh-credit" href="https://github.com/hccnm/framedock" target="_blank" rel="noreferrer" title="FrameDock · hccnm / framedock"><span>FrameDock</span><small>开源项目 ↗</small></a></footer>
            {!collapsed && <div role="separator" tabIndex={0} aria-label="调整侧栏宽度" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={360} aria-valuenow={width} className="fh-resize" onDoubleClick={() => setWidth(264)} onKeyDown={(event) => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setWidth(Math.min(360, Math.max(220, width + (event.key === "ArrowRight" ? 8 : -8)))); } }} onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setWidth(Math.min(360, Math.max(220, event.clientX - (sidebarRef.current?.getBoundingClientRect().left ?? 0)))); }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)} />}
        </aside>}
        <div className={canvas ? "fh-workspace" : "fh-sheet"}>{canvas && <AppTopNav />}{pathname === "/" || pathname.startsWith("/projects") || pathname === "/plugins" ? <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm, token: { colorPrimary: "#000000", borderRadius: 8 } }}>{children}</ConfigProvider> : children}</div>
        {canvas && <AgentPanel />}
        {!canvas && <AppConfigModal />}
        <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm, token: { colorPrimary: "#000000", borderRadius: 8 } }}>
            <Modal title="搜索项目和创作页" open={searchOpen} onCancel={() => setSearchOpen(false)} footer={null} destroyOnHidden><Input autoFocus aria-label="全局搜索" placeholder="输入项目或创作页名称" value={query} onChange={(event) => setQuery(event.target.value)} /><div className="fh-search-results">{[...folders.map((item) => ({ id: `folder-${item.id}`, title: item.name, to: `/projects/${item.id}`, kind: "项目" })), ...projects.map((item) => ({ id: item.id, title: item.title, to: `/canvas/${item.id}`, kind: "创作页" }))].filter((item) => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map((item) => <Link key={item.id} to={item.to} onClick={() => setSearchOpen(false)}><span>{item.title}</span><small>{item.kind}</small></Link>)}{!folders.some((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && !projects.some((item) => item.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) && <p>没有匹配的项目或创作页</p>}</div></Modal>
        </ConfigProvider>
    </div>;
}
