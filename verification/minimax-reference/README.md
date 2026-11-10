# MiniMax Design 对照实现与验收

## 来源与覆盖

对照本机 `/Applications/MiniMax Design.app` 的实际 Skill 列表、详情和对话界面，并读取其本地市场目录。没有修改 MiniMax 的已安装技能或原始对话。

- 139 个技能：74 个官方精选、16 个用户精选、49 个其他技能。原始目录见 `catalog-source.json`。
- 227 个原版封面/示例媒体，约 3.14 GB，保存在 `web/public/skill-market/media/`；来源与文件映射见 `media.json`，ffprobe 格式检查和 SHA-256 见 `media-validation.json`。
- 139 个完整 ZIP 包，约 91 MB，保存在 `web/public/skill-market/packages/`；保留原文、脚本、参考资料和二进制资源。获取记录见 `packages.json`，完整性与尺寸见 `package-manifest.json`。
- 公共下载来源为 `https://design.minimax.io/api/v1/skills/market/download`，大包使用同产品国内入口 `https://design.minimax.cn/api/v1/skills/market/download`。目录是本次获取的快照，不代表持续云同步。

## 实现

Skill 页复刻分类、卡片、我的 Skill、搜索、详情媒体轮播及四栏说明，复用实际本地技能服务进行安装、启停、删除和编辑。安装完整资源包，并适配 `agents/openai.yaml` 的显示名及默认提示词；SKILL.md 与附属资源保留。安装状态取 FlowHarbor 本地状态，不沿用 MiniMax 的安装标记。下载数字保留来源快照，非 FlowHarbor 使用统计。

Agent 对话使用紧凑标题与历史菜单、圆角输入框、模型/技能/工具确认入口、可展开工具结果和消息复制。保留原有审批、错误处理、消息归属与历史逻辑；从技能页进入对话后等待连接及技能读取完成再选择技能。

## 已验证

- SkillStore 14 项测试通过，包括资源/二进制保留、路径越界/非法编码/覆盖拒绝与失败回滚。
- 139 个 ZIP 均通过 CRC 检查和隔离 SkillStore 全量导入，见 `package-validation.json`；该检查不经过 HTTP 大小限制。
- 前端 TypeScript 检查通过。未运行生产构建。
- 独立 localhost:3011 页面及 17379 隔离 Agent 服务：139 项目录渲染、搜索、我的 Skill、详情轮播、本地安装、停用刷新持久化、启用、创建入口和技能带入对话通过。
- 深色与 800px 窄屏已查看，窄屏页面没有横向溢出；合成消息排版和工具展开已查看，未提交模型请求。
- 227 个媒体通过格式读取及哈希检查；预览首屏视频可播放，未逐帧完整解码全部视频。

## 当前边界

- 经用户确认，仅 Skill 导入请求上限为 256 MB（含 base64 和 JSON 开销），其他接口仍为 30 MB。导入在大请求解析前校验权限；前端同步预检并分块编码资源。约 60.7 MB 的 `multilingual-hand-drawn-story-video` 请求通过隔离真实 HTTP 服务安装，37 个资源文件除界面元数据外逐字节一致；257 MB 返回 413 且目录不变，普通接口 31 MB 仍拒绝，未授权请求返回 401。见 `import-limit-validation.json`；重验时先运行 `start-test-agent.mts`，再运行 `check-import-limit.mts`，使用全新隔离目录。
- 原技能依赖的 MiniMax 专属工具、云端账号、付费模型和发布服务未接入；完整内容导入不等于执行能力相同。“管理 Skill”复用现有本地管理，不伪装云端贡献流程。
- 没有重新构建或重启真实 FlowHarbor 桌面应用，实际 Electron 打包、全部技能真实生成与用户视觉验收仍待完成。

## 截图

- `skills-desktop.png`：技能目录。
- `skill-detail.png`：原版示例与详情。
- `skills-dark.png`、`skills-narrow.png`：主题和窄屏。
- `agent-chat.png`：技能带入与选择器。
- `agent-chat-sample.png`：仅用于排版验证的合成消息，非模型真实执行结果。

复核命令：`canvas-agent/node_modules/.bin/tsx --test canvas-agent/src/skills/store.test.ts`、`canvas-agent/node_modules/.bin/tsx verification/minimax-reference/check-packages.mts`、`npm --prefix web run typecheck`。
