# Codex 生图渠道验证

- 普通图片节点与生成配置节点共用模型/渠道下拉框；选择「Codex（本机）」调用独立本机 Codex 线程，选择 API 模型切回。移除独立 `codex-image` 节点及入口。
- 前端 8 项、Agent 10 项针对性测试通过，覆盖渠道分流、连线与当前图片输入、编排提示词、参数传递、逐 turn 批量输出去重、透明背景标记校验、取消、跨项目归属及 MCP 创建/运行。
- 本机 CLI 0.165.0 的 `ImagegenArgs` 实际只有 `prompt`、`transparent_background`、`referenced_image_paths`、`num_last_images_to_include` 四个字段。项目使用独立线程，并把当前图片/连线参考图提供为本地附件与路径；新图不引用此前 turn 的图片。
- 原生透明背景通过工具参数请求，并核验输出 item 的 `transparentBackground`；数量按用户配置逐 turn 执行，不把多个结果拼成联系表。尺寸/比例及画质写入实际生图提示词，属于偏好，不承诺精确原生参数；设置面板已明确说明。格式、压缩率、seed、遮罩等未开放为原生参数的字段不显示为可控选项。
- `real-generate.mts` 调用项目真实 `generateCodexImage`，使用当前 CLI 登录实际生成两张透明纸雕狐狸。`real-result.json` 记录真实 thread/turn/item 与 revisedPrompt；`real-native-1.png`、`real-native-2.png` 均为 1536×1024 RGBA，alpha 范围 0–254，原生透明标记为 true。两张生成共约 76 秒。
- `real-server.mts` 是仅用于验收的 loopback HTTP 适配器，调用同一个真实 `generateCodexImage`，不模拟模型响应。隔离 Vite 页从普通 config 节点点击开始生成，传入真实参考图、high 画质偏好、1536x1024 尺寸偏好、opaque 背景和 count=1，生成 `real-edit-1.png`：蓝色围巾与米色背景，1536×1024 RGB。请求与原生结果归属见 `real-ui-result.json`，耗时约 54 秒。
- 浏览器已确认运行时渠道禁用、结果写入原节点右侧、storageKey 存在，以及刷新后任务 success、输出节点和可解码原图恢复。`ui-check.json` 是持久保存前的断言；`light.png`、`dark.png` 为节点布局截图，`running.png` 为真实任务运行中截图。紧凑节点的生成按钮经 DOM 边界核对，完整处于节点内。
- 已检查中英文 TODO，无对应完成项需迁移。未执行构建或重启用户桌面端，已安装 Electron 的更新与复验仍由用户进行。

复验脚本会实际调用模型并消耗当前账户额度；仅在用户授权实际生图时运行。
