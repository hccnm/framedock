# 真实项目根目录修正

通过已编译桌面目录服务的 open 方法修正真实索引，先保存独立备份，不运行构建。

- 原工作目录：魔幻AI/canvas；修正后：魔幻AI。
- 修正时画布清单 SHA-256 不变，253 个节点保留。
- 以 ep001 真实 pageId 调用桌面 listFiles/readFile，列出 14 个 Skill，读取 short-drama/SKILL.md 共 6870 字符。结果及备份路径见 result.json。
- 恢复应用，界面项目详情显示作品根目录；回到原 ep001 页面，创作助手已连接。
- 未发送模型任务。直接调用 Agent HTTP 项目工具因没有本轮目录 scope 而被正确拒绝；该 scope 在用户发送下一条消息时由桌面重新捕获。
