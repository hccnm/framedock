# H3 工作流 VAE 路径修正

截图中的失败节点 `comfyui-1794039319793-1xzei` 使用已导入的「视频生成-MiniMax H3」模板，服务在入队前返回 `VAELoader · vae_name · Value not in list`。

## 对照与修改

对照魔幻 AI 项目 G014 的成功请求及 history（`f582b9e3-a77c-49e7-97fc-cc7cfd5ed586`），并读取当前服务 `/object_info/VAELoader`：

| 节点 | 原模板 | 当前服务与成功请求 |
|---|---|---|
| 149 视频 VAE | `minimax_h3_video_vae_fp16.safetensors` | `MiniMax-H3\minimax_h3_video_vae_fp16.safetensors` |
| 150 音频 VAE | `minimax_h3_audio_vae_fp32.safetensors` | `MiniMax-H3\minimax_h3_audio_vae_fp32.safetensors` |

实际桌面配置中同步修改这两个节点输入与两个字段默认值，工作流 ID、六图入口、FL2VA、两条 LoRA、注意力链、采样器、调度器、步数与种子均保持。其他工作流未改。原作者导入资料保留原样；[workflow.json](workflow.json) 是本机修正后的 API 模板快照。

成功请求还包含按片段绑定的音色输入和不同像素值；通用模板没有音色入口，默认 0.6MP，本次失败节点覆盖为 0.2MP、3 秒。这些差异不是本次 VAE 拒绝原因，未擅自合并其他草稿或替换参考图。六图三音色整理草稿本已有正确路径且禁止运行，未修改。

## 验证

[check.ts](check.ts) 使用真实 `buildRunWorkflow`，只读取服务元数据，不上传素材或调用 `/prompt`。[before.json](before.json) 在修复前复现两处无效 VAE；[after.json](after.json) 确认路径可用、字段默认值同步、14 个受保护节点与成功请求一致、1–6 图裁剪无悬空引用、3 秒/0.2MP覆盖有效及模板不被运行构建修改。59 项既有工作流、工作台和助手工具测试通过。

```bash
bun verification/h3-workflow-repair/check.ts \
  "$HOME/Library/Application Support/FrameDock Desktop/storage/state/comfyui_store.json" \
  '/Volumes/办公/fnos/media/01_项目/内容作品/魔幻AI/.short-drama/production/EP001_V2_后续统一人工校验_1MP_20261104/GROUP-EP001-V2-ALL02-G014/workflow.json'
```

已正常退出并重启真实 FrameDock，工作流编辑器中的两个 VAE 默认值均显示修正路径，重启后的配置与导出图一致。没有发起真实生成；历史失败状态保留。实际视频输出和参考图连续性仍待生产验收。
