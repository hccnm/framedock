# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目上下文与现有指引

- 使用简体中文沟通。开发约束、画布 UI、文档更新和发布流程见 [AGENTS.md](AGENTS.md)，这里不重复。
- FrameDock 是基于 Infinite Canvas（MIT）的桌面创作工作台；保留上游归属信息。MiniMax Design 仅作为界面与交互参考。
- 优先阅读 [docs/desktop-rebase.md](docs/desktop-rebase.md) 和 [GLOSSARY.md](GLOSSARY.md)：**项目**是收纳多个**创作页**的容器，创作页拥有画布与相关对话。代码中沿用的 `CanvasProject` / `projects` 通常对应创作页，`projectFolders` 对应项目容器。
- README 后半部、Agent/插件 README 和文档站保留了上游说明，部分已与桌面实现不同，尤其是数据目录、密钥保存、CLI 要求及远程插件安装。修改相关能力前以源码核对当前行为；不要把上游历史说明当作 FrameDock 首版承诺。

## 开发命令

以下从仓库根目录执行，另有说明的除外。根包要求 Node.js >=22；前端测试另需 Bun。各子目录独立管理依赖，根包通过 `npm --prefix` 编排，并非 npm workspace。

| 用途 | 命令 | 说明 |
| --- | --- | --- |
| 安装应用依赖 | `npm run setup` | 安装 web、Agent、desktop、插件 SDK 和五个随包插件；web 使用 `npm ci --legacy-peer-deps` 处理现有 Ant Design peer 冲突。不包含 docs。 |
| 启动完整桌面应用 | `npm start` | 先构建 Agent、插件、web，再编译并启动 Electron；修改源码后重新执行才更新静态桌面资源。 |
| 前端热开发 | `npm run dev` | Vite，默认端口 3000；只启动 web，不启动 Electron 或 Agent。 |
| 完整应用构建 | `npm run build` | 顺序构建 Agent、插件、web、desktop；不生成安装包。 |
| 构建随包插件 | `sh script/build-plugins.sh` | 构建 markdown、svg、html、panorama、sticky-note，产物供 web 使用。 |
| Agent 源码运行 | `npm --prefix canvas-agent run dev` | tsx 直接执行源码，无自动 watch；`run debug` 开启调试。 |
| Agent 构建 | `npm --prefix canvas-agent run build` | TypeScript 编译到 `canvas-agent/dist`。 |
| 仅启动桌面壳 | `npm --prefix desktop start` | 只编译 desktop；默认需要已有 web 与 Agent 产物。 |
| 浏览器可选代理 | `npm --prefix canvas-proxy start` | 默认回环端口 23210；桌面不依赖此进程。 |
| 前端类型检查 | `npm --prefix web run typecheck` | 独立于 Vite 构建，`web build` 不执行类型检查。 |
| 前端格式检查 | `npm --prefix web run format:check` | Prettier；`format` 会改写整个 web，避免为局部修改顺手运行。 |
| 前端测试 | `npm --prefix web test` | Bun 测试运行器，测试位于 `web/tests/`。 |
| Agent 测试 | `npm --prefix canvas-agent test` | tsx + Node 测试运行器，脚本显式列举测试文件；新增测试需更新列表。 |
| 桌面文件存储测试 | `node --test desktop/tests/storage-files.test.mjs` | 直接读取源码，无需构建；Node 需支持 `node:module.stripTypeScriptTypes`。 |
| 插件 SDK 类型检查 | `npm --prefix plugins/canvas/sdk run typecheck` | 插件子包也提供 `typecheck`。 |

单文件测试分别在对应子包目录执行：

```bash
bun test ./tests/model-selection.test.ts
```

```bash
npx tsx --test src/canvas/operations.test.ts
```

根目录没有统一的 test、lint 或 typecheck 脚本；web 没有 lint 脚本，格式检查不等于 lint。按 AGENTS.md，常规改动后无需自动执行语法检查或构建；这里记录命令供明确需要时使用。

Electron 接前端热开发时，先启动 `npm run dev`，并准备 Agent 和插件构建产物，再运行：

```bash
FRAMEDOCK_DEV_URL=http://localhost:3000 npm --prefix desktop start
```

文档站独立安装和运行：`npm --prefix docs install`、`npm --prefix docs run dev`、`npm --prefix docs run build`、`npm --prefix docs run types:check`。其开发端口也默认 3000，与 web 同时运行时需另指定端口。

## 核心架构

### 共享前端与画布状态

`web/src/main.tsx → AppProviders → router.tsx → UserLayout` 组成共享 SPA；Electron 复用同一套 web。`/projects/:id` 展示项目容器，`/canvas/:id` 才是创作页编辑器。

`web/src/pages/canvas/project.tsx` 协调节点、连线、选区、视口、撤销重做和生成；`InfiniteCanvas` 负责画布输入与平移缩放。**打开的创作页以页面 React 状态为编辑真源**，再将快照写回 `stores/canvas/use-canvas-store.ts`。后台任务修改节点应经过 `lib/canvas/canvas-project-bridge.ts`；直接改 store 会被打开页面的旧快照覆盖。

生成链路由页面合并节点与全局模型配置，使用 `lib/canvas/` 的生成/资源引用工具解析上游连线输入，再调用 `services/api/`。图片、视频、音频和 ComfyUI 复用现有服务；视频和 ComfyUI 可按已保存的任务 ID 恢复。媒体的 `storageKey` 是持久引用，`blob:` URL 是运行时展示地址，恢复项目时需要重新解析。`services/api/model-plugin.ts` 的模型调用脚本与画布节点插件是两套扩展机制。

### Electron、存储与请求转发

`desktop/src/main.ts` 注册稳定的 `app://framedock/` origin，提供 `web/dist` 静态文件、SPA 回退和外部请求转发，并管理 Agent sidecar。`preload.ts` 通过 `window.canvasDesktop` 暴露连接信息与受限存储接口；渲染层不直接访问 Node、任意文件路径或进程。

存储按环境分流，入口为 `web/src/lib/desktop-host.ts`、`localforage-storage.ts` 和媒体存储工具：

- 浏览器业务状态主要写 localforage 的 `framedock/app_state`；媒体另存 Blob。`use-config-store.ts` 保存浏览器配置时会剔除 AI Key、渠道 Key 和 WebDAV 密码，这些凭据当前仅保留在内存中。
- 桌面业务状态和媒体通过 preload/IPC 写入 Electron userData 下的 `storage/`；配置由 `desktop/src/storage-files.ts` 以普通 JSON 写入 `storage/config.json`，API Key 和 WebDAV 密码明文保存，不依赖系统钥匙串；配置读取失败时停止覆盖。旧 `config.encrypted` 保留但不读取或自动迁移。
- 仍有直接使用 localforage 的插件私有存储和工作台日志，以及少量 localStorage 配置；不要假定所有桌面数据都已转成文件。
- Agent 配置、日志、技能与对话另由 Agent 管理，使用 `~/.framedock/`，不等同于 Electron userData 或画布快照中的 `chatSessions`。

外部服务请求仍集中在 `web/src/services/api/`。浏览器默认直连用户配置的服务，可选 `canvas-proxy/`；桌面 `withLocalProxy` 将请求改为 `app://framedock/proxy/<encoded-url>`，交给 `desktop/src/proxy.ts` 转发。Agent HTTP/SSE 则连接本机回环 sidecar。WebDAV 是用户配置并触发的同步入口，不能描述为自动云同步或完整同步所有本地状态。

### Agent 与画布工具闭环

`desktop/src/sidecar.ts` 用 Electron 的 Node 模式启动 `canvas-agent/dist/index.js`，选择回环端口、轮换连接 token，并在健康检查通过后打开窗口。浏览器开发则需单独运行 Agent 并连接。

当前内置助手走 `/agent/api/*`，使用前端配置的文本模型渠道，由 `canvas-agent/src/agent/api.ts` 通过 AI SDK 调用模型，无需安装模型 CLI。继承的 Codex app-server、Claude CLI 适配器是额外路径；不要把它们当成内置助手的启动前提。

工具输入契约集中在 `canvas-agent/src/canvas/schemas.ts`，由 API 助手和 MCP 共用。主要链路：

1. `CanvasSession` 校验工具输入，读取快照或由 `operations.ts` 生成画布 ops。
2. Agent 通过 SSE `/events` 发出 `tool_call`。
3. `web/src/components/agent/local-agent-panel.tsx` 接收调用，经 `pages/canvas/hooks/use-agent-bridge.ts` 在前端执行修改或调用页面生成函数。
4. 前端 POST `/canvas/result` 返回结果，POST `/canvas/state` 更新快照。

因此画布修改、生成和持久化仍由 web 完成。调整工具时需同时核对 Agent schema/operations、前端 bridge 和两端协议；消息归属与存储版本约束见 AGENTS.md。`node canvas-agent/dist/index.js mcp` 只启动 stdio MCP 转发器，需已有运行中的 HTTP Agent。

### 随包画布插件

`plugins/canvas/sdk/` 定义插件契约与构建工具。SDK 从 `window.InfiniteCanvasRuntime` 取得宿主 React；公共 types 与 `web/src/types/canvas-plugin.ts` 是手工镜像，修改契约需同步两端。

插件构建产物复制到 `web/public/plugins/` 并更新 `index.json`。前端 loader 注册节点定义，`use-plugin-host.tsx` 和 `plugin-node-context.ts` 提供画布读写、生成、主题和存储能力。当前只执行随包清单允许的规范插件路径，插件与宿主运行在同一页面上下文；上游 README 的任意 URL 安装和 `VITE_DEV_PLUGINS` 说明不代表当前可用能力。

### 文档站

`docs/` 是独立 Next.js + Fumadocs 应用，采用 standalone 服务输出，搜索和 LLM 文本路由需要服务运行。`source.config.ts` 定义 MDX 内容源，`src/lib/source.ts` 加载 `content/docs/`；默认英文文件与 `.zh-CN.mdx` 文件按语言解析。AI 文档索引为 `docs/index.md`；功能、待办、待测试和 CHANGELOG 的更新规则见 AGENTS.md。
