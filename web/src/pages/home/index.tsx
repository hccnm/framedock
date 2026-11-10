import { useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { App, Button, Dropdown, Input, Modal, Select, theme } from "antd";
import { ChevronRight, FolderOpen, Info, MoreHorizontal, Plus, Search } from "lucide-react";
import { CanvasProjectPreview } from "@/components/canvas/canvas-project-preview";
import "./home.css";
import { flushCanvasStorage, normalizeProjectName, useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { desktopBridge, isDesktopHost } from "@/lib/desktop-host";

export default function HomePage() {
    const store = useCanvasStore();
    const { modal, message } = App.useApp();
    const { token } = theme.useToken();
    const [directory, setDirectory] = useState<string | null>(null);
    const [selecting, setSelecting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [busy, setBusy] = useState(false);
    const perform = async (task: () => Promise<unknown>) => {
        if (busy) return;
        setBusy(true);
        try { await task(); } catch (cause) { void message.error(cause instanceof Error ? cause.message : String(cause)); }
        finally { setBusy(false); }
    };
    const navigate = useNavigate();
    const { id } = useParams();
    const { pathname } = useLocation();
    const foldersView = pathname === "/projects";
    const storageLocation = isDesktopHost() ? "本机应用数据目录" : "当前浏览器";
    const folder = store.projectFolders.find((item) => item.id === id);
    const [search, setSearch] = useState("");
    const [sort, setSort] = useState("updatedAt");
    const [editor, setEditor] = useState<{ kind: "folder" | "page"; id?: string } | null>(null);
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const [assignId, setAssignId] = useState<string | null>(null);
    const submitted = useRef(false);
    const nameEdited = useRef(false);
    const creatingFolder = editor?.kind === "folder" && !editor.id;
    const openEditor = (kind: "folder" | "page", itemId?: string, title = "") => { submitted.current = false; nameEdited.current = false; setDirectory(null); setName(title); setError(""); setEditor({ kind, id: itemId }); };
    const selectDirectory = async () => {
        if (selecting || saving) return;
        setSelecting(true);
        setError("");
        try {
            const selected = await desktopBridge()!.projects.selectDirectory();
            if (selected) {
                setDirectory(selected);
                if (!nameEdited.current) setName(normalizeProjectName(selected.split(/[\\/]/).filter(Boolean).pop() || selected));
            }
        } catch (cause) { setError(cause instanceof Error ? cause.message : "选择目录失败，请重试"); }
        finally { setSelecting(false); }
    };
    const submit = async () => {
        if (!editor || submitted.current || selecting) return;
        submitted.current = true;
        setSaving(true);
        try {
            const title = normalizeProjectName(name);
            if (editor.kind === "folder") {
                if (editor.id) store.renameProjectFolder(editor.id, title);
                else {
                    const newId = directory ? await store.createDirectoryFolder(title, directory) : store.createProjectFolder(title);
                    navigate(`/projects/${newId}`);
                }
            } else if (editor.id) store.renameProject(editor.id, title);
            else { const newId = store.createProject(title, folder?.id ?? null); navigate(`/canvas/${newId}`); }
            setEditor(null);
        } catch (cause) { submitted.current = false; setError(cause instanceof Error ? cause.message : "操作失败，请重试"); }
        finally { setSaving(false); }
    };
    const onEnter = (event: KeyboardEvent<HTMLInputElement>) => { if (!event.nativeEvent.isComposing) submit(); };
    const dissolve = (folderId: string, title: string) => modal.confirm({
        title: "解散项目", content: `将解散项目「${title}」。项目下的创作页会保留，仅取消归类。`, okText: "解散项目", cancelText: "取消", okButtonProps: { danger: true },
        onOk: () => { store.dissolveProjectFolder(folderId); if (id === folderId) navigate("/projects"); },
    });
    const items = (foldersView ? store.projectFolders.map((item) => ({ ...item, title: item.name })) : store.projects.filter((item) => !id || item.projectFolderId === id))
        .filter((item) => item.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
        .sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, undefined, { numeric: true }) : (sort === "createdAt" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt)));

    if (!store.hydrated) return <div className="fh-empty" role={store.saveError ? "alert" : "status"}>{store.saveError ?? "正在读取本地创作…"}</div>;
    if (id && !folder) return <div className="fh-empty"><h1>项目不存在</h1><Link to="/projects">返回项目库</Link></div>;
    return <main className="fh-library">
        <header className="fh-hero">
            {folder && <div className="fh-breadcrumb"><Link to="/projects">项目库</Link><ChevronRight size={14} /><span>{folder.name}</span><Dropdown menu={{ items: [{ key: "rename", label: "重命名", onClick: () => openEditor("folder", folder.id, folder.name) }, { key: "delete", label: "解散项目", danger: true, onClick: () => dissolve(folder.id, folder.name) }] }} trigger={["click"]}><button className="fh-icon" aria-label="项目操作"><MoreHorizontal size={18} /></button></Dropdown></div>}
            <h1>{folder?.name ?? (foldersView ? "项目库" : "开始创作")}</h1>
            <p>{folder ? `创作页保存在${store.directoryLocations.find((item) => item.id === folder.id)?.directory ?? storageLocation}，可随时继续创作。` : foldersView ? "整理创作页面、管理项目资产，集中呈现项目内容" : "从一张画布开始，让文字、图像、音频与视频在这里相遇。"}</p>
            <div className="fh-actions"><Button type="primary" icon={<Plus size={16} />} onClick={() => openEditor(foldersView ? "folder" : "page")}>{foldersView ? "新建项目" : "新建创作页"}</Button>{!foldersView && !folder && <Button onClick={() => navigate("/projects")}>浏览项目库</Button>}{isDesktopHost() && <Button disabled={busy} icon={<FolderOpen size={16} />} onClick={() => void perform(async () => { const route = await store.openProjectDirectory(); if (route) navigate(route); })}>打开项目目录</Button>}{isDesktopHost() && folder && <Button disabled={busy} onClick={() => void perform(async () => { if (await store.saveProjectDirectory(folder.id)) void message.success("项目已另存到目录"); })}>另存到目录</Button>}</div>
            {store.saveError && <p role="alert">保存失败：{store.saveError} <Button size="small" onClick={() => void perform(flushCanvasStorage)}>重试保存</Button></p>}
        </header>
        <section className="fh-content">
            <div className="fh-toolbar"><span className="fh-tab">{foldersView ? "本地项目" : folder ? "创作页" : "全部创作页"}</span><Input aria-label={foldersView ? "搜索项目" : "搜索创作页"} placeholder={foldersView ? "搜索项目" : "搜索创作页"} prefix={<Search size={14} />} value={search} onChange={(event) => setSearch(event.target.value)} allowClear /><Select aria-label="排序方式" value={sort} onChange={setSort} options={[{ value: "updatedAt", label: "最近更新" }, { value: "createdAt", label: "最近创建" }, { value: "title", label: "字母顺序" }]} /></div>
            {items.length ? <div className="fh-grid">{items.map((item) => <article key={item.id} className={foldersView ? "fh-folder" : "fh-page"}>
                <button className="fh-card-open" onClick={() => navigate(foldersView ? `/projects/${item.id}` : `/canvas/${item.id}`)} aria-label={`打开${item.title}`}>
                    {foldersView ? <div className="fh-cover"><div className="fh-folder-paper" /><FolderOpen size={30} strokeWidth={1.2} /></div> : <CanvasProjectPreview nodes={"nodes" in item ? item.nodes : []} />}
                    <div className="fh-card-caption"><h2>{item.title}</h2><p>{foldersView ? `${store.projects.filter((page) => page.projectFolderId === item.id).length} 个创作页 · ` : ""}{new Date(item.updatedAt).toLocaleDateString("zh-CN")}</p></div>
                </button>
                <Dropdown trigger={["click"]} menu={{ items: [
                    { key: "rename", label: "重命名", onClick: () => openEditor(foldersView ? "folder" : "page", item.id, item.title) },
                    ...(isDesktopHost() ? [{ key: "save-directory", label: "另存到目录", onClick: () => void perform(async () => { if (await store.saveProjectDirectory(item.id)) void message.success("项目已另存到目录"); }) }] : []),
                    ...(foldersView ? [{ key: "delete", label: "解散项目", danger: true, onClick: () => dissolve(item.id, item.title) }] : [
                        { key: "assign", label: "添加 / 移动到项目", onClick: () => setAssignId(item.id), disabled: !store.projectFolders.length },
                        ...(store.projects.find((page) => page.id === item.id)?.projectFolderId ? [{ key: "remove", label: "移出项目", onClick: () => store.assignProjectFolder(item.id, null) }] : []),
                        { key: "delete", label: "删除创作页", danger: true, onClick: () => modal.confirm({ title: "删除创作页", content: `将删除「${item.title}」及其中的画布内容，此操作无法撤销。`, okText: "删除", cancelText: "取消", okButtonProps: { danger: true }, onOk: () => store.deleteProjects([item.id]) }) },
                    ]),
                ] }}><button className="fh-card-menu fh-icon" aria-label={`${item.title}的操作`}><MoreHorizontal size={16} /></button></Dropdown>
            </article>)}</div> : <div className="fh-empty"><FolderOpen size={56} strokeWidth={1} /><h2>{search.trim() ? "没有匹配的结果" : foldersView ? "暂无本地项目" : "暂无创作页"}</h2><p>{search.trim() ? "换个关键词试试。" : foldersView ? "创建项目，整理你的创作。" : "创建创作页即可开始。"}</p>{!search.trim() && <Button onClick={() => openEditor(foldersView ? "folder" : "page")}>{foldersView ? "新建项目" : "新建创作页"}</Button>}</div>}
        </section>
        <Modal title={creatingFolder ? <span className="flex items-center gap-3"><FolderOpen size={20} />新建本地项目</span> : `${editor?.id ? "重命名" : "新建"}${editor?.kind === "folder" ? "项目" : "创作页"}`} width={creatingFolder ? 600 : 520} open={!!editor} onCancel={() => { if (!saving && !selecting) setEditor(null); }} onOk={submit} okText={editor?.id ? "保存" : creatingFolder ? "创建项目" : "创建"} cancelText="取消" confirmLoading={saving} cancelButtonProps={{ disabled: saving || selecting }} okButtonProps={{ disabled: !name.trim() || selecting }} destroyOnHidden afterOpenChange={(open) => { if (open) document.getElementById("fh-name")?.focus(); }}>
            <div style={creatingFolder ? { marginTop: 24, borderRadius: 14, overflow: "hidden", background: token.colorFillAlter } : undefined}>
                {!creatingFolder && <label htmlFor="fh-name">{editor?.kind === "folder" ? "项目名称" : "创作页名称"}</label>}
                <Input id="fh-name" aria-label={editor?.kind === "folder" ? "项目名称" : "创作页名称"} className={creatingFolder ? undefined : "fh-name"} style={creatingFolder ? { height: 56, borderRadius: 14, fontSize: 16, paddingInline: 16 } : undefined} disabled={saving || selecting} value={name} onChange={(event) => { nameEdited.current = true; setName(event.target.value); }} onPressEnter={onEnter} placeholder={editor?.kind === "folder" ? "例如：春日短片" : "为这次创作取个名字"} />
                {creatingFolder && <div className="flex items-center gap-2 px-4 py-3" style={{ color: token.colorTextSecondary }}>
                    <FolderOpen size={18} className="shrink-0" /><span className="shrink-0">保存位置</span><span className="min-w-0 flex-1 truncate" title={directory ?? storageLocation}>{directory ?? storageLocation}</span>
                    {isDesktopHost() && <Button type="link" className="shrink-0" style={{ padding: 0 }} loading={selecting} disabled={saving} onClick={() => void selectDirectory()}>更改</Button>}
                </div>}
            </div>
            {creatingFolder ? <div className="mt-5 mb-6 flex items-start gap-3 rounded-xl p-4" style={{ background: token.colorFillAlter, color: token.colorTextSecondary, lineHeight: 1.8 }}><Info size={18} className="mt-1 shrink-0" /><p className="m-0">本地项目用于整理创作页面。可以按作品、主题或任务创建项目，将相关页面归入其中，集中查看和管理创作页与资产。项目内容不会自动与其他设备或用户共享。{directory && "可以选择已有作品目录，剧情和素材保持原位；FrameDock 数据单独保存到 .framedock 子目录。"}</p></div> : <p className="fh-note">{editor?.kind === "folder" ? `本地项目用于整理创作页面，不会自动与其他设备或用户共享。` : "名称最多 50 个字符。创作页使用独立画布，支持现有多模态功能。"}</p>}
            {error && <p role="alert" style={{ color: token.colorError }}>{error}</p>}
        </Modal>
        <Modal title="移动到项目" open={!!assignId} footer={null} onCancel={() => setAssignId(null)}><div className="fh-project-picker">{store.projectFolders.map((item) => <Button key={item.id} icon={<FolderOpen size={16} />} onClick={() => { if (assignId) store.assignProjectFolder(assignId, item.id); setAssignId(null); }}>{item.name}</Button>)}</div></Modal>
    </main>;
}
