# dsh-doubt

[![CI](https://github.com/Yangxingyu789/dsh-doubt/actions/workflows/ci.yml/badge.svg)](https://github.com/Yangxingyu789/dsh-doubt/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen)](https://nodejs.org)
![Version](https://img.shields.io/badge/version-0.1.0-blue)

<img src="assets/icon.png" alt="dsh-doubt 图标" width="96">

[DeepSeek Harness](https://github.com/deepseek-ai)（DSH）的回答完成度守卫：在最终回答
显示前核对它引用的真实工具证据，避免模型把未验证的断言当成已完成的任务。

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

## 要求

- Node.js `^22.19` 或 `>=24`
- 集成测试（`verify:host*`）需要 DSH 桌面应用或宿主包
- 主要平台是 Windows；Linux/macOS 可用于开发和 CI

## 安装（开发）

```bash
pnpm install
npm run build          # tsc -> lib/
npm test               # 单元测试
npm run doctor         # 检查已安装的 DSH 插件（如存在）
```

装进 live DSH profile 请使用离线安装脚本：构建、备份当前插件、复制 `lib/`、执行
`pnpm install --offline` 并校验文件哈希。见 [scripts/install-local.mjs](scripts/install-local.mjs)
与 [交接文档.md](交接文档.md)。

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

## 开发

```bash
npm run check          # tsc --noEmit
npm run build          # 编译到 lib/
npm test               # 11 个单元测试文件
npm run smoke          # 在裸 Cordis 应用里加载插件
npm run audit          # 仓库一致性自检
npm run verify         # 完整验证链（含宿主测试）
```

## 限制

- 闸门与扫描器是命令/文本启发式；特殊引号、变量、嵌套 shell 可能被保守拦截或漏判。
- 最终审核依赖一次模型调用；无法完成时会 fail-open 放行，日志有记录，但默认
  `reviewNotice: off` 不会在回答后追加可见提示。
- 0.1.0 是首个公开版本，接口与配置项可能变化。

## 许可证

MIT，见 [LICENSE](LICENSE)。更新日志：[CHANGELOG.md](CHANGELOG.md)。
