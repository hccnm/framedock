# 外部 MCP 验收

- 设置位置：设置 → 外部 Agent。
- 复用现有 Agent HTTP 监听，端点 `/mcp`，Streamable HTTP，无状态每请求实例。
- 独立 Bearer，仅本机 Host / Origin；默认关闭，关闭撤销旧令牌，重新开启换令牌，重启关闭。
- 隔离行为测试 3 项通过：开关/鉴权/参数校验/真实 CanvasSession 工具桥/关闭旧请求。
- 浏览器连接 `verification/external-mcp-preview.ts` 隔离服务验证：开启显示 Agent 说明，切换手动配置可解析 JSON、含 HTTP 地址与独立授权头；关闭后配置移除，无界面错误。
- 隔离服务未读取用户配置、未连接真实项目或模型，验收后已停止。
- 还需重建桌面资源后，从真实 Electron 设置连接外部 MCP 客户端验证。
- 已派发到画布的操作不会因关闭而撤销；生成工具可能使用配置的模型或远程 GPU。
