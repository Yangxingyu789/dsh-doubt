# dsh-doubt

[![CI](https://github.com/Yangxingyu789/dsh-doubt/actions/workflows/ci.yml/badge.svg)](https://github.com/Yangxingyu789/dsh-doubt/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen)](https://nodejs.org)
![Version](https://img.shields.io/badge/version-0.1.2-blue)

<img src="assets/icon.png" alt="dsh-doubt 图标" width="96">

[DeepSeek Harness](https://github.com/deepseek-ai)（DSH）的回答完成度守卫：在最终回答
显示前核对它引用的真实工具证据，避免模型把未验证的断言当成已完成的任务。

## 为什么需要它

Agent 的回答经常“听起来完成了”：文件写了却没读回、依赖靠猜、命令没跑过就宣布成功。
默认失败模式是自信的叙述加一条没有证据的断言。

`dsh-doubt` 在回合结束处加一道审核边界。它不问模型“你确定吗”，而是检查本轮实际发生的
工具调用和结果。

## 它做什么

- **执行前闸门**：写 `.dsh/profiles`、`.dsh/plugins`、杀进程、改服务/注册表、递归删除、
  写系统目录等 live 变更，会在工具执行前走宿主审批；没有审批通道时直接拒绝执行。
- **最终回答审核**：回答显示前，由一个无工具 reviewer 把可执行断言（命令、路径、版本、
  符号、实测数字）与本轮真实工具调用/结果逐条对照；未通过的草稿不会显示，审核无法完成
  时按原稿放行并记录状态。
- **`verify_claims` 工具**：在本机真实执行提交的检查（命令 / 文件 / HTTP / 表达式），
  返回实测输出，让断言有据可依。
- **交付文档溯源**：写 Markdown/TXT 交付物但正文没有出处标注时，要求补逐步骤溯源表。
- **live 变更守卫**：已执行的 live 变更必须披露备份位置、可直接执行的回滚命令和动作后健康检查。

它做的是证据核对，不保证回答一定正确。

### Token 开销与循环保护

`doubt_review` 是插件内部回执，注册在宿主中执行，但从模型工具列表中隐藏。
模型不应手动调用或猜测 `reviewId`。旧会话仍可能诱发误调用：混合调用中的正常工具
照常执行；仅有误调用时停止该循环并如实说明尚未完成验证，避免反复消耗整段上下文。
正常的“审核提出缺口 → 补查 → 再审核”流程保留。

审核缺少材料时不会通过删除更多证据重审；不支持的 reasoning 参数在同一次分段审核及
格式重试中只探测一次。每次审核在插件日志中记录 `审核用量`，包括输入/输出字符数、
耗时和模型返回的 token/缓存计数；未返回 usage 表示未知，不能当作零或用字符数替代。
这些日志不记录提示词、工具原文或凭据。详见 [检查记录](docs/token-audit-2026-10-21.md)。

## 要求

- Node.js `^22.19` 或 `>=24`
- 集成测试（`verify:host*`）需要 DSH 桌面应用或宿主包
- 主要平台是 Windows；Linux/macOS 可用于开发和 CI

## 安装

### Windows 桌面（离线安装）

下载 `dsh-doubt-0.1.2-source.zip` Release 资产（或 clone `v0.1.2` tag），在解压后的源码
目录运行 PowerShell：

```powershell
pnpm install
node .\scripts\install-local.mjs --profile desktop
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm install --offline
```

安装脚本会构建插件，把 `lib/`、配置、资源和文档复制到
`$DSH_HOME\plugins\dsh-doubt`，备份 profile 的 `package.json`，并把依赖和 bundle
写入目标 profile。升级前请先备份现有插件目录。完成后重启 DSH；如果 profile 配置里
禁用了插件，需要显式启用。

`--profile <name>` 可切换到其他 profile，目标 profile 目录必须已存在。

### 从源码安装

```bash
git clone --branch v0.1.2 https://github.com/Yangxingyu789/dsh-doubt.git
cd dsh-doubt
pnpm install
node scripts/install-local.mjs --profile desktop
```

如果只是开发插件本身：

```bash
pnpm install
npm run build
npm test
```

## 快速开始

重启 DSH 后，问一个需要真实证据的问题，例如：

> 读取 `package.json`，只回答它的版本号。

最终回答会先与真实 `read` 结果对照；未通过审核的草稿不会显示。需要直接核对断言时可用
`verify_claims`。插件日志中的 `审核用量` 记录字符数与 provider usage，不记录提示词、
工具原文或凭据。

## 配置（节选）

配置都在插件的 `config:` 块里（见 [cordis.patch.yml](cordis.patch.yml)）。

| 键 | 默认 | 含义 |
|---|---|---|
| `guardPreExecute` | `true` | 危险 live 变更在工具执行前询问/拒绝 |
| `guardLiveMutation` | `true` | 已执行的 live 变更要求备份、回滚命令与健康检查 |
| `requireOperationEvidence` | `true` | 用工具证据审核最终回答 |
| `reviewMaterialOnly` | `true` | 草稿没有实质断言时跳过审核模型 |
| `reviewNotice` | `off` | 审核未完成时的末尾提示：`banner` / `short` / `off` |
| `requireProvenance` | `true` | 交付文档无出处标注时要求溯源表 |

## 版本与发布历史

- **公开发布序列：`0.1.x`。** 首个公开版本是 `0.1.0`。
- `0.7.x`、`0.8.x` 是公开前的内部开发 tag，不是安装目标，也不应当按“更新的公开版本”排序。
- 请使用最新的 `v0.1.x` GitHub Release 及其源码资产。插件版本以 `package.json`、
  `dsh-plugin.json` 和运行时插件横幅为准。

## 限制

- 闸门与扫描器是命令/文本启发式；特殊引号、变量、嵌套 shell 或其他编码载荷可能被
  保守拦截或漏判。**闸门不是安全边界。**
- 最终审核依赖一次模型调用；无法完成时会 fail-open 放行，日志有记录，但默认
  `reviewNotice: off` 不会在回答后追加可见提示。审核本身也会消耗模型 token。
- reviewer 检查证据，不检查语义正确性或用户意图；用户原话的复述可能被当作上下文，
  而不是新的模型断言。
- 主要目标是 Windows；Linux/macOS 支持覆盖开发和 CI。
- 公开的 `0.1.x` 接口与配置项可能变化。

## 安全

漏洞报告方式见 [SECURITY.md](SECURITY.md)。不要在公开 issue 中粘贴凭据、token、
本地会话内容或可利用载荷。

## 开发

```bash
npm run check          # tsc --noEmit
npm run build          # 编译到 lib/
npm test               # 12 个单元测试文件
npm run smoke          # 在裸 Cordis 应用里加载插件
npm run audit          # 仓库一致性自检
npm run verify         # 完整验证链（有 DSH_APP_DIR 时包含宿主测试）
```

贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 验证溯源

历史验证快照、命令和已知限制记录在 [docs/provenance.md](docs/provenance.md)。
Token 审计记录见 [docs/token-audit-2026-10-21.md](docs/token-audit-2026-10-21.md)。

## 许可证

MIT，见 [LICENSE](LICENSE)。更新日志：[CHANGELOG.md](CHANGELOG.md)。
