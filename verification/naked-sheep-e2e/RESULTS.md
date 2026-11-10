# 裸羊逃跑事件导入与真实生成验收

## 真实 ComfyUI 任务

- 服务：`http://192.168.11.2:8188`，提交前队列为空。
- 来源：`WorkFisher_原版API_20261019/01_角色_作者原文_API.json`。
- 保留原模板的模型、LoRA、8 步、1024×1680、单张输出；替换为项目相关中国农村中年男性提示词和独立输出前缀。
- 提示词参考 `fisher-storylens/references/image-assets.md` 的角色模板人工整理；没有调用模型 Agent，不能据此认定技能 Agent 执行通过。
- prompt_id：`184321ad-bb5f-4eff-812f-ba07cacbf385`。
- 结果：`success`，`completed=true`；执行耗时 24.589 秒。
- 图片：`naked_sheep_character_00001_.png`。这是验收样片，不代表正式人物定稿。
- 原始提交体、回执及历史分别保存在 `submitted-workflow.json`、`comfy-receipt.json`、`comfy-history.json`。
- `run-comfy.mjs` 已有提交回执时只读取原任务，不重复提交；未知提交结果停止自动重投。

## 导入与桌面验收

已导入真实桌面数据空间的首个项目“裸羊逃跑事件”：150张源图片、14个音频、6份说明/脚本、6个API工作流，另加1张真实生成验收样片，最初分为12个创作页、157条全局素材；按用户后续要求，创作页已合并为一张“裸羊逃跑事件 · 资产与分镜”，原始节点和媒体引用保持不变。媒体SHA256与引用完整性校验通过，重复导入后三个业务状态文件字节级哈希不变。详见相邻 `../naked-sheep-import/manifest.json`。

受控Electron接口最初确认项目及12个创作页存在，合并后重新启动真实Electron，已确认仅有1个创作页、191个节点（179个原节点及12个分组）、151张图片全部加载且0张坏图。原节点ID和165个媒体引用保留，未新增分镜连线；合并与导入脚本复跑均跳过写入。截图为 `desktop-merged-canvas.png`，结构化结果为 `merged-canvas-check.json`。实际技能空间为 `/Users/ethanhuang/.flowharbor/codex-workspaces/site`。最终图片恢复已通过：重启真实Electron后，验收画布中的图片完成解码并显示，提示词回执与模板引用可见，助手自动连接成功。截图为 `desktop-e2e-canvas.png`。技能首轮验收发现源目录名与frontmatter声明名不一致，应用拒绝加载；仅将安装目录对齐为 `korean-thriller-asset-to-video` 后复验通过，12个文件保持原样。最终 `/agent/api/skills` 返回200且errors为空，技能页面可见。截图为 `desktop-fisher-skill.png`，结构化验收结果为 `desktop-check.json`。自动验收结束后正常关闭测试应用。

作废资产交集核查为0：未导入明确作废的无毛暗红羊、旧首夜43条视频或旧首帧；历史方案说明标注为参考，不作为当前生成执行表。源目录没有修改。

H3 双参考视频模板含 `RAMCleanup` 节点并开启进程清理，本轮未执行该分支，未验证视频生成或所有模板。未中断或清理远端其他任务。
