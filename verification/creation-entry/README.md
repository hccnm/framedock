# 开始创作与 Agent 选择验收

开始创作页对照用户提供的 MiniMax 截图，复用项目现有技能目录、媒体和输入框。CLI 接入参考 [OpenDesign 的运行时注册、检测与启动参数设计](https://github.com/vustudio/opendesign/blob/main/apps/daemon/src/agents.ts)，沿用 FlowHarbor 已有的 Codex app-server、SSE、消息归属和画布 MCP 适配，没有复制其整套多 CLI 引擎。

## 已验证

- 38 项相关测试通过：`canvas-agent` 中执行 `./node_modules/.bin/tsx --test src/server/engine.test.ts src/runtime/registry.test.ts src/canvas/session.test.ts src/agent/api.test.ts`。新增 HTTP 测试覆盖鉴权、非法引擎、CLI 启动失败保护、API/CLI 切换与历史恢复、运行互斥、停止和新连接跟随当前引擎。
- 独立浏览器页面连接 `start-fixture.mts` 的隔离服务，首页提交后新建画布及对话；模拟模型只收到一次请求，用户消息与助手回复各一条。
- 在输入框切到模拟 Codex 后，模型来自 `/agent/codex/models`；切回内置 Agent 后恢复原线程和消息，未重复合并历史。
- 首页 Agent 设置可打开既有配置弹窗的「本机 CLI」页签，显示隔离 CLI 的真实检测路径与版本。
- 桌面及 375px 窄屏已查看；窄屏文档宽度为 375px、内容区无横向溢出，截图保存在本目录 `desktop.png` 与 `mobile.png`。

## 复验与范围

前端开发服务使用 3011 端口，执行 `./canvas-agent/node_modules/.bin/tsx verification/creation-entry/start-fixture.mts` 启动 17381 隔离 Agent 与 17382 模拟模型。测试 Agent 使用临时用户目录及模拟 CLI，不读取用户模型凭据，也不调用真实模型。

未运行类型检查、生产构建或重启用户 Electron。真实 Codex 登录、实际模型输出、画布工具执行以及图片/技能随首条需求带入仍待验收；其他本地 CLI 适配器保留在 TODO。入口与协议已接通不代表 MiniMax 专属工具或全部技能依赖可直接运行。
