# 通用多参考图像工作流

两套工作流已保存到 ComfyUI `http://192.168.11.2:8188/` 的 workflows 目录，原工作流保留。

| 工作流 | 无参考文生图 | 可选参考槽位 | 实际生成验证 |
| --- | --- | --- | --- |
| 通用多参考-Z Image | 支持 | 1–3 | 无参考、3 参考均成功，768×768 |
| 通用多参考-Qwen Edit | 支持 | 1–16 | 无参考、3 参考均成功，768×768 |

## 文件和使用

- `通用多参考-*.json`：ComfyUI 可编辑图。参考图节点默认旁路（紫色），直接运行是文生图。使用参考时选取图片并启用对应 LoadImage 节点；未使用的槽位保持旁路。
- `通用多参考-*_API.json`：含全部参考槽位的 API 模板。参考 LoadImage 文件名需要上传后填写，缺省为空；不能原封不动提交 `/prompt`。无参考时删除 LoadImage 及编码节点对应图片输入；有参考时保留选中槽位并从 1 连续编号。
- `workflows.json`：FrameDock 完整工作流记录，含参数标签、预设角色、可选参考绑定和 LoRA 开关。项目中的 `buildRunWorkflow` 已实现上述动态裁剪。此文件不能当成普通 API JSON 在现有导入按钮中上传。
- `*-submitted.json`：本次真实生成提交过的图，可查看具体参考文件名与最终连线。
- `generation-results.json`、`*-history.json`、`*.png`：四组生成的 prompt ID、服务端状态与样片。

FrameDock 独立预览已追加两套完整记录，验证 0/3 张参考选择和 LoRA 控件；实际 Electron 配置尚未追加。直接修改配置文件及通过应用启动后保存都被自动审批拒绝，待用户明确授权对 `/Users/ethanhuang/Library/Application Support/FlowHarbor Desktop/storage/state/comfyui_store.json` 的追加写入。导入时必须保留已有工作流及其他配置。

## LoRA

Z Image 提供两个风格 LoRA 插槽，默认 Off，可分别 On 并选择文件、调整强度。8 步蒸馏是采样加速配置，单独保留强度参数；强度设为 0 可停用，但需自行改为基础模型适用的步数与 CFG。

Qwen 提供一个默认 Off 的插槽，文件为 None。当前服务器没有已确认匹配 Qwen Image 2.1 的 LoRA；安装匹配权重后刷新参数选项再选择，不能直接套用 Z Image LoRA。

本次四次实际生成均为风格 LoRA Off。On 分支的图构建回归通过，额外 GPU 验证因自动审批拒绝尚未执行。

## 效果与限制

- Z 使用现有 `z_image_bf16.safetensors`，原生实验性 Omni 节点可接受参考 latent。三参考实际生成成功，但 Base 权重不等同于专门编辑权重，不能保证人物身份、结构或局部编辑一致性。样片背景有参考轮廓残影。
- Qwen Edit 使用现有 Qwen Image 2.1 int8 权重，三参考样片能保留杯、壶和植物的颜色及形状。支持 `<image1>` 等标记。独立输出宽高适合重新组合；精确位置编辑建议与第一张参考图缩放后的尺寸、比例一致。
- Qwen 使用 EmptySD3LatentImage 直接连接官方 KSampler。当前 ComfyUI 会把全零 latent 的通道及缩放修正为模型要求，实际输出尺寸已核对为 768×768。
- 目前浏览器预览访问远端 object_info 受 CORS 阻止；实际生成验证由本机直接请求完成。桌面应用通过既有代理访问，尚未在真实 Electron 复验。

## ComfyUI 显示异常

用户的旧图也出现节点与连线错位。保存的两份 UI 图经结构检查，所有连线的源节点、目标节点及输入 link ID 一致；后台四次生成成功。

已确认当前页面的 `LGraphCanvas.drawBackCanvas` 被 Mixlab 的 `/extensions/comfyui-mixlab-nodes/javascript/td_background.js` 整体替换，这是可疑兼容点；尚未通过成功隔离复验，不能断言是该扩展或 ComfyUI 版本导致。未修改服务器扩展、版本或用户旧工作流。

## 回归

`bun test ./web/tests/general-image-workflows.test.ts ./web/tests/comfyui-workbench.test.ts`：17 pass，0 fail。覆盖零参考、稀疏参考、全部槽位、从 1 连续重连、无悬空节点、LoRA 开关与旧 H3 行为。
