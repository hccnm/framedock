# 真实 Electron 启动与恢复验收

使用 Playwright 的 Electron 驱动运行当前 `desktop/dist/main.js`、生产前端与真实 Agent sidecar。测试入口仅设置独立 home / appData，不修改安全设置、业务代码、HTTP 响应或用户现有实例。测试不使用用户模型配置，不发起模型或 GPU 生成。

从项目根目录先构建：

```bash
npm run build
```

若当前 Node 能解析 `playwright-core`，直接执行：

```bash
node verification/desktop-startup/check.mjs
```

也可通过 `PLAYWRIGHT_CORE_PATH` 指向本机已安装的 `playwright-core/index.mjs` 后运行同一命令，无需给产品增加依赖。默认产物保存在 `verification/desktop-startup/artifacts/`；`FLOWHARBOR_E2E_OUTPUT` 可设置证据输出目录。每轮测试创建独立临时数据目录，在 `results.json` 中记录路径，测试结束只关闭本轮启动的应用。先写结果，再等待正常退出 5 秒；失败则将验收标为失败，只终止已校验的本轮测试进程组（Windows 使用对应进程树），最多再等待 5 秒，POSIX 下同时结束 sidecar；正常退出后也收尾同组 CLI 探测子进程，防止它们重建测试缓存。确认退出后删除测试目录并记录 `profileRemoved: true`；未能清理时记录 `cleanup.error` 并保留目录，避免删除仍在使用的数据。测试目录中的 Agent 配置含随机测试令牌，不应分享整个目录。

验收通过真实页面交互覆盖：窗口可见与 preload、真实 Agent 健康检查与鉴权技能读取、新建项目与创作页、文本编辑、PNG 文件导入、真实落盘后刷新恢复、再次编辑后立即退出、sidecar 清理、应用重启恢复最新编辑及连接令牌轮换、技能页面加载。结果文件保存断言结果、异常信息、错误来源路径、状态码与目标系统提示，不保存令牌或请求头。

关闭生命周期回归可单独执行：

```bash
node verification/desktop-startup/lifecycle.mjs
```

它分别验证页面切换、外部导航被安全策略拦截、主文档刷新后的保存握手与窗口退出；结果保存在 `artifacts/lifecycle-{route,blocked,reload}/results.json`。`lifecycle-before.txt` 与 `lifecycle-after.txt` 是首次页面切换修复的历史结果；`artifacts/review-before/` 保留本次导航边界修复前的失败证据。这些脚本同样支持 `PLAYWRIGHT_CORE_PATH`。

清理失败回归会在独立真实窗口中注入关闭阻塞，检查旧成功报告被本轮失败替换，并确认强制清理后 sidecar 不再响应：

```bash
node --test verification/desktop-startup/cleanup.test.mjs
```

`artifacts/cleanup/results.json` 中的 `passed: false` 与 `cleanup.forced: true` 是此回归预期注入的失败；测试本身的通过结果见 `artifacts/cleanup-test.txt`。

## 本次结论

执行结果与未验证范围见 `RESULTS.md`；截图和结构化结果见 `artifacts/`。
