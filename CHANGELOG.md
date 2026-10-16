# 更新日志

## 0.4.0（独立验证驱动的运行期修复 + 溯源闸）

这一轮的每个结论都由**不继承作者推理**的独立验证者复核过：一个专门证伪，一个做变异测试  
（把每处修复逐个改回去，看测试是否真的会失败）。结果是 14 处里 11 处被测试保护、**3 处零覆盖**，  
另有一条 `expr` 的结论被**证伪**。以下按发现顺序记录。

### 新增

- **溯源闸**（`requireProvenance`，默认开）：本轮若 `write`/`edit` 写出了交付文档（`.md`/`.txt`，  
  排除 `logs/`、`tmp/` 等）且正文没有出处小节，则要求补一份逐步骤溯源表：每条要么**有出处**  
  （链接/文档标题/版本号）要么**无依据**，无依据的必须留在表里并显式标注。  
  设计依据：在一份真实 46k 字部署手册上，机械判定只覆盖 21 条断言（20 条判不了），  
  但同一个模型被问一句「所有流程是否都有据可依」后能自己产出 42 项溯源表——能力在、触发器不在。  
  噪音控制：**同一份文档只问一次**（Windows 下路径按大小写不敏感归一），独立预算、一次人工回合最多 4 次，  
  不受 `maxRounds` 影响。实测：126 轮文档密集会话 6 次（每份文档一次，不是每次写入一次）、11 轮编码会话 0 次、  
  手册在溯源附录存在前 1 次/存在后 0 次。
- `scripts/verify-independent.mjs`（`npm run verify:independent`）：只用**外部裁判**核验本仓库——  
  真实 `dsh` CLI、真实 `semver`、真实 `cordis`、本机会话日志、子进程、守卫单调性；缺解包宿主时如实 SKIP。  
  存在理由：测试和代码是一起写的，「测试通过」是弱证据。
- **项目图标**：`assets/icon.png`（512×512）、`assets/icon-256.png`、`assets/icon.ico`（16–256 多尺寸，  
  Windows 快捷方式用），由 `assets/make-icon.py`（Pillow，超采样抗锯齿）生成；README 中英双语顶部引用，
  `.gitattributes` 中 `*.png`/`*.ico` 已标记为二进制。
- `.gitignore` 忽略 `_diag/`：本机排查现场含会话记录、浏览器登录库备份与系统日志，属纯本地隐私材料，  
  绝不进版本库。

### 修复：运行期接口（前三项是插件此前根本没工作过的原因）

- **插件此前完全没挂载**：`cordis.patch.yml` 的行缺顶层 `insert:`，而宿主 `applyEntryPatches`  
  只在**已有**条目上按 id 覆盖、找不到就 warn+skip。实测：加 `insert:` 后 `dsh --profileX --dump-config`  
  从 2 字节（空）变成 461 字节并含 `- id: dsh-doubt`。
- **插件此前完全哑掉**：`ctx.inject(['tools'], () => ctx.tools)` 的闭包抓的是**外层** ctx，访问服务抛  
  `cannot get property "tools" without inject`，而该错误只进 stderr、UI 里看不到。改为使用注入回调传入的 ctx。
- **本机 oracle 一直在查 profile 目录**：`DEFAULT_CONFIG.workspace = process.cwd()` 在**插件加载时**求值，  
  而宿主进程的 cwd 是 `…\.dsh\profiles\desktop`，于是 `packageVersion typescript` 报「本机没有该包」。  
  改为读运行时的 `exec.agent.session.header.cwd`（宿主自己的工具同源：`dsh-tool-fs`、`dsh-tool-bash`  
  两处独立一致），事件扫描降为兜底；工具返回值新增 `workspace: {cwd, source}` 让结果**自证**走了哪条路。
- **工具输出被宿主整条拒绝**：给返回对象新增字段却没写进 `OUTPUT_SCHEMA`（`additionalProperties: false`）  
  → 每次调用都 `returned invalid output`。补上，并新增「用工具自己的 schema 校验它实际返回值」的契约测试。

### 修复：证伪通道

- **`expr` 曾经能打死/挂死宿主**（独立验证者证伪了上一版修法）：改为在**子进程**里求值，  
  且**判 thenable 与 JSON 序列化全部在 vm 内部**完成。vm 的 `timeout` 只约束 vm 内部，而上一版让宿主在  
  vm 返回之后去读 `value.then` / `JSON.stringify(value)` —— `({get then(){for(;;){}}})`、`({toJSON(){for(;;){}}})`  
  会把宿主挂死；表达式里**丢弃**的 rejection 仍按 Node 默认策略打死进程，且发生在返回 `ok:true` 之后。
- **自指证据**：`selfPackageRoot()` 比的是**路径**，而「已安装副本 `…\.dsh\plugins\dsh-doubt`」与  
  「仓库 `C:\work\dsh-doubt`」是同一个包的两个路径，前缀比较必然漏 → `symbolExists('normalizeConfig()', 'C:/work/dsh-doubt')`  
  引用插件自己的 `src/config.ts`。改为按 `package.json` 的 `name` 判定（任何副本、任何 junction 都覆盖）。
- **方法/函数调用不是程序**：`.ps1` 里的 `z.Dispose()`、`foo.Bar(x)` 曾被拆成 argv[0] 拿去 `which` → 假证伪。
- **另一台机器守卫**：上下文明确是目标服务器/远程主机的路径，不再交本机文件系统判定（只往沉默方向走）。
- `rangeSatisfied` 对预发布版本与 semver 不一致（21/48 格），且错的方向**偏宽松**（可能假证实）；  
  现在直接返回 `undefined`。
- `symbolExists` 的 `claim` 曾同时充当「断言描述」与「被搜符号」（活体上整句描述被当符号名搜），  
  新增独立 `signature` 字段。
- 测试临时文件原先硬编码 `C:\work\dsh-doubt\test\__tmp_*.txt` → 套件不可搬迁、并发会互相删文件  
  （独立验证者 4 进程 6/6 复现 `ENOENT … unlink`）；改为 `os.tmpdir()` + pid。

### 测试

- 补入：交付文档溯源闸（一次/新文档、不重复、有出处小节则不触发、非交付扩展名不触发、ping-pong 硬顶、  
  人工轮重置）、会话工作目录（**真实** `session.header.cwd` 形状 + 事件扫描兜底）、方法调用守卫、  
  另一台机器守卫、设备 CLI 守卫、自指证据、工具输出 schema 契约、`expr` 子进程隔离（含验证者用过的  
  全部恶意载荷，直接在测试进程内跑）。
- 变异测试判为零覆盖的 3 处（`REMOTE_DEVICE_TOOLS` / `mentionsOtherMachine` / `isShellSyntax`）  
  现已有**真的会失败**的测试；`mentionsOtherMachine` 原先那条测试还因为措辞不含存在性断言而在更早的闸  
  就被丢掉——测试绿得毫无意义，一并修正。

### 逐步骤溯源表

本节由**溯源闸**要求补齐（插件在活体上发现本文件是交付文档而正文没有出处标注后自动提出）。  
每一条按「有出处 / 无依据」两类标注；凡能机械核对的（符号、文件、版本号、宿主源码行）都在写入前实测过。

| #  | 条目                                                                          | 依据                        | 出处 / 核对方式                                                                                                                                                                                                                                                                      |
| -- | --------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1  | `cordis.patch.yml` 此前缺顶层 `insert:`，宿主只在**已有**条目上按 id 覆盖                     | 有出处                       | 宿主 `@deepseek-ai/dsh-app-boot` 的 `applyEntryPatches`；实测无 `insert:` 时 `dsh --profileX --dump-config` 退出码 0、stdout **2 字节**、stderr `dsh: [dsh-doubt] patch: entry "dsh-doubt" not found`；加 `insert:` 后 stdout **461 字节**并含 `- id: dsh-doubt`（`npm run verify:independent` 第 1 项） |
| 2  | `ctx.inject(['tools'], () => ctx.tools)` 抓的是外层 ctx，访问服务抛错                   | 有出处                       | `@deepseek-ai/cordis/src/reflect.ts:144` = `lib/index.js:676`：`cannot get property "${prop}" without inject`（两处均已实测命中）；`verify:independent` 第 3 项在真实 cordis 上实测 `tools=[verify_claims]`                                                                                        |
| 3  | 本机 oracle 曾查 profile 目录：`DEFAULT_CONFIG.workspace = process.cwd()` 在插件加载时求值 | 有出处                       | 源码 `src/config.ts`；运行时权威来源实测两处独立一致：`dsh-tool-fs/lib/index.js:173` = `function sessionCwd(exec) {`（返回 `exec.agent?.session.header.cwd`）、`dsh-tool-bash/lib/index.js:294` = `const headerCwd = exec.agent?.session.header.cwd;`                                                  |
| 4  | `verify_claims` 的返回字段必须逐个写进 `OUTPUT_SCHEMA`                                 | 有出处                       | `src/tool.ts` 中 `additionalProperties: false`（实测存在）；宿主活体错误原文 `tool "verify_claims" returned invalid output: "value.workspace" is not a declared property`；契约测试在 `test/local.test.mjs`                                                                                          |
| 5  | `expr` 曾能打死/挂死宿主；现改为子进程求值且取值全在 vm 内                                         | 有出处                       | 恶意载荷由**独立验证者**给出并复现：`({get then(){for(;;){}}})` 与 `({toJSON(){for(;;){}}})` 挂死宿主、表达式内**丢弃**的 rejection 在返回 `ok:true` 之后打死进程。修复后同一批载荷写进 `test/verify.test.mjs` 并在测试进程内跑通；活体上 `({get then(){for(;;){}}})` 已改为如实报 `Script execution timed out`                                    |
| 6  | `selfPackageRoot()` 曾按**路径**比较 → 自指证据                                       | 有出处                       | 源码 `src/local.ts:13`（实测存在）；活体复现：修复前 `symbolExists('normalizeConfig()', 'C:/work/dsh-doubt')` 引用插件自己的 `src/config.ts`，修复后返回「找不到」（活体实测）                                                                                                                                               |
| 7  | 测试临时文件原先硬编码在 `test/` 下，并发会互删；改用 `os.tmpdir()` + pid                         | 有出处                       | 独立验证者以 4 个并发进程 6/6 复现 `ENOENT … unlink`；改用 `os.tmpdir()` 后我实测 4 并发 **4/4 exit 0、无 ENOENT**                                                                                                                                                                                     |
| 8  | `rangeSatisfied` 对预发布版本与 node-semver 不一致                                    | 有出处（**引用验证者数字，未自行复现该数字**） | 独立验证者报告 21/48 布尔格不一致、方向偏宽松。我自行复现的是**发布版本**矩阵：**493 组 0 不一致**（`verify:independent` 第 2 项）                                                                                                                                                                                       |
| 9  | 溯源闸「每份文档只问一次」                                                               | 有出处                       | 回放本机真实会话 `verify:independent` 第 4 项（documents=3 asks=1）；本节本身就是活体触发的结果                                                                                                                                                                                                          |
| 10 | 「126 轮文档密集会话 6 次、11 轮编码会话 0 次」                                              | **无依据（本人实测，未经独立复核）**      | 我自己驱动的会话回放，脚本已删除、不可重跑。独立验证者只复核了「同一路径连写 3 次只问 1 次」，**没有**复核这两个总数                                                                                                                                                                                                                |
| 11 | 「手册在溯源附录存在前 1 次 / 存在后 0 次」                                                  | **无依据（构造样本）**             | 「存在前」那一版是我从现行手册里**删掉**附录 A/B/E 与来源说明后**构造**的（46436 → 39722 字符），**不是真实历史文件**。真实那份手册只验了「存在后 0 次」                                                                                                                                                                                 |
| 12 | 扫描器报的 `(version) for 0.3.0` / `whether 0.3.0` / `The 0.3.0`                 | **无依据（不是断言）**             | 这三条是从英文行文里截出的版本号片段，原文只是描述版本从 0.3.0 升到 0.4.0，并非断言某软件的版本。标为「无依据」是因为它们在本表里对应不到任何外部出处；按溯源闸要求**保留、不删**                                                                                                                                                                              |
| 13 | 扫描器报的 `(package) manifest`                                                  | **无依据（不是断言）**             | 扫描器把 `manifest` 当成了 npm 包名；它在此文中的实际所指是 `dsh-plugin.json`（实测存在，version `0.4.0` 与 `package.json` 一致）。同样**保留、不删**                                                                                                                                                                 |
| 14 | 版本 0.3.0 → 0.4.0，`package.json` 与 `dsh-plugin.json` 同步                      | 有出处                       | 实测两处均为 `0.4.0`；`npm run audit` 输出 `OK 版本一致：0.4.0`                                                                                                                                                                                                                              |

**未能核对的**：第 10、11 条依赖的原始回放脚本已删除，无法重跑；第 12、13 条属于扫描器的抽取噪声，不是可核验的技术断言。以上均按溯源闸要求显式标注、保留原样。

## 0.3.0（评测驱动的重写）

### 新增：真实语料评测

- `eval/corpus.mjs`：从宿主会话存储（`~/.dsh/sessions/**/*.jsonl.zstd`，多帧 zstd）解出 **152 条真实真人轮回答**（19852 事件、185 轮）作为评测输入。不编题目、不自答。
- `eval/extract.mjs`：对每条回答跑插件管线，离线/联网各一遍，产出 1345 条断言及其证据链。
- `eval/sample.mjs`：按 类型×判定 分层抽样并带原文上下文，供人工定真值。
- `eval/score.mjs` + `eval/out/labels.json`：44 条断言的**独立真值**（用 `Test-Path`、跨仓库 grep、npm registry、宿主 d.ts 核实，不用插件自己的 oracle）。
- `eval/delta.mjs`：修复前后按 `session#turn#kind#snippet` 对齐对照。

### 评测测出的问题（修复前）

| 指标           | 修复前                | 修复后                               |
| ------------ | ------------------ | --------------------------------- |
| 抽取忠实度        | 24/44 = **54.5%**  | —                                 |
| 证伪条数（全量语料）   | 645 / 1345         | **8 / 1162**                      |
| 证伪精度（逐条独立核实） | **0/13 = 0%**      | **5/8 = 62.5%**（剔除我自己消息里的示例后 5/5） |
| 假证实          | 0/12               | 0                                 |
| 会插话的回答       | **152/152 = 100%** | **7/152 = 4.6%**                  |
| 可机械核验的断言     | —                  | 86/1162 = **7.4%**                |

结论：**修复前净负收益**——每轮都插话，而证伪通道实测精度为 0。修复后是一张窄网：真实回答里只有约 7% 的断言是这台机器能机械判定的。

### 修复（按失效类型逐条对应）

- **命令抽取**：空 lang 与 `text` 围栏不再当 shell；日志/表格/散文行（CJK、`=>`、时间戳、`PID`、`MiB`…）拒绝；未加引号且含空格的可执行路径不猜 argv。→ 命令断言 176 → 18。
- **路径抽取**：盘符前加词边界，`https://…` 不再截出 `s://…` 去文件系统找；Windows 上的 POSIX 风格路径（多为 API 端点）标无法核验，不反驳。
- **包名抽取**：拒绝域名、文件名后缀、大写、数字开头。→ 包断言 286 → 220。
- **「本机没有」不再等于「回答错了」**：`packageVersion` 的本机缺失改为中性弱证据，无正面来源时 `noEvidence`。这是最大的一类假证伪来源。
- **符号存在性**：找不到标识符 → `noEvidence`（回答可能在讲别的仓库/语言），不再反驳；扫描**排除插件自己的包**（评测抓到 `agent.followup()` 被插件自己生成的 `lib/loop.d.ts` 证实——自指背书）。
- **单一闸门**：`evidence.ts` 的 `localOracle` 曾内联一套自己的 `existsSync` 判定，绕过 `claims.ts` 的守卫。现在 `checks` 为空必须照实返回无法核验。
- **插话闸门**：从「非 confirmed 就说话」改成「**只有正面反驳（refuted / 有反驳的 inconclusive）或独立重推导投票分裂才说话**」。单纯核验不了 → 沉默。
- **第二轮抽样（修复后 25 条证伪，精度 32%）暴露的残留问题**，逐条修：
  - 带空格/中文的路径被在空格或 CJK 处截断（`F:\Call to Arms …`、`C:\Program`）→ 反引号与尖括号**整段优先**。
  - PowerShell cmdlet / 别名（`Copy-Item`、`irm`）不在 PATH 就被判「命令不存在」→ 归类为不适用，不反驳。
  - POSIX 专用工具（`df`、`free`、`lscpu`、`vllm`）在 Windows 上判不存在 → 归类为「大概在讲另一台机器」，不反驳。
  - 通配符路径（`result-*.json`）不是字面路径 → 不判。
  - 回答说的是「已删除／已不存在」时，不存在恰恰是对的 → 删除语境闸。
  - URL、参数续行（`--flag …`）、变量赋值行被当命令 → 拒绝。
  - LaTeX（`\boxed{}`）、占位符（`C:\Users\…`）、向上相对探测路径（`..\..\Windows`）不再当路径。
  - `existsSync` 把「没权限 stat」当不存在：`C:\pagefile.sys` 实测 `Test-Path` 为真而 Node 为假 → 只有 `ENOENT`/`ENOTDIR` 才算不存在，其余 `unverifiable`。
  - **存在性语境闸**：上下文没把它当存在性断言（例如我自己讲 bug 时写的示例路径）→ 不判。
- `evidence.ts` 的 `localOracle` 与 `onlineSources` 都改为**先过 `claims.ts` 的闸门**：`checks` 为空时本机与联网都不许自行开判（此前联网侧会绕过）。
- `eval/score.mjs` 曾去新版 `claims.json` 里找旧版 id（标注属于抽样那一版）→ 加 `--claims`，默认指向 `claims-v1.json`。

### 新增脚本

`eval:corpus` / `eval:extract` / `eval:sample` / `eval:score` / `eval:delta`。

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
