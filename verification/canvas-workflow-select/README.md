# 画布 ComfyUI 工作流选择修复

问题复现在独立 `127.0.0.1:3021` 浏览器页面，使用两个隔离的图片/视频工作流，没有读取或修改用户桌面画布。

- 修复前：文生图模式的工作流输入为 `disabled: true`，选择器断言失败。
- 修复后：相同断言通过，图片与视频选项均可选择并显示输出类型。选中视频后节点为 `comfyMode: custom`、`comfyWorkflowId: fixture-video`，全局文生图预设仍为 `fixture-image`；再选择图片并把全局预设改成视频后，节点仍保留手选图片工作流。
- 52 项相关测试通过：在 `web/` 执行 `bun test tests/canvas-comfy-panel.test.tsx tests/comfyui-workflow.test.ts tests/comfyui-store.test.ts tests/comfyui-workbench.test.ts`。新增面板回归覆盖四种模式可选及运行中禁用。
- 修复后截图见 `after.png`。TODO 已核对，本次没有对应待办需要迁移。

只验证选择与模板绑定，没有提交 GPU 任务；未运行构建或重启用户桌面版。
