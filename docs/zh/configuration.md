# 配置参考

所有配置位于插件的 `config:` 块。默认值以 [`cordis.patch.yml`](../../cordis.patch.yml)
为准。覆盖配置会**整体替换 config 对象**，不是深合并；请写全想保留的键。

```yaml
- id: dsh-doubt
  config:
    enabled: true
    # ...
```

## 核心

| 键 | 默认 | 含义 |
|---|---:|---|
| `enabled` | `true` | 是否加载并运行插件 |
| `verifyTool` | `true` | 注册 `verify_claims` 工具 |
| `promptSection` | `true` | 把证据规则写入 system prompt |

## 证据收集

| 键 | 默认 | 含义 |
|---|---:|---|
| `autoVerify` | `true` | 回合结束后为实质断言自动收集证据 |
| `requireSources` | `2` | 在线断言被视为 confirmed 所需的来源数 |
| `onlineTimeoutMs` | `8000` | 在线探测/registry 检查超时 |
| `factored` | `true` | 对无法结论的断言启用独立重推导 |
| `factoredVotes` | `3` | 独立投票数 |
| `factoredProvider` | `spawn` | 投票使用的 subagent provider |
| `executeAnswerCommands` | `false` | 是否执行回答中引用的命令（默认只检查程序是否存在） |
| `strictLabeling` | `true` | 要求明确标注已验证/未验证 |

## 最终回答审核

| 键 | 默认 | 含义 |
|---|---:|---|
| `requireOperationEvidence` | `true` | 用本轮工具证据审核最终回答 |
| `reviewMaterialOnly` | `true` | 草稿没有可执行断言时跳过 reviewer |
| `reviewMaxChars` | `120000` | 审核包最大字符数 |
| `segmentedReview` | `true` | 长草稿分段审核 |
| `reviewTimeoutMs` | `120000` | reviewer 超时 |
| `reviewReasoningEffort` | `off` | `off`、`low`、`high`、`max` 或 `default`（不传字段） |
| `reviewNotice` | `off` | 审核未完成时的末尾提示：`banner`、`short`、`off` |
| `maxRounds` | `2` | 每轮最多补证次数 |
| `minScore` | `6` | 旧证据循环的风险分阈值 |
| `maxFindings` | `8` | 最多回传给作者的 findings 数 |
| `minAnswerChars` | `240` | 旧证据循环考虑的最小回答长度 |
| `language` | `auto` | 提示语言：`auto`、`en`、`zh` |

## 溯源

| 键 | 默认 | 含义 |
|---|---:|---|
| `requireProvenance` | `true` | 交付文档无出处标注时要求溯源表 |

## Live 变更

| 键 | 默认 | 含义 |
|---|---:|---|
| `guardPreExecute` | `true` | 工具执行前询问/拒绝危险 live 变更 |
| `guardLiveMutation` | `true` | live 变更后要求备份、回滚命令和动作后健康检查 |
| `liveMutationPaths` | `.dsh/plugins`、`.dsh/profiles` | 被视为 live 宿主状态的路径前缀 |

## 操作证据

| 键 | 默认 | 含义 |
|---|---:|---|
| `operationMaxRounds` | `3` | 长回答的取证轮数预算 |
| `probeUrls` | 内置列表 | 可选的在线可达性探测地址 |

## 调参建议

- 除非 provider 稳定支持 reasoning 且审核预算充足，否则保持 `reviewReasoningEffort: off`；
  thinking token 可能耗尽 reviewer 的输出预算。
- `reviewMaxChars` 限制审核输入；调高会增加 token 成本，调低会增加
  `EVIDENCE_CONTEXT_LIMIT` / unavailable。
- `reviewNotice` 只控制可见性，不改变安全策略。审核失败默认 fail-open；需要用户看到提示时
  设为 `banner`。
- 执行前闸门和扫描器是启发式，见 [架构](architecture.md) 和
  [SECURITY.md](../../SECURITY.md)。
