# 桌面启动与恢复验收结果

结论：本机真实 Electron 的 3 项导航退出回归、1 项故障清理回归、9 项完整 E2E 检查全部通过，脚本退出码 0。最终核对测试进程与临时数据目录均无残留。使用当前 production renderer、真实 preload、文件存储与 Agent sidecar，在独立 home / appData 内执行；没有模拟 HTTP 响应，没有读取用户密钥，也没有关闭或重启用户原有实例。

## 启动提示

两次冷启动均捕获到：

```text
sysctlbyname for kern.hv_vmm_present failed with status -1
```

两次窗口都实际显示，Agent 健康检查与鉴权技能接口均返回 200，后续交互和重启恢复成功。这条系统探测提示在当前环境中不是致命启动错误；本次保留原日志，没有通过隐藏日志、关闭 GPU 或调整系统设置处理。

## 实际修复

`desktop/src/main.ts` 原先在 `did-start-loading` 中清除 `closeReady`。Electron 的页面内路由也触发该事件，但同一文档不会重建 preload 保存监听，导致关闭窗口持续被阻止。

本轮审查进一步发现：`did-start-navigation` 早于 `will-navigate` 安全拦截，外部导航被取消时仍会清除就绪标记。现改为在 `did-navigate`（主文档实际完成导航）时重置；被拦截的导航和页面内切换保留原监听，真正刷新后仍重新建立握手。保存失败时保持产品窗口、安全隔离和 sidecar 正常退出流程继续使用原逻辑。

验收脚本新增共享 `finish-run.mjs`：先写本轮结果，再等待正常退出 5 秒；失败则标记 `cleanup.forced`、校验本轮测试入口并终止隔离进程组，最多再等待 5 秒。结果在清理前后分别落盘；POSIX 下正常退出后也结束本轮同组 CLI 探测子进程，防止 npm 缓存在删除后重建测试目录。确认清理完成后才删除测试目录；清理异常记录 `cleanup.error`。这些时间限制只用于测试收尾，不改变产品行为。

- 修复前：从首页进入项目库后关闭窗口，30 秒内未退出；日志见 `lifecycle-before.txt`。
- 修复后：相同真实操作收到 `flowharbor:close-result` 并正常退出；日志见 `lifecycle-after.txt`。
- 本轮导航边界修复前：页面切换与刷新通过，被拦截导航后退出超时；失败报告成功落盘且隔离实例已清理。结果见 `artifacts/review-before/`。
- 本轮修复后：`route`、`blocked`、`reload` 三个真实 Electron 场景全部完成保存握手并正常退出，结果见 `artifacts/lifecycle-{route,blocked,reload}/results.json`。
- 清理回归：在真实隔离窗口注入 `close` 事件阻塞，断言等待退出前已经覆盖旧成功报告，5 秒后只结束本轮进程组及 sidecar。测试本身通过；`artifacts/cleanup/results.json` 的 `passed: false` 是预期注入的失败，`cleanup.forced: true` 且无 `cleanup.error`，sidecar 健康端点已不可访问。
- 完整流程再次通过真实 `BrowserWindow.close()` 验证退出前保存，并检查退出后原 sidecar 健康端点不可访问。

## 已通过的真实流程

| 验收项 | 观察结果 |
| --- | --- |
| 冷启动 | 独立目录断言通过，实际窗口可见，preload 可用 |
| Agent | 真实 `/health` 与带本轮令牌的 `/agent/api/skills` 均返回 200 |
| 新建 | 经界面创建「桌面 E2E 项目」与「冷启动与恢复」创作页 |
| 编辑与导入 | 经文本编辑器写入正文，经文件输入导入真实 96×64 PNG，图片解码成功 |
| 自动保存 | 经真实桌面存储桥读取到包含正文与两个节点的持久化状态后，才执行刷新 |
| 刷新恢复 | 文本和图片重新显示 |
| 退出前保存 | 再次编辑为「真实 Electron 端到端：退出前追加，重启后保留。」后立即关闭窗口，保存握手完成 |
| 退出清理 | Electron 正常退出，原 sidecar 健康端点不可访问 |
| 重启恢复 | 复用同一测试目录，经项目库打开原项目及创作页，最新文字和 PNG 保留，页面 ID 不变 |
| 令牌轮换 | 两次启动令牌不同，令牌未写入报告 |
| 技能页 | 经返回项目库与侧栏进入技能页，显示「3D动画短片」随包技能 |
| 运行错误 | 渲染异常 0、控制台 error 0、HTTP 4xx/5xx 0 |

此前“刷新丢失”的判断已撤回：早期脚本未可靠等待异步保存，随后又将侧栏摘要和画布正文同时匹配，造成测试失败。改用明确布尔落盘断言、稳定节点 ID 与画布范围定位后，刷新与重启恢复通过；未据此修改前端持久化源码。

## 证据与复跑

- `artifacts/results.json`：本次结构化结果，`passed: true`。
- `artifacts/run.txt`：最终完整 E2E 成功运行的脱敏控制台输出。
- `artifacts/review-after.txt`：三项导航回归与故障清理回归的成功输出。
- `artifacts/cleanup-test.txt`：故意阻塞退出时，报告及隔离进程清理回归的通过结果。
- `artifacts/01-cold-start.png`：实际启动首页。
- `artifacts/02-text-edited.png`：真实文字编辑。
- `artifacts/03-image-imported.png`：PNG 导入。
- `artifacts/04-restarted-canvas.png`：重启后的最新文字与图片。
- `artifacts/05-skills.png`：技能页面。

运行方式见 [README.md](README.md)。前轮完整构建通过；本轮只重新编译已修改的 desktop，编译成功，并复用前轮未改动的生产前端与 Agent 构建产物。Vite 的分包与 chunk 大小警告仍存在，不影响本次已验证流程。`artifacts/review-after.txt` 保存本轮三组验证的完整成功输出，`artifacts/cleanup-test.txt` 保存故障清理测试通过结果。全部本轮隔离测试数据目录已清理；`results.json` 的 `profileRemoved: true` 表示记录的测试路径已删除。本轮只启动和清理独立测试实例，未操作用户实例。

## 未验证范围

- 原生项目目录选择、打开与另存；本次取消目录绑定，使用应用数据目录。
- 大媒体项目、系统钥匙串与真实凭据重启恢复。
- 内置 API 助手的真实模型调用、Codex CLI 登录与工具调用闭环。
- ComfyUI / GPU 生成以及其他待测试功能。
- Windows / Linux：本次真实运行环境为 macOS，跨平台启动及清理分支没有实机验证。

以上不计入本次通过范围；本次没有发起模型或 GPU 任务，没有新增产品超时、重试或存储边界。
