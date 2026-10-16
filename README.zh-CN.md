# dsh-doubt

**用分层取证替代「你确定吗」。**

模型第一遍回答经常不严谨：命令没跑过、路径没确认、版本号是记忆的、API 签名是编的。你只能反复追问「你确定吗」——它每次真去查都能查出问题，于是一个可靠结论要问好几次。

`dsh-doubt` 把这件事自动化，但**不是**让模型「再想想」：每轮结束后，**插件自己**用本机确定性来源和（联网时的）多来源交叉去核验回答里的断言，然后把**实测证据**注入下一轮。

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

结论：**「你确定吗」是有害的多次检查；「换个独立上下文重推导一遍并投票」是有效的多次检查。** 本插件只做后者。

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
git clone https://github.com/YOUR_NAME/dsh-doubt.git
cd dsh-doubt
pnpm install --offline
node scripts/install-local.mjs --dry     # 先看会改什么
node scripts/install-local.mjs
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm install --offline
# 重启 DSH 宿主
```

---

## 配置

在 profile 的 `cordis.patch.yml` 里加同 id 条目覆盖（后加载优先）：

| 字段 | 默认 | 作用 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `verifyTool` | `true` | 注册 `verify_claims` |
| `promptSection` | `true` | 注入分层取证规则 + 硬性禁令 |
| `autoVerify` | `true` | 插件自己跑 Tier A/B 并注入证据 |
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
| `workspace` | `process.cwd()` | 本机 oracle 的查找起点 |
| `maxRounds` | `2` | 注入轮数上限（人工发新消息即重置） |
| `minScore` | `6` | 触发阈值，调高 = 更少打扰 |
| `maxFindings` | `8` | 最多列几条断言 |
| `minAnswerChars` | `240` | 短回答不触发 |
| `detectors` | `{}` | 单个检测器开关 |
| `verificationTools` | 见源码 | 本轮出现过即视为已取证 |
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

1. **没有正面反驳就不说话**：只有 `refuted`、带反驳来源的 `inconclusive`、或 Tier C 投票分裂才注入。单纯「核验不了」**不打扰**——v0.2 那版「非 confirmed 就说话」实测会对 100% 的回答插话，纯噪音。
2. **本轮已取证不打扰**：出现过 `bash` / `read` / `grep` / `web_search` / `verify_claims` 等。
3. **短回答不触发**；**轮数上限** `maxRounds`，人工新消息即重置。
4. **状态闸**：agent `running` 或 inbox 有积压时不注入。

---

## 安全边界

- **默认不执行回答里的命令**：`executeAnswerCommands: false` 时只查程序是否存在于 PATH。含管道/重定向/`&&`/命令替换的命令行**拒绝解析**，标 `unverifiable`，不猜。
- **不经过 shell**：`argv` 直接 `spawn`；Windows 下遇 `.cmd`/`.bat` 才用 `cmd.exe /d /s /c` 包装并逐参转义。
- **黑名单**：`rm` / `del` / `format` / `diskpart` / `dd` / `reg` / `schtasks` / `vssadmin` / `wevtutil` 等直接拒绝。
- **超时**：默认 15 秒，超时 `SIGKILL` 并如实报告。
- **输出上限**：4000 字符截断。
- **`expr` 空沙箱**：`vm.runInNewContext` + 空 context，无 `require` / `process` / `globalThis`。
- **联网行为**：只向 `registryUrls` 配置的公开 registry 发 GET。**注意**：URL 路径里会带上从回答中抽出的**包名**（`/registry/<pkg>`），所以包名会离开本机；除此之外不传输任何内容。联网探测只访问 `probeUrls`，不带参数。离线时完全不出网。

它**不**走 DSH 的沙箱与审批链——插件层的已知限制。要更严就收紧 `denyBinaries`，或 `verifyTool: false`。

---

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
npm run verify          # tsc 检查 + 构建 + 6 套测试
```

| 文件 | 职责 |
|---|---|
| [src/index.ts](src/index.ts) | 入口：工具、提示词段、取证循环、联网探测 |
| [src/scanner.ts](src/scanner.ts) | 风险扫描器（纯函数） |
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

## 许可

MIT
