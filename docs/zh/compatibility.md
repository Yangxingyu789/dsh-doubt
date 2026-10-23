# 兼容性

## 测试环境

| 组件 | 版本 |
|---|---|
| DeepSeek Harness 桌面运行时 | `0.2.1-rc.2` |
| `package.json` 声明的 DSH target | `0.2.0-rc.2` |
| Node.js | `^22.19` 或 `>=24` |
| 主要平台 | Windows（PowerShell、路径/argv 边界） |
| CI 平台 | Windows 和 Ubuntu |
| 在线验证所用模型 | `deepseek-flash`（DeepSeek-V4.1-Flash-1017） |

DSH 仍是开发者预览版：插件契约可能随版本变化。请固定你测试过的 DSH 版本，并固定部署的
插件 release。仓库在 `package.json` 的 `dshTarget` 中记录目标版本，本表记录实际测试版本。

## DSH profile 安装

官方可发现性约定是 GitHub topic **`dsh-plugin`**。官方插件安装命令：

```bash
dsh plugin --profile web add github:Yangxingyu789/dsh-doubt#v0.1.5
```

安装后重启 harness 并刷新界面；插件在 **Settings → Plugins** 中管理，可启用/禁用。
需要可复现安装时请固定 tag 或 commit，不要使用移动分支。

Windows 桌面离线安装见主 README。

## 限制

- live 变更闸门是启发式，不是安全边界。
- 宿主集成检查需要已安装 DSH；上游 CI 会跳过这些检查。
- 审核检查证据，不检查语义正确性或用户意图。
- DSH 处于预览阶段，公开 `0.1.x` 的配置键可能变化。
