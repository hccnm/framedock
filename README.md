# FrameDock

面向 AI 创作的开源桌面工作台。

[核心功能](#核心功能) · [快速开始](#快速开始) · [使用文档](#使用文档) · [问题反馈](https://github.com/hccnm/framedock/issues)

FrameDock 将无限画布、AI 生成、对话助手和素材管理整合到同一个创作空间。你可以围绕一个项目组织多个创作页，将提示词、参考素材和生成结果通过节点串联，用于视觉探索、角色设计、分镜编排和内容制作。

项目与媒体保存在本机，模型服务由用户自行配置，可接入 API 服务或自建 ComfyUI 工作流。

> 项目处于开发阶段，功能与数据格式仍可能调整，建议定期备份重要作品。

## 核心功能

- **无限画布**：自由编排文本、图片、视频和音频，通过连线组织输入与结果，支持分组、缩放和撤销重做。
- **多模态生成**：接入自己的模型渠道，完成文本生成、图片创作、参考图编辑、视频与音频生成；具体能力取决于所选模型和服务。
- **创作助手**：通过对话读取画布、组织节点并调用生成工具，支持技能辅助创作；内置助手随桌面应用启动，无需额外安装模型 CLI，也可选用本机 Codex CLI。
- **ComfyUI 工作流**：导入 API 格式工作流、配置参数与参考素材，在画布或图像、视频工作台中运行。
- **项目与素材管理**：按项目收纳多个创作页，集中管理导入和生成的素材，保存创作上下文。
- **技能与插件**：管理助手技能，启用随应用提供的画布插件，扩展创作方式与节点类型。

## 快速开始

### 环境要求

- Node.js 22 或更新版本（含 npm）
- Git
- 可用的模型 API 服务；使用 ComfyUI 时需另行准备对应服务和工作流依赖

### 从源码启动

克隆仓库：

```bash
git clone https://github.com/hccnm/framedock.git
```

进入项目目录：

```bash
cd framedock
```

安装依赖：

```bash
npm run setup
```

启动桌面应用：

```bash
npm start
```

启动命令会构建所需组件并打开 Electron 桌面应用，同时启动本地助手服务。

### 开始创作

1. 在设置中添加模型服务地址与 API Key，选择需要使用的模型。
2. 创建项目和创作页，导入参考素材或添加文本节点。
3. 通过画布连线配置生成任务，或向创作助手描述需求，在画布中查看和整理结果。

桌面配置以本地 JSON 文件保存，API Key 和 WebDAV 密码为明文，请妥善保管配置文件。调用模型服务时，相关提示词和素材会发送至所配置的服务，费用由服务提供方收取。

### 前端开发

安装依赖后，可单独启动前端热开发服务：

```bash
npm run dev
```

此模式仅启动前端，不启动 Electron 或本地助手服务。修改源码后，重新执行 `npm start` 可构建并运行更新后的桌面版。

## 使用文档

- [画布节点操作手册](docs/content/docs/canvas/canvas-node-manual.zh-CN.mdx) · [画布快捷键](docs/content/docs/canvas/canvas-shortcuts.zh-CN.mdx)
- [项目术语](GLOSSARY.md)
- [更新日志](CHANGELOG.md)
- [macOS 打包与发布](desktop/RELEASING.md)
- [开发计划](docs/content/docs/progress/todo.mdx) · [待验证事项](docs/content/docs/progress/pending-test.mdx)
- [参与贡献](CONTRIBUTING.md) · [问题反馈与功能建议](https://github.com/hccnm/framedock/issues)
- [安全问题报告](SECURITY.md)

## 开源协议

FrameDock 基于 [Infinite Canvas](https://github.com/basketikun/infinite-canvas) 开发，采用 [MIT License](LICENSE)。
