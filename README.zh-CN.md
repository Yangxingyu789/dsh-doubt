# dsh-doubt

<img src="assets/icon.png" alt="dsh-doubt 图标" width="128">

**用分层取证替代「你确定吗」。**

模型第一遍回答经常不严谨：命令没跑过、路径没确认、版本号是记忆的、API 签名是编的。你只能反复追问「你确定吗」——它每次真去查都能查出问题，于是一个可靠结论要问好几次。

`dsh-doubt` 在最终正文显示前，独立审核用户要求、草稿和实际工具证据。证据不足时通过宿主循环要求模型补查；无法验证时明确报告未完成。原有回合后本机断言检查、多来源交叉和文档溯源仍保留。

中文 | [English](README.md)

---

## 为什么不做成「追问一遍」

这是 v0.1 → v0.2 的关键改动，依据是实测数据而不是直觉：

| 做法 | 实测结果 | 出处 |
|---|---|---|
| 内在自纠错（只让它再看一遍，无外部反馈） | GPT-4 GSM8K **95.5 → 89.0**；Llama-2 **62.0 → 36.5**；CommonSenseQA 75.8 → 38.1 | [Large Language Models Cannot Self-Correct Reasoning Yet, ICLR 2024](https://arxiv.org/abs/2310.01798) |
| 同上，机制分析 | GSM8K 上 74.7% 保持原答案；改动案例里**把对的改成错的**多于把错的改成对的 | 同上 §3.3 |
| 外部反馈纠错（工具/代码执行器/标签） | 一致提升；作者明确建议「用工具当 verifier」 | [CRITIC, ICLR 2024](https://arxiv.org/abs/2305.11738) |
| 核验问题**独立回答**（不看自己的草稿） | 幻觉显著下降；若能看到草稿会复制同一幻觉 | [Chain-of-Verification](https://arxiv.org/abs/2309.11495) |
| yes/no 式核验提问 | 模型倾向**不管对错都表示同意** | 同上 |
| 独立重推导 + 多数投票 | 76.7 → 82.5 → 85.3 → 88.2（随采样数上升），同等成本下优于多智能体辩论 | [2310.01798 §4](https://arxiv.org/abs/2310.01798) |

以上是早期 Tier C 的设计参考，不是本版本效果的证明。当前独立审核会比较草稿与实际证据，其判断仍需实际评测。

---

## 分层取证

```
                     ┌──────────────────────────────────────────────┐
   模型回答 ────────►│ 风险扫描器（纯函数，9 检测器）                 │
                     │ 命令/路径/版本/API 符号/包名/数字/代码块/      │
                     │ 绝对化措辞/改口                               │
                     └──────────────────┬───────────────────────────┘
                                        │ 断言 → 可机械执行的检查
                                        ▼
        ┌───────────────────────────────────────────────────────────┐
        │ Tier A 本机确定性 oracle（离线可用，机器当裁判）           │
        │   PATH/PATHEXT 查找 · node_modules 安装版本 ·             │
        │   package.json 声明范围 · 锁文件 · 定义位置符号查找        │
        ├───────────────────────────────────────────────────────────┤
        │ Tier B 多来源交叉（联网时）                                │
        │   ≥requireSources 个**互相独立**来源一致才算 confirmed     │
        │   例：npmmirror + npmjs 两个 registry 都说 5.9.3 存在      │
        ├───────────────────────────────────────────────────────────┤
        │ Tier C 独立重推导 + 多数投票（离线且无判据时）             │
        │   把断言改写成自包含提问 → 无草稿上下文的子代理答 N 次      │
        │   → 取多数；分裂就如实说「投票分裂」，不硬给结论           │
        └───────────────────────────┬───────────────────────────────┘
                                    ▼
                     ┌──────────────────────────────────────────────┐
                     │ 注入的是**实测证据 + 判定**，不是「请去核验」 │
                     │ 已证伪 / 证据冲突 / 无法核验 / 已证实         │
                     │ 每条带来源标签：✓ [node_modules/x] 已安装 …  │
                     └──────────────────────────────────────────────┘
```

判定只有四种，**没有「大概对」**：

- `confirmed` 达到来源数要求
- `refuted` 有来源明确反驳且无来源支持
- `inconclusive` 来源冲突 / 在线时一致来源不足 / 只有弱证据
- `unverifiable` 本机与网络都拿不出判据 —— 必须如实标注，不许猜

**弱证据模型**：标识符只在调用位置出现、不在定义位置出现 → 中性（既不确认也不反驳）。这是实测出来的必要性：早期版本把「测试文件里那句断言本身」当成了证据，自指假阳性。

---

## 安装

```bash
dsh plugin --profile desktop add dsh-doubt
```

离线（不联网）：

```powershell
git clone https://github.com/Yangxingyu789/dsh-doubt.git
cd dsh-doubt
pnpm install --offline
node scripts/install-local.mjs --dry     # 先看会改什么
node scripts/install-local.mjs
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm install --offline
# 重启 DSH 宿主
```

---

## 离线升级

0.7.0 起，执行前闸门会在宿主运行时拒绝 live 安装或写入 `.dsh/profiles/**`、`.dsh/plugins/**`（见「执行前闸门」）。因此升级必须在 DSH 完全退出后执行：

1. 任务管理器结束所有 `DeepSeek Harness` 进程；
2. 双击 `dsh-doubt-upgrade.cmd`（仓库内副本：`scripts\dsh-doubt-upgrade.cmd`，它调用 `scripts\run-upgrade.ps1`）；
3. 启动器会：`tsc` 构建 → 把当前安装备份到 `_diag\offline-upgrade-backup-<时间>` → 复制新的 `lib/` → 在 profile 里 `pnpm install --offline` → 逐文件 SHA-256 校验 → 启动 DSH；
4. 升级后重跑健康检查：`npm run doctor`（预期全部 PASS：`installed-version`、`lib-identical` 48 文件/0 差异、`preflight-module`）。

升级后的预期运行期行为（由 Lead 在你回复「已启动」后实测）：
- 字面 temp 目录递归删除**放行**（0.8.0 规则）；
- 写入 `.dsh/plugins/**` 被前置闸门**拒绝**；
- live 文件复制到 temp **放行**（0.8.1 写入方向规则）；
- 宿主运行时安装仍按设计被拒绝。

不退出 DSH 的只读自检：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\upgrade-offline.ps1 -DryRun
```

只打印目标版本与已解析的工具路径，不写任何文件。

回滚：把 `_diag\offline-upgrade-backup-<时间>\plugins-dsh-doubt\*` 恢复回 `%USERPROFILE%\.dsh\plugins\dsh-doubt\`，把 `profile-files\package.json` 与 `pnpm-lock.yaml` 恢复回 profile 目录，在该目录执行 `pnpm install --offline`，然后重启 DSH。升级脚本每次运行都会打印这些命令。

诚实边界：`lib` 每个文件都做 SHA-256 对比，但「运行中的宿主实际加载了哪个版本」只能从进程启动时间与观察到的行为**推断**——宿主没有加载日志。不要在宿主运行时热安装，闸门会按设计拒绝。

---

## 配置

在 profile 的 `cordis.patch.yml` 里加同 id 条目覆盖（后加载优先）：

| 字段 | 默认 | 作用 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `verifyTool` | `true` | 注册 `verify_claims` |
| `promptSection` | `true` | 注入分层取证规则 + 硬性禁令 |
| `autoVerify` | `true` | 自动审核总开关：最终正文审核与回合后 Tier A/B/C |
| `requireSources` | `2` | 在线时 confirmed 需要的独立一致来源数 |
| `probeUrls` | 2 个 registry + arXiv | 联网探测候选 |
| `registryUrls` | npmmirror, npmjs | Tier B 交叉来源 |
| `onlineTimeoutMs` | `8000` | 在线请求超时 |
| `factored` | `true` | 启用 Tier C |
| `factoredVotes` | `3` | 独立重推导采样数 |
| `factoredProvider` | `spawn` | 子代理 provider 名（实测核对：`dsh-subagent-spawn-in-process` 注册名 = 其 `config.providerName`，默认 `spawn`；该 provider 的子代理是 zero parent context）。不可用则自动跳过并如实报告 |
| `executeAnswerCommands` | `false` | **默认不执行回答里出现的命令**，只验证程序是否存在 |
| `strictLabeling` | `true` | 无法核验的断言必须在最终回答里标「未验证」 |
| `requireProvenance` | `true` | 写出交付文档（`.md`/`.txt`）但正文没有出处小节时，要求补一份逐步骤溯源表（见「溯源闸」）。同一份文档只问一次；独立预算，一次人工回合最多 4 次，不受 `maxRounds` 影响 |
| `requireOperationEvidence` | `true` | 显示前独立审核全文与工具证据，不依赖关键词或字数 |
| `operationMaxRounds` | `3` | 每个宿主 turn 退回补查上限（0–5）；0 仍审核但不重试。实测一条长回答需要第三稿才可能通过审核，故由 2 提到 3 |
| `reviewTimeoutMs` | `120000` | 单次审核超时（最多两次尝试）；超时不放行原稿，但会去掉历史记录重试一次 |
| `reviewMaxChars` | `120000` | 审核请求字符上限（中文按字≈token）。由 48000 提高，让更多历史证据进包（历史最多占 1/3 预算）；审核已关闭 thinking，预算留给判定。代价：审核调用更慢/更大 |
| `segmentedReview` | `true` | 整包装不下时按段审核长草稿（见「操作取证闸」）；`false` 回退单包路径 |
| `reviewReasoningEffort` | `off` | 审核调用的 reasoning effort。宿主 DeepSeek adapter 在未指定时默认 `high` + thinking，而 thinking 与 `max_tokens` 共用预算；实测第 1 次尝试 12000 输出 token 全花在 thinking 上、可见正文 0 字符 → `max-tokens`。`off` 把预算留给 JSON 判定；`default` 回退宿主默认 |
| `guardLiveMutation` | `true` | 审核前的确定性危险变更闸门（见「危险变更闸门」）；`false` 完全回退旧行为 |
| `guardPreExecute` | `true` | 执行前闸门（宿主 `tools/pre-execute` waterfall）：危险 live 变更在工具执行前要求宿主权限审批（`ask`）；无审批通道或策略为 `never` 时拒绝执行（见「执行前闸门」）；`false` 退回仅事后披露 |
| `reviewNotice` | `short` | 最终审核未完成时的末尾提示：`banner`=完整横幅+意见，`short`=一行，`off`=不显示（审核结果仍在插件内部记录） |
| `liveMutationPaths` | `.dsh/profiles`、`.dsh/plugins`、`program files`、`programdata`、`c:/windows` | `guardLiveMutation` / `guardPreExecute` 的受保护路径片段（大小写、斜杠不敏感） |
| `workspace` | `process.cwd()` | 本机 oracle 的查找起点 |
| `maxRounds` | `2` | 注入轮数上限（人工发新消息即重置） |
| `minScore` | `6` | 触发阈值，调高 = 更少打扰 |
| `maxFindings` | `8` | 最多列几条断言 |
| `minAnswerChars` | `240` | 断言级检查的篇幅门槛；不豁免操作取证 |
| `detectors` | `{}` | 单个检测器开关 |
| `verificationTools` | 兼容保留 | 已弃用，不参与放行或整轮豁免 |
| `denyBinaries` | `rm/del/format/…` | `verify_claims` 拒绝执行的程序 |
| `timeoutMs` | `15000` | 单条检查超时 |
| `language` | `auto` | 注入文本语言 |

---

## 检测器

| kind | 权重 | 抓什么 | Tier A 怎么判 |
|---|---|---|---|
| `command` | 2 | shell 代码块里的命令行 | 程序是否在 PATH（默认不执行） |
| `path` | 1 | `E:\...` / `/a/b/c` | `existsSync` |
| `version` | 2 | `v1.2.3`、`^4.0.4` | node_modules 实际版本 + package.json 范围 + 锁文件 |
| `symbol` | 2 | 反引号里的 `foo.bar()` | 在依赖/源码里找**定义位置** |
| `package` | 2 | 反引号里的包名 | node_modules 是否安装 + 联网 registry |
| `number` | 1 | `30 秒`、`12 MB` | 无机械判据 → `unverifiable` |
| `code` | 2 | 非 shell 代码块 | 同上 |
| `absolute` | 2 | 「一定」「绝对」「100%」 | 同上（靠提示词段约束） |
| `reversal` | 3 | 「抱歉我之前说错了」 | 把被推翻的结论重新核验 |

分数 = 各类命中权重之和，**每类默认最多计 3 条**。

---

## `verify_claims`

模型（或你）提交检查，插件真跑。除通用检查外还暴露四个本机 oracle，可直接调：

```json
{
  "checks": [
    { "kind": "command", "claim": "pnpm install --offline 能离线装依赖",
      "argv": ["pnpm", "install", "--offline"], "expectMatch": "downloaded 0" },
    { "kind": "packageVersion", "name": "typescript", "claim": "装了 typescript" },
    { "kind": "versionClaim", "claim": "typescript 9.9.9", "name": "typescript" },
    { "kind": "symbolExists", "claim": "normalizeConfig(raw)" }
  ]
}
```

回填（实测，带来源标签）：

```json
{
  "results": [
    { "ok": false, "kind": "versionClaim", "claim": "typescript 9.9.9",
      "detail": "✗ [node_modules/typescript] 实际 5.9.3，断言 9.9.9\n✗ [E:\\dsh-doubt\\package.json] 声明范围 ^5，断言 9.9.9" }
  ]
}
```

（上面这段是这台机器上的真实输出，不是示意。）

---

## 免打扰设计

1. **断言级检查没有正面反驳就不说话**：只有 `refuted`、带反驳来源的 `inconclusive`、或 Tier C 投票分裂才注入。操作取证和文档溯源各有独立触发条件。
2. **调用过工具不等于已验证**：取消了 `bash/read/grep/verify_claims` 等工具名出现即整轮跳过的规则；错误结果、无关读取和修改前的检查都不能证明任务完成。
3. **短回答只豁免断言级扫描**；最终正文仍审核。最终审核预算按宿主 turn 重置，旧 followup 预算按人工消息重置。
4. **状态闸**：回合后检查在 agent running 或 inbox 有积压时不注入；最终审核在当前请求内执行。

---

## 安全边界

- **默认不执行回答里的命令**：`executeAnswerCommands: false` 时只查程序是否存在于 PATH。含管道/重定向/`&&`/命令替换的命令行**拒绝解析**，标 `unverifiable`，不猜。
- **不经过 shell**：`argv` 直接 `spawn`；Windows 下遇 `.cmd`/`.bat` 才用 `cmd.exe /d /s /c` 包装并逐参转义。
- **黑名单**：`rm` / `del` / `format` / `diskpart` / `dd` / `reg` / `schtasks` / `vssadmin` / `wevtutil` 等直接拒绝。
- **超时**：默认 15 秒，超时 `SIGKILL` 并如实报告。
- **输出上限**：4000 字符截断。
- **`expr` 空沙箱**：`vm.runInNewContext` + 空 context，无 `require` / `process` / `globalThis`。
- **联网行为**：registry 查询会发送回答中的包名；探测访问 `probeUrls`。默认最终审核还会向当前模型 provider 发送真人请求、草稿和本轮工具参数/文本结果，额外消耗模型用量。关闭 `requireOperationEvidence` 可停用此请求；provider 不可用时审核报告未完成。Tier C 也使用宿主模型能力，registry 离线判定不代表完全不调用模型。

它**不**走 DSH 的沙箱与审批链——插件层的已知限制。要更严就收紧 `denyBinaries`，或 `verifyTool: false`。

---

## 操作取证闸

旧版 `turnHadVerification` 只看工具名就跳过整轮；短于 240 字、风险分低、没有机械反证也会退出。文档溯源位于这些豁免之前，所以看起来只有文档受到约束。

现在在 `llm/stream` 暂存完整最终正文，用同一 provider/model 的独立请求审核真人请求、草稿、本轮工具参数、原始结果与时序。审核器没有工具，不继承作者系统提示或思考内容。

1. 审核相关性、目标、结果、修改后的状态和用户验收要求。读取 README、False、写入回执不能证明程序修好了；不要求面向用户的正文包含工具 ID。
2. 审核通过必须逐段覆盖全文，内部引用实际 callId 与结果原文。插件机械检查覆盖、引用和操作后时序，语义相关性仍由模型判断。
3. 审核明确发现证据缺口时，`doubt_review` 回执替换草稿，宿主继续当前 turn。要求实际补查、遵守原授权，也允许诚实披露未完成。审核意见自身标为待核实。
4. 审核接口失败、超时、格式错误或材料超限是插件审核故障，不是任务失败。显示具体错误码**和校验器给出的原因**，保留已有工具记录，不发送补查回执、不启动回合后重复检查。JSON 非法或契约不满足（`INVALID_REVIEW`）会带着校验器的原话**重试一次**——格式错误不该等同于任务失败。
5. **审核永不吞掉回答**：预算内的驳回仍发 `doubt_review` 回执继续补查；但**终局退路**——补查预算用尽、审核服务故障、回放协议不支持——会把草稿**照常放行，并在末尾附一条横幅**（「以上草稿未经完整审核」+ 未核实意见或故障码/原因）。早期版本在终局扣留草稿，实测会把有用回答整段吞掉。
6. 审核输出用段落编号覆盖全文，段落按 ~400 字符分组（此前一行一段，长回答会让审核器每行输出一个 JSON 段）。输出截断时内部重试一次（12000 → 24000 tokens）并顺带丢掉可选历史，每次遵守 `reviewTimeoutMs`；该重试不执行用户工具。`partIds` 与 `text` 混用但拼接后仍覆盖草稿时予以接受；数字字符串与逗号连接的 `partIds` 也接受。
7. 整个请求按 `reviewMaxChars` 做预算，**当前轮工具记录也算在内**：装得下就整条保留，装不下就按份额截短，并写入显式截断标记与 `truncated`/`truncatedCalls`，因此工具输出很多的一轮不再以 `INPUT_LIMIT` 被扣留。历史记录最多只占预算的四分之一，普通请求不再顶满上限；万一仍然超时，会去掉历史重试一次。

**分段审核（`segmentedReview`，默认 `true`）**：整包（草稿 + 本轮证据）超出 `reviewMaxChars` 时，按 `draftParts` 把草稿切成最多 6 段，每段单独打包审核，每包能留更多空间给证据。任一段返回 `verify` 立即返回意见；某段审核服务失败时只披露未审完的段（「只有部分段落完成审核…」），不再整轮失败；装得下的草稿仍走原单包路径。`segmentedReview: false` 回退旧单包路径（可能超出预算并按 `INPUT_LIMIT` 失败关闭）。由受控 reviewer 测试覆盖（`test/segments.test.mjs`、`test/review-draft.test.mjs`）；真实长任务效果尚未实测。

**审核器的思考预算（`reviewReasoningEffort`，默认 `off`）**：审核调用原本不指定 reasoning 控制，宿主 DeepSeek adapter 会默认 effort=`high` 并开启 thinking（`dsh-llm-deepseek`：`options.reasoningEffort ?? connection.defaults.reasoningEffort ?? "high"`），而 thinking token 与 `max_tokens` 共用。用本机已落盘的 turn 4 审核包（52,672 字符 / 7 段）经真实宿主 `LlmRuntime` 重放复现：第 1 次尝试（12,000 token）**可见正文 0 字符**、finish=`max-tokens`；同一包 effort=`off` 在 2.9s / 325 output tokens 内给出有效判定。插件现在显式发送 `reasoningEffort`（默认 `off`），provider 不支持时自动去掉该字段重试，24,000 token 的重试也保持该设置；`default` 回退宿主默认（旧行为）。由 `test/review-effort.test.mjs` 覆盖；要真正在桌面宿主生效需要重新安装 + 重启。

**审核范围与预算（0.6.3）**：只有用户会据此行动的事实才必须有工具依据（实际执行的命令、路径、版本、标识、实测结果、完成/后置条件断言、当前环境状态）。叙述、背景、设计理由与总结不需要逐句引文，审核器不得仅因解释性文字缺少引文就返回 `verify`。`reviewMaxChars` 提高到 120000，让更多历史证据进入审核包；审核意见最多 3 条且必须能用包内记录修复。目标是最新实测到的剩余失败模式：长回答连续 3 次 `verify`（每次恰好 3 条意见）耗尽回执预算后按设计放行并附「自动补查预算已用尽」横幅。已由 `test/operations.test.mjs` 的指令断言覆盖；真实长回答效果需安装后实测。

**成本和边界**：每次最终回答增加模型调用和等待，包括短回答；输出截断最多再审核一次。审核用量目前不并入原回答 token 统计。带工具调用的中间正文会暂缓显示，工具照常经过宿主执行/审批流程；最终回答统一审核。已写入磁盘的文档仍使用原溯源规则。DeepSeek 思考内容/签名为协议继续执行而保留，不是审核后的最终正文。PTC-only 未暴露回执工具、未知思考回放协议不支持自动补查。材料是本轮文本工具证据，不能代替图像验收或完整历史任务管理。审核服务故障仍会阻止最终草稿显示，但不会误称“自动取证用尽”或要求重新操作。模型审核会漏判/误判，不保证消除幻觉。

实现：[src/completion.ts](src/completion.ts)、[src/operations.ts](src/operations.ts)。离线契约测试见 `test/operations.test.mjs`；真实宿主核心/循环测试见 `test/host.test.mjs`、`test/host-loop.test.mjs`。`eval/review-live.mjs` 用真实模型审核合成证据，网络失败计为 ERROR，不算正确拦截。

2026-10-17 的 0.5.1 验证：通过真实 LlmRuntime 和 deepseek-flash，分三次运行的 23 个合成案例符合预期（14 项拒绝、9 项放行）。同一长回答在旧 0.5.0 中触发 `max-tokens` 并复现“审核没有正常完成”，新版通过。另在真实 AgentLoop 的 UI 输出流确认中间结论被隐藏，审核接口 SERVER 故障没有触发重复操作。这些是有限样本，不是生产错误率，也不证明截图中的 Windows 任务已经修复。更新安装副本并重启 DSH 才会加载新代码；仓库测试不等于桌面已生效。

真实 AgentLoop 的故障注入测试还验证了：初始过早成功草稿被真实审核模型拦截后，真实执行模型自行回读临时配置，并提交了通过审核的回答，无需第二条人工消息。初始失败为人为注入，测试不操作真实应用。可用 `test/host-loop.test.mjs --app <安装目录> --live --account-home <DSH_HOME> --model deepseek-flash` 重跑。

---

## 危险变更闸门

2026-10-17，在 DSH 运行中把改过的插件装进 live profile 后，宿主所有工具报 `cannot get required service "sessionProjections" in inactive context`，重启 DSH 才恢复。热重载根因是**推断，未证实**（没有宿主日志）。`guardLiveMutation`（默认 `true`）把这次事故变成结构性检查：在审核器之前加一道确定性闸门，而不是只在提示词里提醒。

闸门用纯函数扫描本轮工具轨迹，识别下列危险变更（受保护路径片段来自 `liveMutationPaths`，大小写与斜杠不敏感）：

- 写或改 `.dsh/profiles/**`、`.dsh/plugins/**` 下的文件；
- `pnpm`/`npm`/`yarn`/`corepack` 的 `install`/`add`/`ci`/`rebuild`，且命令或工作目录命中 live 路径；
- 执行仓库安装脚本 `node scripts/install-local.mjs`（它会写 `.dsh/plugins`）；
- 杀进程、停服务、`shutdown`、重启电脑；
- 改注册表 / 服务 / 自启动（`reg add`、HKLM/HKCU 下的 `New-ItemProperty`、`schtasks /create`）；
- 递归删除（`Remove-Item -Recurse`、`rm -rf`、`del /s` 等）——0.8.0 起先解析目标：临时目录根（`%TEMP%`、`$env:TEMP`、`/tmp/`、`/var/tmp/`）与「提供的工作目录为非 live 时的相对/子路径递归删除」（如 `rm -rf node_modules`）属于正常清理，不再拦截；live 路径、系统目录、盘根，以及无法确定目标的命令仍然拦截；
- 写系统目录（默认受保护片段含 `Program Files`、`ProgramData`、`C:/Windows`）。

命中后，草稿不得作为完成结果放行，必须补齐三件产物；缺任何一件都会在**调用审核模型之前**确定性打回为 `verify`——这不是审核服务故障，也不会触发「未经审核」横幅。打回会逐条点名缺什么，以 `doubt_review` 回执交给作者：

1. **回滚路径**：备份位置**和**用户可直接执行的回滚命令。
2. **用户确认点**：动作**之前**的批准事件或用户明确授权。模型自行决定不算确认，草稿里自称「用户已确认」也不算。
3. **动作后独立健康检查**：变更**之后**另起一次工具调用并真实完成，证明宿主和工具仍可用。安装回执或变更自身的成功输出不算健康检查；健康检查失败时必须停止后续任务并直接给回滚步骤，不许继续干活。

三件产物齐全时继续走正常审核：审核器仍会核对完成声明与证据时序。注入的系统提示词段与审核指令带同一套硬规则：动作前先告诉作者，动作后由审核器执行。`guardLiveMutation: false` 完全回退旧行为；`liveMutationPaths` 用于替换受保护的路径片段（默认值见配置表）。

**覆盖与诚实边界**：识别规则、打回路径与事故时间线由 `test/guard.test.mjs` 的单元测试和受控 reviewer 测试覆盖。真实长任务与真实宿主会话**尚未验证**：推断的热重载机制没有宿主日志，闸门在真实 DSH 会话中的表现也没有观测记录。

---

## 执行前闸门

`guardLiveMutation` 只能扫描**已经发生**的工具调用：它在最终回答里披露危险变更，此时破坏已经发生。`guardPreExecute`（默认 `true`）把同一套规则搬到宿主的 `tools/pre-execute` waterfall——`@deepseek-ai/dsh-tools` 在工具体执行之前运行它（`prepareExecution` → `guardReason` → `Error: <reason>`；`{kind:'ask'}` 会走宿主 ApprovalService）：

- 危险 live 变更（写 `.dsh`、live `pnpm install`、安装脚本、递归删除、进程/服务/注册表改动）返回 `ask`，即使会话策略原本会自动放行，宿主也会弹出权限审批；
- 没有审批通道或策略为 `never` 时返回 `deny`，工具体**不会执行**；
- 普通仓库编辑与只读命令不受影响；本闸门不会覆盖其它 guard 的 deny/ask。

诚实边界：该闸门只识别 `liveMutationPaths` 与命令规则覆盖的危险动作，**不能判断操作是否有证据支撑**——「无依据断言」仍由最终回答审核负责。已在真实 `ToolRuntime` 上验证（`test/host.test.mjs`：危险调用在执行前被拒绝、工具体未运行；普通 `node --version` 正常执行），并在 `test/guard.test.mjs` 覆盖 ask/deny/allow、`never` 与无审批通道分支。

`reviewNotice`（默认 `short`）控制最终审核未完成时的末尾提示：`banner` 保留完整横幅与审核意见，`short` 追加一行，`off` 不追加任何提示。审核结果仍记录在插件内部，这个开关只改变用户看到的内容。

## 逐步骤溯源表（0.7.0–0.8.2）

本表逐条列出 0.7.0–0.8.2 变更中每条断言的依据。**有出处** = 本机可核对（宿主源码路径+行号、版本号、本仓库命令输出）；**无依据** = 工程经验或推断，保留在表中并显式标注。本节不引入外部链接；以下条目于 2026-10-18 机械核对（本地文件读取、`npm run doctor`、`npm test`、实机工具输出）。

| # | 步骤 / 断言 | 依据 | 分类 |
|---|---|---|---|
| 1 | 宿主在工具体执行前运行 `tools/pre-execute`，并消费 `{kind:'allow'\|'ask'\|'deny'}` | 宿主包 `%TEMP%\dsh-asar\dsh\node_modules\@deepseek-ai\dsh-tools\lib\types\index.js:885`（`ctx.waterfall(carrier,'tools/pre-execute',…)`）与 `:1102`（`serviceAsk`），行内容已读 | 有出处 |
| 2 | `ask` 走 ApprovalService；无审批通道或策略 `never` → deny | 同一宿主文件 `:1102`；实机拒绝原文「approval 缺失或策略为 never … 已拒绝执行」 | 有出处 |
| 3 | 默认值 `guardPreExecute: true`、`reviewNotice: 'short'` | `src/config.ts:64,67,124,125`；`normalizeConfig({})` → `reviewNotice=short guardPreExecute=true` | 有出处 |
| 4 | 仓库版本 0.8.2（两个清单一致） | `package.json` / `dsh-plugin.json` 实测 → `0.8.2` / `0.8.2` | 有出处 |
| 5 | live 安装版为 0.8.1（0.8.2 尚未安装） | `C:\Users\Example\.dsh\plugins\dsh-doubt\package.json` → `installed-live=0.8.1`；`npm run doctor` → 13 PASS / 2 FAIL：`FAIL installed-version: repo=0.8.2 installed=0.8.1`、`FAIL lib-identical: … differing=4`（live 仍是 0.8.1 时的预期差异） | 有出处 |
| 6 | 0.8.0 递归删除判定（temp 放行；系统/live/盘根/未知保守拦截） | `src/guard.ts:166`（`dangerousDeleteTarget`）；`test/guard.test.mjs` 用例；`npm test` exit 0 | 有出处 |
| 7 | 0.8.1 写入方向判定；规则 id `live-path-shell-mutation` | `src/guard.ts:198`（`writeDestination`）、`:241`、`:246`；guard 测试；实机 copy-out `copy-out-executed=True`、`copied-version=0.8.1` | 有出处 |
| 8 | 0.8.2 `deleteTargets` 只取路径状 token；符号 `targets.some(...)` | `src/guard.ts:142`、`:231`、`:236`、`:237`；新增 guard 用例；`npm test` 11 文件 OK | 有出处 |
| 9 | 规则 id `install-local-script` | `src/guard.ts:231` | 有出处 |
| 10 | 实机写入 `.dsh/plugins/**` 被闸门拒绝 | 实机工具输出：「危险变更闸门 … live-path-shell-mutation … 已拒绝执行」 | 有出处 |
| 11 | 0.8.1 下字面 temp 路径 `Remove-Item -Recurse` 仍被拒（`recursive-delete`） | 实机工具输出：「recursive-delete … 已拒绝执行」 | 有出处 |
| 12 | 0.7.0→0.8.1 升级执行了构建、备份、复制、`pnpm install --offline`、48 文件 hash 校验并重启 DSH | `_diag\upgrade-console.log` 2026-10-18 17:00:25 行（`installed version: 0.8.1  lib files: 48  diffs: 0`、`OK: 升级完成`、`started DeepSeek Harness`） | 有出处 |
| 13 | 0.8.1 的 temp 删除被拒是 `deleteTargets` 把尾部 `Write-Host`/消息 token 当目标导致 | 代码路径 + 新测试可复现分类差异，但未对旧 0.8.1 构建加插桩重跑同一命令 | **无依据（推断）** |
| 14 | 会话内启动的 watcher 在 DSH 退出时被结束 | 仅两次观测（日志只有 start 行、重启后进程不存在）；无进程树/宿主日志证据 | **无依据（推断）** |
| 15 | 回滚命令可直接执行 | 备份实测存在（`install-backup-20261018-133825` → 0.6.3；`offline-upgrade-backup-20261018-170025` → 0.7.0），但复制/`pnpm` 命令未实际执行 | **无依据（未执行）** |

注：第 7、8、12 行引用的命令输出为会话内实测，其中只有第 12 行的升级日志已落盘到仓库；其余可复跑 `npm test` / `test/guard.test.mjs` 复核。

## 溯源闸

断言级核验在**散文文档**上几乎没用：在一份真实的 46k 字部署手册上实测，机械判定只覆盖 21 条断言——20 条判不了，剩下 1 条还是假证伪。但同一个模型被问一句「所有的部署流程是否都有据可依？」之后，自己产出了 42 项 / 9 类的溯源表。**能力在，触发器不在。** 所以这道闸不判文档对错，只强制要一个具体产物。

- 触发条件：本轮 **write/edit 写出了交付文档**（`.md`/`.txt` 等，排除 `logs/`、`tmp/` 等），正文没有出处小节，且扫描到的具体断言够多。
- 注入内容：要求补一份**逐步骤溯源表**——每条要么**有出处**（链接/文档标题/版本号），要么**无依据**；无依据的必须留在表里并显式标注。
- 关闸开关就是那个产物本身：文档一旦带上出处小节（`溯源|出处|逐步骤|参考文献|来源总表|未验证项`），永不再问。
- 噪音控制：**同一份文档只问一次**；独立预算，一次人工回合最多 4 次（不受 `maxRounds` 影响）；不参与断言级那条路径。

真实会话实测：一个 126 轮的文档密集会话产生 **6 次要求——每份交付文档一次，而不是每次写入一次**；一个 11 轮的编码/分析会话 **0 次**；上面那份手册在溯源附录存在**之前**触发 **1 次**、存在**之后** **0 次**。

---

## 开发

```bash
pnpm install            # 联网
pnpm install --offline  # 已有 pnpm store 时
npm run host:unpack     # 解包已安装 DSH 的 app.asar 供宿主级检查使用（自动定位安装目录，可用 --app 覆盖）
npm run doctor          # 已安装插件是否与当前仓库一致、是否真的在运行（见下）
npm run verify          # tsc 检查 + 构建 + 11 套测试 + smoke + 仓库自检 + 宿主测试 + 外部裁判
# 两个宿主测试与外部裁判需要已安装的桌面应用；找不到时打印 SKIP 并以 0 退出，不会误报失败。
npm run verify:host
npm run verify:host-loop
# 可选联网评测：消耗所选账户用量，仅发送合成案例
npm run eval:review -- --app <DSH安装目录> --account-home <DSH_HOME> --model deepseek-flash
```

需要**已解包宿主**的那几项，在宿主缺失、**陈旧或不完整**时会打印 `SKIP` 并说明原因：桌面应用
升级后跑一次 `npm run host:unpack`，或用 `DSH_ASAR_DIR` 指向已有的解包目录。半个 asar 只会
被报成 `SKIP`，不会被报成 `FAIL` —— 宿主副本里少了个模块，说明不了这个插件有问题。

`npm run doctor` 回答另一个问题：**已安装的插件是否与当前仓库一致、是否真的在跑？** 实现参考了
生态里 `dsh-verdict` 的 `doctor` 子命令（只做静态可判定的事，装载本身交给真实运行）。它打印
PASS/FAIL：仓库与安装版版本、`dsh-plugin.json` 版本；仓库 / live 安装目录 / profile 链接三处
`lib/` 是否逐字节一致；profile 的依赖与 bundle 行；安装版 `cordis.patch.yml` 是否为顶层
`- insert:` 数组并声明 `guardLiveMutation` / `reviewReasoningEffort` / `segmentedReview`；
组合后的 `cordis.yml` 是否含 `- id: dsh-doubt`；Node engine 范围。随后读取本机最新的会话存储
（`session.v4.jsonl.zstd` 由一串独立 zstd 帧组成），只报告不判失败的运行证据：注入的提示词段
（0.6.x 的「危险变更闸门」段）是否出现在落盘的 `system/message` 里、落盘最终回答中带
「未经完整审核」横幅的条数（`banner,banner,…,clean` 展示最近六条）、以及真实会话里
`verify_claims` / `doubt_review` 的调用次数。安装/重启后出现一条无横幅的回答，是「审核确实
完成过」的行为证据——不代表审核判得对。`npm run doctor -- --json` 输出同样的 JSON。

| 文件 | 职责 |
|---|---|
| [src/index.ts](src/index.ts) | 入口：工具、提示词段、取证循环、联网探测 |
| [src/scanner.ts](src/scanner.ts) | 风险扫描器（纯函数） |
| [src/completion.ts](src/completion.ts) | 显示前审核、证据契约、回执和失败关闭 |
| [src/operations.ts](src/operations.ts) | 工具调用/原始结果配对与执行状态 |
| [src/guard.ts](src/guard.ts) | 危险变更识别与回滚/确认/健康检查三件产物评估（纯函数） |
| [src/claims.ts](src/claims.ts) | 断言 → 可执行检查（含安全解析） |
| [src/local.ts](src/local.ts) | Tier A 本机 oracle |
| [src/evidence.ts](src/evidence.ts) | Tier A/B 编排 + 判定规则 |
| [src/factored.ts](src/factored.ts) | Tier C 独立重推导 + 多数投票 |
| [src/network.ts](src/network.ts) | 联网探测（带 TTL 缓存） |
| [src/verify.ts](src/verify.ts) | 通用检查执行器 |
| [src/loop.ts](src/loop.ts) | `agent/status` → 取证 → `agent.followup` |
| [src/prompts.ts](src/prompts.ts) | 证据注入文本与提示词段（中英） |
| [src/config.ts](src/config.ts) | 配置 + StandardSchemaV1 |

用到的宿主扩展点：`ctx.tools.register()`、`ctx.systemPrompt.section()`、`ctx.on('agent/status', …, {global:true})`、`agent.session.snapshotEvents()`、`agent.followup()`、`ctx.subagents.start()`（Tier C，缺失时自动降级）。

---

## 实测：它到底有没有用

评测在 `eval/`，可复现（`npm run eval:corpus` → `eval:extract` → `eval:sample` → 人工定真值 → `eval:score` / `eval:delta`）：

- **语料**：宿主会话存储里 **152 条真实真人轮回答**（多帧 zstd 解压，19852 事件、185 轮）。不编题目、不自答。
- **真值**：分层抽样 44 条断言，用**独立手段**核实（`Test-Path`、跨仓库 grep、npm registry、宿主 `d.ts`），不用插件自己的 oracle。
- **指标不是「准确率」**，而是两类危险错误：假证伪（把对的判成错，会把正确回答改坏）、假证实（给幻觉背书）。

| 指标 | v0.2（修复前） | v0.3（修复后） |
|---|---|---|
| 抽取忠实度 | 24/44 = 54.5% | — |
| 证伪条数（全量语料） | 645 / 1345 | **8 / 1162** |
| 证伪精度（逐条独立核实） | **0/13 = 0%** | **5/8 = 62.5%**（剔除我自己消息里的示例后 5/5） |
| 假证实 | 0/12 | 0 |
| 会插话的回答 | **152/152 = 100%** | **7/152 = 4.6%** |
| 可机械核验的断言 | — | 86/1162 = **7.4%** |

修复前它是**净负收益**：对每一轮都插话，而证伪通道实测精度为 0——一个会编造反驳的工具比没有更糟。修复后它是一张**很窄的网**：只对 4.6% 的回答说话，说的时候 5/8 确实抓到了（那 5 条都是回答断言存在、实测不存在的文件）。

最后一行最该记住：**真实回答里只有约 7% 的断言是这台机器能机械判定的**。它不是通用幻觉解药，是一张针对「文件 / 包 / 命令 / 版本」的小网；其余断言仍要靠取证工具与外部来源。

---

## 已证实 / 未证实

**已实测（有测试覆盖）**：本机 oracle 的判定正确性（PATH、包版本、版本断言、符号定义）、判定规则（来源数、冲突、弱证据中性）、断言翻译的安全约束、Tier C 投票与分裂处理、循环的预算与免打扰、注入的是证据而非请求。

**未实测**：端到端「开插件 vs 不开插件」的错误率下降幅度。文献支持的是**机制**（外部反馈有效、内在自纠错有害），不是本插件的具体效果。要判定它有没有用，需要按同等推理成本对比四档：基线 / 仅提示词段 / Tier A+B / Tier A+B+C。

**已知失效模式**：
- 扫描器是启发式，会漏也会误报。裸编号（`2402.06380`）现在会被当版本类断言抓出来并标 `unverifiable`，但**不带数字形态的错**（记错的函数名、编错的字段名写在正文里而没加反引号）仍然抓不到。
- Tier A 只能核验**本机可判**的断言；事实性断言（「这篇论文说了 X」）离线时只能走 Tier C。
- Tier C 依赖宿主提供子代理能力，缺失时如实降级。
- 多花模型调用与 token；`minScore` 调高、`maxRounds` 调低可控成本。

---

## 本 README 的逐步骤溯源表

这个项目的全部主张就是「断言要带依据」，所以 README 也得按自己的标准来：下面每一条承重论断
要么**有出处**（能从仓库里的文件、宿主源码行或你能跑的命令核实），要么**无依据**（我自己的实测
或工程判断）。无依据的**保留并显式标注**，不删。

| # | README 里的断言 | 依据 | 怎么核对 / 为什么核不了 |
|---|---|---|---|
| 1 | 11 套测试 + smoke，另有 13 项仓库自检 | **有出处** | `package.json` 的 `test` 脚本串了 11 个 `node test/*.test.mjs`；可用 `npm run verify` 重跑 |
| 2 | 版本 0.8.2，`package.json` 与 `dsh-plugin.json` 一致 | **有出处** | `npm run audit` 输出 `版本一致：0.8.2` |
| 3 | 挂载行**必须**用顶层 `insert:`，否则宿主根本不挂 | **有出处** | 宿主 `@deepseek-ai/dsh-app-boot` 的 `applyEntryPatches` 从空列表起算；可用一次性 profile 跑 `dsh --profileX --dump-config` 复现——无 `insert:` 时 stdout 2 字节、stderr 报 `patch: entry "dsh-doubt" not found`；有 `insert:` 时 stdout 461 字节且含 `- id: dsh-doubt`（`npm run verify:independent` 第 1 项） |
| 4 | 服务只能通过 `ctx.inject` 解析；在外层 ctx 上读会抛错 | **有出处** | `@deepseek-ai/cordis/src/reflect.ts:144` = `lib/index.js:676`：`cannot get property "${prop}" without inject`；`verify:independent` 第 3 项在真实 cordis 上注册成功 |
| 5 | 会话工作目录是 `exec.agent.session.header.cwd` | **有出处** | 宿主源码两处独立一致：`dsh-tool-fs/lib/index.js:173`、`dsh-tool-bash/lib/index.js:294` |
| 6 | `verify_claims` 注册 6 种检查 | **有出处** | `src/tool.ts` 的 `CHECK_KINDS`；活体调用返回 `workspace: { cwd, source }` |
| 7 | 断言级只在**正面反驳**时插话，判不了就不说话 | **有出处（由测试保证）** | `test/loop.test.mjs` 覆盖预算与沉默条件 |
| 8 | 评测语料：152 条回答、19852 事件；证伪 645/1345 → 8/1162；精度 0/13 → 5/8 = 62.5%；会插话的回答 152/152 → 7/152 = 4.6% | **无依据——从本仓库复现不出来** | 原始产物在 `eval/out/`，而这些**刻意不进版本库**（它们抽自本机真实会话，含回答原文、本机路径与内网地址）。生成脚本（`eval/*.mjs`）在仓库里，你可以用**自己的**会话重建一份等价语料，但**无法**重新得出这几个数字。另外：我对那份语料重新量过一次事件数是 **19879** 而不是 19852，差异我没能对上——所以具体计数请当作近似值 |
| 9 | 溯源闸对同一份文档只问一次，不是每次写入都问 | **有出处（由测试保证）** | `test/loop.test.mjs`（同路径两次 → 一次；仅大小写不同 → 一次）；一个真实 3 轮会话里对同一文件写了 **41 次**，只产生 **1** 次要求 |
| 10 | 「126 轮文档会话 6 次」「11 轮编码会话 0 次」「手册审计前 1 次、审计后 0 次」 | **无依据——本人回放，脚本未保留** | 用真实循环跑本机会话日志，但那个 harness 是临时脚本、已删除，**无法重跑**。独立验证者只复核过「同路径 3 次 → 1 次」，没复核这些总数。「审计前」那版手册是我**构造**的（删掉附录 A/B/E 还原成审计前状态），不是真实历史文件 |
| 11 | 约 98.6% 的轮次被「已经核验过」那道闸压掉 | **无依据——本人计数** | 用临时脚本在本机会话日志上统计，脚本已删除 |
| 12 | 真实 46k 字手册上的证伪：`{"refuted":1,"unverifiable":20}` → 修完 `{"unverifiable":21}` | **无依据——本人实测** | 同一个已删除的 harness；那唯一一条证伪是 `npu-smi info`，它本身就是错的（设备 CLI 属于目标机器） |
| 13 | 端到端错误率差值（开/关插件对比） | **无依据——没测** | 上面「已证实 / 未证实」里已声明未测；需要等推理成本的四个对照组 |
| 14 | 顶部图标 `assets/icon.png` 是 512×512 PNG，另有 256×256 PNG 与多尺寸 `.ico` | **有出处** | 用 Pillow 12.3.0 实测读回：`icon.png → (512, 512)`、`icon-256.png → (256, 256)`、`icon.ico → {16, 24, 32, 48, 64, 128, 256}` |
| 15 | 图标由 `assets/make-icon.py` 生成（Pillow，4× 超采样，LANCZOS 下采样） | **有出处** | 已提交的脚本实测含 `from PIL import Image, ImageDraw`、`SS = 4`、`LANCZOS`（三次 grep 均为 `True`）；PNG/ICO 已随仓库提交，重跑脚本可复现 |
| 16 | `package.json` 的 `files` 打包这三张图标 | **有出处** | `node -e "console.log(require('./package.json').files)"` 实测输出 `["lib","cordis.patch.yml","dsh-plugin.json","assets/icon.png","assets/icon-256.png","assets/icon.ico","README.md","README.zh-CN.md","CHANGELOG.md","LICENSE"]` |
| 17 | 本 README 的 clone 地址指向 `github.com/Yangxingyu789/dsh-doubt` | **有出处** | 占位符 `<你的GitHub账号>` 恰好替换 5 处（README.md 1、README.zh-CN.md 1、package.json 3），残留 0 处；`git remote -v` 的 `origin` 是同一地址 |
| 18 | 该仓库确实存在，且写这张表时是**私有**的 | **有出处** | 用本机已登录的浏览器会话实测加载：HTTP 200、标题 `Yangxingyu789/dsh-doubt: …`、页面含 `svg.octicon-lock` 与 `Private` 字样、无 `Public`；另一个独立来源：匿名 `GET https://api.github.com/repos/Yangxingyu789/dsh-doubt` 返回 **404** |
| 19 | 它目前仍是空仓库（还没有推送成功） | **有出处** | 同一页面命中 GitHub 的空仓库引导文案（`…or push an existing repository`）；本地提交 `7e3d42b` 存在，但 push 尚未完成 |
| 20 | `npm run verify` 现在也覆盖宿主测试与外部裁判，而不只是 tsc/测试/自检 | **有出处** | `package.json` 的 `verify` 串上了 `verify:host && verify:host-loop && verify:independent`；上一版（`git show HEAD:package.json`）止于 `npm run audit`，所以这三项全红时 `verify` 仍然是绿的 |
| 21 | 宿主测试不需要 `--app` 也能找到已安装的桌面应用 | **有出处** | `scripts/host-app.mjs` 依次探测 `--app`、`DSH_APP_DIR`、运行中的 `DeepSeek Harness` 进程与常见安装位置；本机实测：改动后不带任何参数跑 `npm run verify:host`、`npm run verify:host-loop` 均通过 |
| 22 | 宿主解包陈旧或不完整时报 `SKIP`，不报 `FAIL` | **有出处** | `scripts/verify-independent.mjs` 的 `hostUnpackProblem()` 检查 CLI、`dsh-app-boot/package.json` 与 `.unpacked.json` 标记是否与当前 `app.asar` 一致；标记由 `scripts/unpack-host.mjs`（`npm run host:unpack`）写入 |
| 23 | 本机原先的解包是陈旧且不完整的：287 个包里有 87 个缺 `package.json` | **有出处（重新解包前实测；该状态现已不存在）** | 实测：`dsh-asar` 时间为 2026-10-16 21:01，而 `app.asar` 为 2026-10-17 12:49；287 个包里 87 个缺 `package.json`，导致 `dsh-app-boot/index.js` 报 `ERR_MODULE_NOT_FOUND`。跑 `npm run host:unpack` 后写入 16711 个打包文件 + 1583 个 unpacked 文件（18294 = asar 头自报的数量），外部裁判变成 6 PASS / 0 FAIL / 0 SKIP |
| 24 | 工具输出多的一轮曾超过 `reviewMaxChars`，审核闸把整段最终回答按 `INPUT_LIMIT` 扣留 | **有出处（用本机会话记录实测）** | 用插件自己的 `buildReviewPacket` 从该会话的工具事件复算：第 6 轮 **77 次调用 / 209,267 字符**结果，payload 达 **216,921** 字符（上限 120,000）；同一轮修复后为 **119,735** 字符 |
| 25 | 超长工具结果按份额截短并带显式标记，不静默丢弃，且当前轮每条调用都保留 | **有出处（源码 + 测试）** | `src/completion.ts` 的 `clipRecord()` 追加 `[dsh-doubt] result truncated: kept N of M chars` 并写入 `truncated`；`test/operations.test.mjs` 的 flood 用例（77 × 2,700 字符）断言 payload ≤ 上限、77 条全在、`truncatedCalls > 0`，且从保留前缀取引文仍能通过校验 |
| 26 | `npm run verify` 现在会跑全部四种 host-loop 场景 | **有出处** | `package.json` 的 `verify:host-loop` 串上默认、`--exhausted`、`--reviewer-error`、`--history`；实测：修复文案前 `--exhausted` 断言失败（期望 自动取证轮数已用尽），修复后四种全过 |
| 27 | 历史记录把大多数审核请求填到约 119.7k 字符 | **有出处（实测）** | 用插件自己的 `buildReviewPacket` 从本机会话逐轮复算：第 1–7 轮分别为 81,757 / 119,724 / 119,570 / 119,738 / 119,713 / 119,706 / 119,668 字符（当时上限 120,000） |
| 28 | 这使审核调用超过 60s 截止，回答按 `REVIEW_TIMEOUT` 被扣留 | **有出处** | 受影响那轮审核闸自己的提示是 `插件审核服务出错（REVIEW_TIMEOUT）`；修复后 `reviewMaxChars` = 48,000、历史最多占预算 1/4、`reviewTimeoutMs` = 120,000 ms，并在超时后去掉历史重试一次 |
| 29 | 历史预算与超时重试都有测试覆盖 | **有出处（由测试保证）** | `test/operations.test.mjs`：120 条历史的用例断言 payload < 48,000×0.8 且当前轮证据仍优先；超时用例断言恰好重试一次并随后放行草稿 |
| 30 | 长回答时审核器输出预算两次耗尽（`max-tokens`），草稿被扣留 | **有出处（本机会话日志实测）** | 本会话日志记录第 8 轮为 `插件审核服务出错（max-tokens）`；同一日志里第 6 轮是 `INPUT_LIMIT`、第 7 轮是 `REVIEW_TIMEOUT` |
| 31 | 段落改为按 ~400 字符分组，截断重试改用 12000→24000 tokens 并丢掉历史 | **有出处（源码 + 测试）** | `src/completion.ts` 的 `draftParts()` 分组与 `finish === 'max-tokens'` 重试分支；`test/operations.test.mjs` 断言 200 行短句合并成 ≤30 段且拼回原文一致，并断言重试时 `maxTokens=24000` 且只剩当前轮记录 |
| 32 | `INVALID_REVIEW` 只出自 `validateReview` 的 `fail()` 分支，本会话出现过一次 | **有出处（源码 + 会话日志）** | `src/completion.ts` 的 `fail()` 返回 `failure.code = 'INVALID_REVIEW'`；本会话日志里恰好一条：turn 12，本地时间 17:09:34 |
| 33 | 契约不满足/JSON 非法现在会带着校验器原因重试一次；`partIds` 与 `text` 混用在正文覆盖一致时接受；提示带具体原因 | **有出处（源码 + 测试）** | `src/completion.ts` 的 `repair()`/`repairNote` 与放宽后的覆盖分支；`test/operations.test.mjs` 断言重试请求含 "rejected by the output validator" 与 `partIds 0..0`、非法 JSON 会重试、混用表示可放行、`{partIds:[0,2]}` 报出 `partId` 细节 |
| 34 | 危险变更闸门在缺少回滚 / 用户确认 / 动作后独立健康检查时拒绝放行 | **有出处（由测试保证）** | `test/guard.test.mjs`：事故时间线（安装脚本 → live profile `pnpm install` → 无后续调用）以 `verify` 打回且 0 次审核模型调用；三件齐全时继续审核；`guardLiveMutation: false` 走旧路径 |
| 35 | 2026-10-17 事故：DSH 运行中写入 live profile 后所有工具报 `cannot get required service "sessionProjections" in inactive context`，重启后恢复 | **无依据——没有宿主日志** | 记录来自交接文档与会话时间线；热重载根因是推断，闸门在真实宿主会话中的效果未实测 |
| 36 | 反复出现的 `max-tokens` 横幅来自审核器 thinking 吃光输出预算；显式发送 `reasoningEffort` 可以修复 | **有出处（对已落盘会话包做真实重放）** | 把本机落盘的 turn 4 审核包（52,672 字符 / 7 段）经真实安装版宿主 `LlmRuntime` + DeepSeek adapter 重放：第 1 次尝试（12,000 token）返回 `outputTokens=12000`、`rawChars=0`、finish=`max-tokens`；同一包设 `reasoningEffort="off"` 后 2.9s / 325 output tokens 返回判定。会话证据：落盘的 system message（seq 706，turn 4）含闸门段，而 turn 1 的不含 |

如果你希望第 8、10、11、12 条变成「有出处」，诚实的做法只有两条：(a) 提交一份**脱敏后**的语料
（去掉会话 ID 与路径），让这些数字可重建；或 (b) 重新推导一遍，并写明测于哪个 commit。

---

## 许可

MIT
