# Electron 视频全屏适配验证

- 原生视频按钮使用 Fullscreen API；原来的 `applyAppSecurity` 对全部权限执行 `callback(false)`，包括 `fullscreen`。
- `node --test desktop/tests/security.test.mjs`：修复前 2 项失败、1 项通过；修复后 3 项通过。测试执行真实 security 模块的权限回调，覆盖登记窗口、应用自定义 origin、开发 origin 端口、共享 session、子框架、外站、未登记页面和设备权限。
- 修复同时配置权限 check 与 request handler；仅允许登记的应用主页面请求 fullscreen，并校验当前页面与请求页面 origin。创建同 session 的其他 webContents 不会撤销该能力。
- `check.cjs` 在独立临时 userData 中启动 Electron，自定义 app:// 协议与主窗口安全策略共用源码。视频调用 requestFullscreen，核对 document.fullscreenElement 为 VIDEO，随后 exitFullscreen，核对已退出；窗口收到 enter-html-full-screen 与 leave-html-full-screen。结果见 `result.json`。
- 测试窗口采用 `disableHtmlFullscreenWindowResize: true`，仅验证 HTML 全屏，避免切换用户原生桌面空间；未重启或操作用户已经打开的桌面实例。首次隐藏窗口验证未完成，改用独立非激活窗口后验证通过。
- 项目未构建；真实 macOS 全屏空间切换、实际视频原生按钮点击及退出键行为仍待更新后的桌面实例复验。主进程源码修复需要用户更新并重启后加载。
