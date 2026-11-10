# macOS 安装包与 GitHub Release

FrameDock 使用 electron-builder 生成 Apple Silicon（arm64）和 Intel（x64）DMG，由 GitHub Actions 上传到 GitHub Release 草稿。安装包包含 Electron、前端、随包插件和内置助手的生产依赖，用户无需安装 Node.js、npm 或模型 CLI；模型 API 与 ComfyUI 服务仍需自行配置。

## 本地生成测试包

需要 macOS、Node.js 22 及以上版本、npm 和 Xcode Command Line Tools。首次安装依赖：

```bash
npm run setup
```

构建应用并生成当前 Mac 架构的测试包：

```bash
npm run dist:mac
```

也可指定架构，发布验证应在对应架构的 Mac 上完成：

```bash
npm run dist:mac -- --arm64
```

```bash
npm run dist:mac -- --x64
```

产物位于 `desktop/release/FrameDock-<版本>-<架构>.dmg`。本地默认使用 ad-hoc 签名、不公证，仅供测试；这不代表已经通过 Apple 的开发者身份校验。构建完成后，可检查安装包内的资源、版本和助手依赖加载：

```bash
node script/verify-desktop-package.mjs desktop/release
```

`npm run pack:mac -- --arm64` 仅准备打包资源并打包已有构建产物，供 CI 使用；修改源码后应使用 `dist:mac`，避免带入旧产物。

打包暂存目录为 `desktop/.packaging/`，仅复制明确列出的应用产物和助手运行文件，从助手锁文件重新安装生产依赖，不执行依赖安装脚本，不打包本机用户数据。前端 `web/dist` 中的随包静态内容会进入安装包；发布前请检查其大小及资源分发权限。

当前 `web/public/skill-market` 约 3 GB，完整构建会将这些内容纳入前端。GitHub Release 要求[每个附件小于 2 GiB](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas)，因此必须先确认实际 DMG 压缩后的大小。若超限，需要另行决定技能素材的按需下载或分发方案；本次配置不删减现有内容，也不保证安装包已经符合该限制。

## 配置签名与公证

正式 Release 必须使用 Apple Developer Program 的 **Developer ID Application** 证书签名，并通过 Apple 公证。证书须导出为包含私钥的 `.p12` 文件。在 GitHub 仓库的 Settings → Secrets and variables → Actions 添加以下 repository secrets：

| Secret | 内容 |
| --- | --- |
| `MAC_CSC_LINK` | `.p12` 证书文件的 Base64 内容 |
| `MAC_CSC_KEY_PASSWORD` | 导出 `.p12` 时设置的密码 |
| `APPLE_ID` | 用于公证的 Apple 账号 |
| `APPLE_APP_SPECIFIC_PASSWORD` | 该 Apple 账号的 App 专用密码 |
| `APPLE_TEAM_ID` | Apple Developer Team ID |

将证书编码并复制到剪贴板：

```bash
base64 -i /path/to/DeveloperID.p12 | pbcopy
```

证书、私钥与密码不得提交到仓库。上传同仓库 Release 使用 Actions 自动提供的 `GITHUB_TOKEN`，不需要额外创建个人访问令牌。

签名配置在 `desktop/electron-builder.cjs`，使用 Hardened Runtime 和 Electron 所需的 JIT entitlement。内置助手通过 Electron 的 `ELECTRON_RUN_AS_NODE` 模式运行，因此保留 `RunAsNode` fuse。安装包忽略源码开发模式的资源与页面地址覆盖，继续使用现有应用数据目录及 origin。

## 发布步骤

1. 按仓库版本规范整理 `CHANGELOG.md`，更新根目录 `VERSION`，提交需要发布的改动。`VERSION` 是安装包和前端的发布版本来源，打包时据此生成应用清单；根包和 desktop 包的开发元数据版本不用于安装包版本。
2. 创建与 `VERSION` 完全一致的版本 tag，并推送代码及 tag。工作流不会替你提交、打 tag 或推送。
3. `Build macOS Release` 工作流分别在 `macos-15`（arm64）和 `macos-15-intel`（x64）执行安装、测试、构建、打包、签名与公证。
4. 每个构建检查应用资源、随包 Electron 的 Node 模式及助手依赖加载，再验证签名、公证票据和 Gatekeeper 评估。两种架构均成功后，创建 Release 草稿，上传两个 DMG 和 `SHA256SUMS.txt`。
5. 根据本版本 `CHANGELOG.md` 补充草稿说明，并完成实际安装、启动、助手连接、项目保存与重启恢复验收后，在 GitHub 发布草稿。

缺失 Apple 凭据、tag 与 `VERSION` 不一致、签名/公证失败或任一架构失败，都不会上传本次 Release。重跑只允许更新草稿附件；已公开发布的 Release 不会被覆盖。这里指本 macOS 工作流；仓库其他 tag 工作流仍按各自配置运行。

如果还没有 Apple 凭据，可在 Actions 中手动运行 `Build macOS Release`，保持 `signed` 关闭。产物只作为 Actions 附件提供，不会创建 Release；开启 `signed` 可验证签名流程，同样不会自动创建 Release。GitHub 的 Actions 网页手动入口需要此工作流已进入默认分支。

## 首次发布验收

- 在两种架构的 Mac 上，打开 DMG、拖入“应用程序”，从安装位置启动，确认图标、版本和前端资源正常。
- 下载分发后的应用，确认签名、公证及 Gatekeeper 行为，而非只检查源码启动。
- 内置助手正常连接，使用自己配置的模型完成一次创作；ComfyUI 用户另行验证其服务连接。
- 创建项目、导入媒体、保存、退出并重启，确认内容恢复，更新应用后保留原有用户数据。
- 检查 Release 说明、架构标识、DMG 校验值和随包资源的分发权限。

当前流程不包含应用内自动更新，也不发布到 Mac App Store。打包资源检查只验证文件、版本和模块可加载性，不能替代真实 GUI、模型调用及持久化验收。

参考：[electron-builder](https://www.electron.build/) · [Apple 公证说明](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
