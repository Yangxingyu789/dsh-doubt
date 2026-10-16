# 更新日志

## 0.3.0（评测驱动的重写）

### 新增：真实语料评测

- `eval/corpus.mjs`：从宿主会话存储（`~/.dsh/sessions/**/*.jsonl.zstd`，多帧 zstd）解出 **152 条真实真人轮回答**（19852 事件、185 轮）作为评测输入。不编题目、不自答。
- `eval/extract.mjs`：对每条回答跑插件管线，离线/联网各一遍，产出 1345 条断言及其证据链。
- `eval/sample.mjs`：按 类型×判定 分层抽样并带原文上下文，供人工定真值。
- `eval/score.mjs` + `eval/out/labels.json`：44 条断言的**独立真值**（用 `Test-Path`、跨仓库 grep、npm registry、宿主 d.ts 核实，不用插件自己的 oracle）。
- `eval/delta.mjs`：修复前后按 `session#turn#kind#snippet` 对齐对照。

### 评测测出的问题（修复前）

| 指标 | 实测 |
|---|---|
| 抽取忠实度 | 24/44 = **54.5%** |
| 有效证伪（抽取对 + 是断言 + 真的错） | **0/13 = 0%** |
| 无效证伪 | 抽取错 9 ＋ 非断言 1 ＋ 假证伪 3 |
| 会插话的回答 | **152/152 = 100%** |

结论：**修复前净负收益**——每轮都插话，而证伪通道实测精度为 0。

### 修复（按失效类型逐条对应）

- **命令抽取**：空 lang 与 `text` 围栏不再当 shell；日志/表格/散文行（CJK、`=>`、时间戳、`PID`、`MiB`…）拒绝；未加引号且含空格的可执行路径不猜 argv。→ 命令断言 176 → 18。
- **路径抽取**：盘符前加词边界，`https://…` 不再截出 `s://…` 去文件系统找；Windows 上的 POSIX 风格路径（多为 API 端点）标无法核验，不反驳。
- **包名抽取**：拒绝域名、文件名后缀、大写、数字开头。→ 包断言 286 → 220。
- **「本机没有」不再等于「回答错了」**：`packageVersion` 的本机缺失改为中性弱证据，无正面来源时 `noEvidence`。这是最大的一类假证伪来源。
- **符号存在性**：找不到标识符 → `noEvidence`（回答可能在讲别的仓库/语言），不再反驳；扫描**排除插件自己的包**（评测抓到 `agent.followup()` 被插件自己生成的 `lib/loop.d.ts` 证实——自指背书）。
- **单一闸门**：`evidence.ts` 的 `localOracle` 曾内联一套自己的 `existsSync` 判定，绕过 `claims.ts` 的守卫。现在 `checks` 为空必须照实返回无法核验。
- **插话闸门**：从「非 confirmed 就说话」改成「**只有正面反驳（refuted / 有反驳的 inconclusive）或独立重推导投票分裂才说话**」。单纯核验不了 → 沉默。

## 0.2.0

把「自动追加复核轮」改成「分层取证 + 注入实测证据」。原因是文献与实测都表明：**内在自纠错（只让模型再看一遍）会让结果变差**（[arXiv 2310.01798](https://arxiv.org/abs/2310.01798)：GPT-4 GSM8K 95.5→89.0，Llama-2 62.0→36.5；改动案例里把对的改成错的多于把错的改对），而**外部反馈**才有效（[arXiv 2305.11738 CRITIC](https://arxiv.org/abs/2305.11738)）。

### 新增

- **Tier A 本机确定性 oracle**（`src/local.ts`，完全离线）：`PATH`/`PATHEXT` 查找、`node_modules` 安装版本、`package.json` 声明范围、锁文件记录、标识符**定义位置**查找。机器当裁判，不依赖模型配合。
- **Tier B 多来源交叉**（`src/evidence.ts` + `src/network.ts`）：联网时 `confirmed` 需要 `requireSources`（默认 2）个互相独立的来源一致；registry 查询只走公开接口。
- **Tier C 独立重推导 + 多数投票**（`src/factored.ts`）：把断言改写成自包含提问，交给**没有草稿上下文**的子代理回答 N 次取多数（CoVe 的 factored 思路 + self-consistency）。投票分裂就如实报分裂，不硬给结论；宿主没有子代理能力时如实降级。
- **四种判定**：`confirmed` / `refuted` / `inconclusive` / `unverifiable`，每条带来源标签；没有「大概对」这一档。
- **弱证据模型**：标识符只在调用位置出现算**中性**，既不确认也不反驳。
- **断言翻译层**（`src/claims.ts`）：把扫描命中转成可执行检查；含管道/重定向/`&&`/命令替换的命令行**拒绝解析**并标 `unverifiable`。
- **默认不执行回答里的命令**：`executeAnswerCommands: false`，只验证程序是否存在。
- **`verify_claims` 新增四个检查类型**：`commandAvailability` / `packageVersion` / `versionClaim` / `symbolExists`。
- **全部核实通过就不说话**：只有出现 refuted / inconclusive / unverifiable 才注入。

### 变更

- `autoRecheck` → `autoVerify`；注入内容从「请你去核验」改为「这是实测证据 + 判定」。
- 提示词段重写：明确分层取证顺序，**禁止凭记忆写编号 / ID / 哈希 / URL / 路径 / API 名**，并明确禁止「再想想你确定吗」这种自纠错方式。
- 扫描器 `PATH_RE` 修复：字符类不排除 CJK 时，`E:\a\b.json。日志在` 会把整段中文吞进路径，导致真存在的路径被误判为不存在。

### 修复

- **版本断言假证伪**（最严重的一处）：`cordis 4.0.4` 只被 `VERSION_RE` 抓成 `4.0.4`，丢了包名，于是 `versionClaim` 退化成拿**本包自己的** `package.json` 比对，把真实存在的版本判成「已证伪」。现在：版本号断言连包名一起抓；定位不到包名时只问「本机有没有任何包是这个版本」，找不到就 `noEvidence`，**绝不反驳**。
- 包名提取：`PKG_NAME_RE` 要求小写开头，`TypeScript 5.9.3` 被截成垃圾名 `ypeScript`；`version` / `版本` 这类连接词曾被当成包名。现在锚定 + 大小写容忍 + 连接词黑名单。
- `symbolExists` 自指假阳性：把「测试文件里复述的断言本身」当成了证据。
- `symbolExists` 声明判定过松：行首的 `zzFn(` 是调用却被当成定义（用临时 fixture 复现）。现在成员签名必须有缩进。
- 扫描器 `PATH_RE` 吞中文：字符类不排除 CJK 时，`E:\a\b.json。日志在` 会把整段中文吞进路径，导致真存在的路径被误判为不存在。
- `normalizeAnswer` 把 `v1.2.3` 与 `1.2.3` 归一到同一票。
- 新增裸编号检测（`\d{3,}\.\d{3,}`）：`arXiv 2402.06380` 这类凭记忆写出的编号会被抓成版本类断言并标 `unverifiable`——我自己在这轮对话里就写错过两个编号。

### 测试

6 套：`scanner` / `verify` / `local` / `evidence` / `factored` / `loop` + `smoke`。新增覆盖：oracle 实测（typescript=5.9.3、2 个独立来源）、判定规则（来源数/冲突/弱证据中性）、断言翻译的安全约束、Tier C 投票与分裂、注入的是证据而非请求。

### 修复（v0.2.0 复核轮：逐项核对文档与代码时查出）

- **provider 名是猜的**：`factoredProvider` 默认曾写 `spawn-in-process`。查宿主源码后确认：`dsh-subagent-spawn-in-process` 用 `config.providerName` 注册，**默认值是 `spawn`**。已改默认值，并在源码注释里记下出处（该 provider 的子代理是 fresh child Agent、zero parent context，正是 Tier C 需要的无草稿上下文）。
- **semver 范围语义错误**：`^5` 曾被判为不满足 `5.9.3`，把满足的声明范围算成反驳，导致真断言降级成 `inconclusive`。现在自己实现 `rangeSatisfied`（`*` / `x` / 精确 / `^` / `~` / `>= > < <=` / `||`），无法判断的范围返回 `undefined` 走中性，绝不反驳。
- **`*` 被误归入「无法判断」**：自己实现的判定里 `*` 返回了 `undefined`。
- **比较目标缺位解析失败**：`>=4` 这类只写主版本的目标解析不出，返回 `undefined`。现在按 `4.0.0` 补位。
- **网络失败曾被算成反驳**：registry 请求失败 / 非 2xx 曾计入 contradicting，意味着**网络抖动就能造成假证伪**。现在标为中性弱证据。
- **文档过度声称**：曾写「联网不传输任何用户内容」。事实是 registry 查询的 URL 路径带上从回答抽出的**包名**。中英 README 与 manifest 的权限说明都已改成如实描述。
- `packageVersion` / `versionClaim` 的来源标签分隔符混用（`E:\x/package.json`）。
- `test/smoke.mjs` 残留旧字段 `autoRecheck`。

### 新增（核对用的工具）

- `scripts/audit.mjs`：把「文档里声称的」和「文件里实际有的」逐项对齐——JSON 合法性、版本一致性、`exports`/`files` 指向的文件是否存在、`cordis.patch.yml` 的键是否都在 `DoubtConfig` 里、`DEFAULT_CONFIG` 是否覆盖全部键、旧字段残留、README 引用的源文件是否存在、README 声称的测试套数是否属实、manifest 声明的工具名与 entry 是否存在。已挂进 `npm run verify`（11 项）。
- 联网 Tier B 实测：两个 registry（npmmirror + npmjs）同时可达时，`typescript 5.9.3` → 4 个来源一致 `confirmed`；`typescript 9.9.9` → 4 个来源反驳 `refuted`。

## 0.1.0

首次发布。

### 新增

- **`verify_claims` 工具**：模型提交一组可执行检查（`command` / `fileExists` / `fileMatch` / `httpStatus` / `expr` / `textEquals`），插件在本机真实执行并回填每条断言的实测输出与判定。命令走 argv 数组、不经过 shell。
- **自动复核循环**：每个 turn 结束后扫描这一轮的回答，若存在「可核验但没给证据」的断言（风险分达到阈值），自动追加一轮 followup，要求逐条取证并给出修正版结论。等价于用户手动连问「你确定吗」，但有轮数上限与免打扰条件。
- **风险扫描器**：9 个纯函数检测器（命令 / 路径 / 版本号 / API 符号 / 包名 / 具体数字 / 非 shell 代码块 / 绝对化措辞 / 改口认错），可逐个开关，同类命中默认最多计 3 条。
- **系统提示词段** `dsh-doubt:self-check`（order 3260）：要求先取证再断言，禁止用「一定 / 绝对 / 100%」掩盖没查过的结论。
- **配置校验**：自带 StandardSchemaV1 校验器，`dsh --dump-config-schema` 可读到；profile 里可用 `cordis.patch.yml` 覆盖。
- **测试**：`test/scanner.test.mjs`、`test/verify.test.mjs`、`test/loop.test.mjs`、`test/smoke.mjs` 四套，覆盖扫描判定、真实执行与超时、复核循环的轮数预算与免打扰、裸 cordis 加载。
