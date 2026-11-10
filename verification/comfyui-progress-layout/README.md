# ComfyUI 轮询与结果排布验证

- `bun test tests/comfyui-progress.test.ts tests/comfyui-result-layout.test.ts tests/agent-comfyui-tools.test.ts tests/canvas-comfy-panel.test.tsx`：20 项通过。
- 修复前 3 项进度回归失败：不变的 running 触发写入，后台 store 数组被替换，模拟 503 导致 running → queued → running；修复后通过。
- 修复前 3 项排布回归失败：无关下方分镜与外围分组把结果推至 y=20040，后续版本纵向堆叠；修复后只避让实际碰撞，位于源节点同一行右侧，后续版本水平延续，已有节点不移动。
- `browser-check.json`：独立 Vite 页走真实 resume/poll 链路，模拟 ComfyUI HTTP；连续 7 次队列查询包含一次 503，MutationObserver 记录节点 DOM 更新 0、移除 0，原节点根元素未替换。成功时的状态变化单独验证，正常生成文本结果保存于同一行右侧。结果按钮按 comfyOutputNodeIds 精确选中并聚焦输出，关闭源面板；无效输出 ID 隐藏按钮。
- `result-link.png`：独立页面结果定位按钮截图，内容为测试用文本结果。
- `live-result-layout.json`：通过桌面当前运行的 Agent HTTP 工具接口，核对 `ep001` 源节点保存的实际输出 ID；将输出视频从远下方移至源节点同一行右侧，按实时节点矩形避让。仅更新该结果的坐标与任务关联标题并选中它，视频 storageKey 与节点总数不变，原坐标保留在记录中。没有直接改写运行中的用户存储文件。
- 未提交 GPU 或模型生成任务，未更改轮询间隔和超时。用户授权后完整构建并正常重启桌面；旧包 index-BfEpzFEA.js 未包含此前轮询修复，新运行时确认加载 index-KCWuyA1A.js，见 desktop-loaded-build.json。

- `electron-check.cjs` / `electron-check.json`：原生 Electron 隔离临时存储，无 Agent、无用户凭据、无真实外部请求；新构建真实 resume/poll 链路进行了 10 次模拟队列查询，含 running → queued → running 及一次 503。文档根部 MutationObserver + 1200 帧 DOM/CSS 检查记录移除、替换、缺失、隐藏均为 0。该场景未复现用户实际生成时的视觉闪动，不能当作已定位该症状根因或完全修复的证据。
