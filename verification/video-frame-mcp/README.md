# MCP 视频截帧验证

工具 `canvas_capture_video_frame` 从已打开创作页中的视频节点截帧，保存独立 PNG 图片节点并自动连接原视频。外部 AI 可以自行读取目录里的视频、选择时间点，再调用工具：

```json
{
  "projectId": "目标创作页 ID",
  "nodeId": "视频节点 ID",
  "position": "time",
  "time": 2.5
}
```

`time` 单位为秒，支持小数，范围为 `0 <= time < 视频时长`。`position` 也支持 `first`、`last`、`current`；仅 `current` 需要画布中可见的播放器。返回 `projectId`、`sourceNodeId`、新图片 `nodeId`、`storageKey`、原始 `width` / `height` 及截帧时间 `time`，可将新节点 ID 继续用于 `canvas_connect_nodes`。时间表示视频时间轴上的取帧位置，不保证任意小数秒都有对应的独立编码帧。

## 已完成验证

- Agent/MCP 相关回归共 41 项通过。
- `check.mjs` 通过真实 HTTP MCP → Agent → SSE → 页面链路验证首帧、尾帧、当前帧（1.5 秒）、2.5 秒及 0 秒截帧，结果见 `results.json`。
- 已有测试素材为 `web/public/skill-market/media/1e36494b2936d096d92c1405.mp4`，尺寸 640 × 360，时长 5.166667 秒。
- 五张 PNG 均可重新解码，保留原始尺寸。首帧与 0 秒图像哈希相同，2.5 秒图像不同；原播放器仍停在 1.5 秒。
- 拒绝错误创作页、缺失时间、负数时间、超出时长及非视频节点五种请求，节点数量不增加。
- 将返回的 2.5 秒图片节点连接到下游配置节点；刷新后五张图片与连线恢复。
- 将源视频移出视口、确认播放器已卸载后，当前帧请求明确失败，按 2.75 秒截帧成功，返回图片节点 `QcZ06qIzYzsPTJ6Gr7M0E`、`image:Jjn3IIUpOnNxmWStDfTaX`，尺寸 640 × 360。此补充检查在主报告之后执行，因此截图含 8 个节点，主报告记录 7 个节点。

## 隔离环境与限制

`start-agent.mts` 使用临时 Agent 数据目录和测试凭据：内部 Agent 17390、测试管理服务 17391、外部 MCP 17392；不占用正式外部 MCP 17372。通过 `.claude/launch.json` 的 `video-frame-mcp-fixture` 启动，配合 3030 的前端和独立测试创作页。`check.mjs` 要求测试页标题为“MCP 视频截帧验收”、视频节点 ID 为 `video-frame-test`，播放器暂停在 1.5 秒；每次运行会新增节点，不能用作无副作用的健康检查。

未调用模型或 GPU 生成。未构建或重启用户 Electron；真实桌面存储恢复、截帧中切页或替换视频的竞态，以及外部 AI 自主判断时间点尚未实际验收。页面验收截图见 `canvas-preview.jpg`。
