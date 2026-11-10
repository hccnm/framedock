import { App } from "antd";
import { ConfigComfyUi } from "@/components/layout/config-comfyui";
import "../extensions.css";

export default function WorkflowsPage() {
    return <main className="fh-library fh-extension-page">
        <header className="fh-hero"><h1>工作流</h1><p>连接 ComfyUI，导入工作流并配置画布使用的参数。</p></header>
        <section className="fh-content"><p className="fh-extension-hint">导入 ComfyUI 导出的 API Format JSON，编辑并测试后，可在画布中添加 ComfyUI 节点运行。这里与设置页共用同一份配置。</p><App><ConfigComfyUi /></App></section>
    </main>;
}
