# 通用工作流基座验收

## 实现

工作流由 API JSON、ComfyUI `/object_info/{class_type}` 定义及保存的字段配置共同描述。产品执行代码不包含模型/作者分支、固定节点编号、模型文件名或按模型插入节点的逻辑。

- `analyzeWorkflow` 统一用于界面导入、Agent 导入、编辑器刷新、工作台刷新及运行准备。解析 V1/V3 参数类型、上传标记、枚举/范围、输入输出端口和 Autogrow 的 prefix/names/min/max；只保存当前图所用的节点信息，不保存上传文件清单。
- 只有唯一候选才指定提示词、种子等用途；多个候选由用户在字段编辑器选择。已有 ID、别名、字段 ID、排序、用途、默认值、随机模式和禁止执行状态优先保留。读取不到元数据时使用保存配置，新导入未识别项保留原值并允许编辑类型/用途。
- `referenceGroups` 描述固定或动态输入边界及对应字段。原有 `referenceInput` 通过同一通用表示使用；固定槽位保持含义，动态槽位按声明顺序整理。裁剪仅删除独占的未选分支，保留中间处理路径、输出槽号和共享依赖；未选素材仍被必需分支引用时明确报错。
- `prepareComfyWorkflow` 与 `preflightComfyRun` 在上传前刷新元数据、构建并校验实际请求。缺少媒体、失效枚举、断链、端口类型/槽号及输入组数量错误先报告，不提交请求。模型文件候选仅按枚举中的同名文件给出；用户采用后同步源节点和字段默认值，未采用时不改值。
- 输出依据节点定义、用户选择、history 文件类型、后缀和下载 MIME 收集；没有节点类名黑名单。未知文件需要可识别 MIME 或明确的输出类型，也支持文本文件。编辑器支持选择具体输出节点。
- MCP 名称与已有参数保留，工作流详情增加识别诊断、参考组和输出节点配置。WorkFisher 专项配置/合并脚本及模型样例生成脚本已移除，测试直接使用配置数据和节点定义。
- Z Image 样例所需的三条缩放分支已写进 API 模板和分发 JSON，通用执行器不再隐式插入。用户已删除的工作流未恢复。

相关协议依据：[ComfyUI 节点定义](https://github.com/Comfy-Org/ComfyUI_frontend/blob/main/packages/object-info-parser/src/schemas/nodeDefSchema.ts)、[服务端输入定义](https://docs.comfy.org/custom-nodes/backend/server_overview)。不支持自动解释的自定义语义需由用户配置，不增加模型适配表。

## 已验证

- 177 项前端回归及 TypeScript 检查通过；其中 31 项基座用例覆盖未知类名、重编号/乱序、V1 上传标记、动态及固定插槽、稀疏输入、图像与音频独立编号、数量约束、中间处理与通配端口、共享依赖、候选采用、缺少元数据、必需输入和提交前阻断。
- 开始修改前，使用旧请求构建器从本机七份配置捕获 78 组请求。新构建器使用真实服务的 38 类节点定义重建，78 组均无差异，见 [compatibility.json](compatibility.json)。禁止运行的草稿按入口门禁验证，不以删除项目占位符检查替代其禁止执行状态。完整私有状态和请求基线仅保存在系统临时目录，未导入仓库。
- 隔离浏览器通过真实导入界面导入未知节点 JSON，识别主提示词歧义和失效路径；点击采用并配置用途后保存，刷新恢复一致。试跑经过模拟的 `/object_info → /prompt → /history`，正确收集自定义文本输出。见 [界面结果](ui-result.json)和 [截图](ui.png)。该模拟没有请求真实 GPU。
- 本机实际配置未改写，已有七份工作流保留；未重新打包或重启用户桌面应用。真实 ComfyUI 生成、成图/视频质量和桌面静态资源更新后的验收仍待进行。

## 复验

```bash
npm --prefix web run typecheck
bun test web/tests
```

节点定义夹具位于 `web/tests/fixtures/comfy-node-info.json`，来源为本轮实际服务读取；上传文件选项已去除。独立界面入口为 Vite 下的 `/tests/fixtures/workflow-foundation.html`，仅拦截测试域名 `fixture.invalid`，不包含真实生产配置。

`check-existing.ts --capture <state.json> <baseline.json>` 用于变更前捕获请求；`--compare <state.json> <baseline.json> <node-info.json>` 用于变更后对比。不得用新执行器重新捕获基线来证明此次旧执行器兼容性。
