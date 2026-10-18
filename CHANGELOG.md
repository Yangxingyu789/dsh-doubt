# 更新日志

## 0.6.2（修「补查预算用尽」横幅：长回答的审核范围与回执预算）

- **现象**：0.6.1 装上后，长回答不再出现 `max-tokens`，但改为出现「以上草稿**未经完整审核**（自动补查预算已用尽）」横幅（用户 2026-10-18 12:04 截图反馈）。
- **取证（读本机落盘 session，不是推断）**：解压 `~/.dsh/sessions/.../session.v4.jsonl.zstd` 取 turn 9 事实：草稿 **5,051 字符**；审核包 **79,671 字符**（上限 80,000）、evidence=41 条；`evidenceContext = {currentCalls:38, historicalCalls:263, omittedCalls:260, truncatedCalls:10, complete:false}`；该轮依次收到 **2 次 `verify` 回执**（6 条 + 4 条意见），`operationMaxRounds=2` 用尽后按设计放行并附横幅。第三次修订稿已经补上被要的证据，但预算已尽、**没有被审核**。
- **修复**：
  - ① `operationMaxRounds` 默认与自带 patch 由 **2 → 3**：多断言长回答至少留一轮修复空间（profile 覆盖里也需同步，安装时一并改）。
  - ② `REVIEW_INSTRUCTION` 新增 **review-scope 契约**：`complete=false/omittedCalls>0/truncatedCalls>0` 表示这些记录**没有进入审核包**，属于本次审核的限制、不是作者的缺口，不得据此返回 `verify`（按契约应返回 `unavailable`）；不得要求作者重跑历史命令；草稿已明确标注「未验证」的点按 `unverified` 通过；解释性/背景文字不需要逐句引文；意见最多 3 条且必须能用包内记录修复。
  - ③ 历史记录选择改为 **relevance-aware**：按草稿里出现的路径 / 提交 id / 哈希 / 数字等标识给历史记录打分，优先纳入被引用记录，再按新到旧填满预算——避免「草稿引用了某条工具记录，但审核包只装了最新的几条历史」。
- **测试**：`test/operations.test.mjs` 新增 3 组断言：review-scope 文案存在；relevance 选择让被引用的历史记录进入审核包（12 条更新的噪声记录竞争预算）；`operationMaxRounds` 默认 3。
- **实测**：把 turn 9 的 5,051 字符草稿在新逻辑下重算审核包，草稿引用的标识 `712408f` / `55ac312` / `612be03` / `install-backup-20261018-014908` / `guardPromptInjected` / `1F023565` / `answersWithReviewBanner` **全部出现在包内**；`npm test` / `smoke` / `audit` / `host.test` 全绿（0.6.2）。
- **诚实边界**：这是针对「回执预算用尽」路径的修复；**尚未在真实长回答上重新观察**（需要安装 0.6.2 + 重启后再写一条长回答）。若装后仍出现横幅，下一步是把 `reviewMaxChars` 提到 120k 或把 `reviewReasoningEffort` 设为 `low`。

## 0.6.1（修「未经完整审核（max-tokens）」：审核器思考预算）

- **现象**：最终回答反复带「以上草稿**未经完整审核**：审核服务未完成（max-tokens）」横幅。0.6.0 装到 live profile 后重启的首个长回答实测复现。
- **根因（已用真实宿主重放确认，不是推断）**：审核请求原本只传 `provider/model/messages/tools/maxTokens`，没有 reasoning 控制；宿主 `@deepseek-ai/dsh-llm-deepseek` 在未指定时按 `options.reasoningEffort ?? connection.defaults.reasoningEffort ?? "high"` 落成 **effort=high + thinking enabled**（`dsh-llm-deepseek/lib/index.js:1707,1719-1720`），而 thinking token 与 `max_tokens` 共用预算。把本机落盘的 turn 4 审核包（`buildReviewPacket` 复算：52,672 字符 / 7 个 draftParts / 22 条证据）经**真实安装版宿主 `LlmRuntime` + DeepSeekAdapter** 重放：第 1 次尝试（maxTokens=12000）返回 `outputTokens=12000`、**可见正文 `rawChars=0`**、finish=`max-tokens`；重试（24000）在多次运行中有时成功、有时同样被 thinking 吃满，于是回答只能带横幅放行。同一包 `reasoningEffort="off"` → 2.9s、325 output tokens 返回有效判定。
- **修复**：审核请求显式发送 `reasoningEffort`，新增配置 `reviewReasoningEffort`（默认 `off`；可选 `low`/`high`/`max`/`default`，`default` 表示不传字段、回退宿主默认）；provider/模型不支持 reasoning 控制时自动去掉该字段重试一次（避免因 `UNSUPPORTED_REASONING_EFFORT` 变成漏审）；12000→24000 的 max-tokens 重试同样保持该设置。
- **测试**：新增 `test/review-effort.test.mjs`（默认 off / 可配置 / 不支持时回退 / max-tokens 重试仍 off / 默认值），`npm test` 现为 11 个测试文件。
- **附带修复（同一提交系列）**：闸门的「用户确认点」原先要求最后一条真人请求**同句**同时含确认词与动作词，导致用户对安装询问只回复「确认」时被误判为缺失。现在单独一句 `确认 / 批准 / 同意 / 允许 / 授权 / OK / yes` 也算明确授权（`src/guard.ts` 的 `confirmationSeen`，`test/guard.test.mjs` 已加断言）；草稿里自称「已确认」仍然不算。
- **新增 `npm run doctor`**（`scripts/doctor.mjs`）：一条命令核验「装上了没有、是不是真的在跑」。静态项：仓库/安装目录/profile 链接的版本与 `lib/` 逐字节一致、profile 依赖与 bundle、安装版 patch 为顶层 `- insert:` 且声明 `guardLiveMutation`/`reviewReasoningEffort`/`segmentedReview`、组合 `cordis.yml` 含 `- id: dsh-doubt`、Node engine；运行证据（只报告）：落盘 `system/message` 是否含 0.6.x 闸门提示词段、落盘回答的审核横幅统计（最近六条 `banner,…,clean`）、会话里 `verify_claims`/`doubt_review` 的实际调用次数。设计参考生态中 `dsh-verdict` 的 `verdict doctor`（静态可判定的事实 + 装载交给真实运行）。
- **诚实边界**：本次修复在**仓库构建产物 + 真实宿主 LlmRuntime 重放 + 安装后会话行为**上验证（安装 0.6.1 并重启后，落盘回答的横幅序列从连续 `banner` 变为 `clean`；`npm run doctor` 实测 12 项静态检查全 PASS、`guardPromptInjected=true`）。重放中 `off` 模式有一次出现审核 JSON 两次不被接受、走了旧的 compact 兜底（裸 approve）——说明关闭 thinking 后**格式稳定性可能下降**；需要更强审核质量时可把 `reviewReasoningEffort` 设为 `low`（实测同一包 99s、能给出有效 verify，但慢且消耗更多）。该权衡尚未在真实会话中长跑验证；真实长任务下分段审核与闸门真实拦停效果仍未验证。

## 0.6.0（危险变更闸门）

- 新增危险变更闸门 `guardLiveMutation`（默认 `true`）与受保护路径列表 `liveMutationPaths`（默认 `.dsh/profiles`、`.dsh/plugins`、`program files`、`programdata`、`c:/windows`；大小写与斜杠不敏感）。闸门在最终审核前用纯函数扫描本轮工具轨迹，识别：写 live profile / plugins；在 live 路径执行 `pnpm`/`npm`/`yarn`/`corepack` 的 `install`/`add`/`ci`/`rebuild`；执行仓库安装脚本 `node scripts/install-local.mjs`（它会写 `.dsh/plugins`）；杀进程 / 停服务 / 关机 / 重启；注册表 / 服务 / 自启动修改；递归删除；写系统目录（`Program Files`、`ProgramData`、`C:/Windows` 等）。
- 命中后**确定性打回**（`verify`，不是审核服务故障，也不触发「未经审核」横幅）：草稿不得作为完成结果放行，必须补齐三件产物，缺一不放行，`doubt_review` 回执逐条点名缺什么——①回滚路径（备份位置 + 可直接执行的回滚命令）；②用户确认点（批准事件或用户明确授权；草稿里自称「已确认」不算）；③动作后独立健康检查（变更后另起一次工具调用并真实完成；安装回执不算）。健康检查失败时必须停止后续任务并直接给回滚步骤。三件齐全才继续走正常审核；`guardLiveMutation: false` 完全回退旧行为。
- 审核指令（`REVIEW_INSTRUCTION`）与系统提示词段同步加硬规则：危险变更必须披露回滚路径、用户确认与动作后独立健康检查，识别到 live 环境变更而草稿缺证据时返回 `verify` 并点名缺项；提示词段在动作前就要求说明影响面、取得确认、给出回滚路径，动作后另起调用做健康检查，不许用「已完成」措辞掩盖。
- **事故背景（本次闸门的动机）**：2026-10-17 23:46 在 DSH 宿主运行中把改过的插件装进 live profile（`node scripts/install-local.mjs` → profile 内 `pnpm install --offline`），随后宿主所有工具报 `cannot get required service "sessionProjections" in inactive context`，工具全部不可用；用户重启 DSH 后于 00:07 恢复探测。同一份代码在新进程加载正常且测试全过。热重载导致服务上下文失效是**推断，无宿主日志可证实**。该事故时间线已固化为 `test/guard.test.mjs` 的回归用例（受控 reviewer 直接调 `reviewDraft`）；这只是受控测试，不是真实会话中的生效记录。
- 新增 `test/guard.test.mjs` 并纳入 `npm test`（共 10 个测试文件）：危险动作识别（安装脚本 / live profile 安装 / live 路径写入 / 递归删除 / 杀进程 / 注册表，以及 `read`、`node --version`、仓库 `edit`、`ops_replace` dryRun 等反例）、事故回归、三件产物齐全放行、缺回滚/确认/健康检查分别打回、关闭开关回退、普通轨迹不误伤。
- 一并纳入 0.5.1 之后完成但未单独发版的分段审核（`segmentedReview`，默认 `true`）：整包超出 `reviewMaxChars` 时按段审核，任一段 `verify` 立即返回，服务故障只披露未审完的段，`false` 回退单包路径。
- **诚实边界**：以上覆盖来自单元测试与受控 reviewer 测试；真实长任务端到端、真实宿主会话中闸门是否按预期触发与拦停**尚未验证**，没有「已在真实会话生效」的实测记录。版本号统一为 0.6.0（`package.json`、`dsh-plugin.json`、`src/index.ts`），`test/host.test.mjs` 的版本断言同步更新。

## 0.5.1（审核故障与任务缺证分开处理）

- 修复审核器错误被当作证据缺口、耗尽主模型补查次数的缺陷。保留安全的接口错误码；审核故障不发补查回执，也不启动旧版回合后检查。
- 带工具调用的流保留工具和思考协议，移除尚未审核的可见正文；覆盖此前“工具继续执行时先显示确定结论”的漏洞。重新排列 DeepSeek 回放元数据。
- 审核器用段落编号覆盖全文，不再要求复写长回答；只有审核输出达到 token 上限时，内部增加输出预算重试一次，不重新执行用户操作。
- 区分当前问题和历史请求，避免把全部历史要求强加给一次追问。
- 添加接口错误、长回答、截断、工具阶段显示及真实宿主 UI 流回归；模型评测改用实际 LlmRuntime 调用链。
- 0.5.0 的现场记录只保留笼统错误，无法追溯当时接口故障的具体原因；本次没有把推测的超时或截断当成已确认根因。
- 校验链补漏：`npm run verify` 此前**不包含** `verify:host`、`verify:host-loop`、`verify:independent`，所以这三项都红时 `verify` 仍然全绿。现在 `verify` 串上这三项；宿主测试自动定位已安装应用（`--app` / `DSH_APP_DIR` / 运行中进程 / 常见安装位置），找不到时打印 `SKIP` 并以 0 退出。
- 新增 `npm run host:unpack`（`scripts/unpack-host.mjs`）：按 asar 头解析并解包 `resources/app.asar`，写入 `.unpacked.json` 标记（源 asar 大小/修改时间）。`verify:independent` 据此把**陈旧或不完整**的解包报成 `SKIP`（附修复命令）而不是 `FAIL`——此前的解包取自旧版本、且丢了 87 个包的 `package.json`，导致 `ERR_MODULE_NOT_FOUND` 被误当成插件缺陷。
- 修复审核输入预算：`buildReviewPacket` 此前只对**历史**记录做字符预算，当前轮记录全量塞入，于是工具输出多的一轮必然超过 `reviewMaxChars` → `INPUT_LIMIT` → 整段最终回答被扣留。实测本机第 6 轮（77 次工具调用，当前轮证据 209,267 字符）的 payload 是 **216,921** 字符（上限 120,000）；修复后同一轮为 **119,735** 字符，77 条记录全部保留。超长结果按份额截短并写入显式截断标记与 `truncated`/`truncatedCalls`，不是静默丢弃；草稿本身超限时仍按原设计失败关闭。
- 补测：`verify:host-loop` 以前只跑默认场景，`--exhausted` / `--reviewer-error` / `--history` 从未进入校验链，其中 `--exhausted` 因提示文案不一致（期望「自动取证轮数已用尽」，实际「已停止自动补查」）长期是红的。现在四个场景都进 `npm run verify`，文案统一为两者都包含的措辞。
- 修复审核超时：`buildReviewPacket` 会把**历史**记录一路填到预算上限，实测 7 轮里有 6 轮的 payload 落在 **119.5k–119.7k** 字符（上限 120,000），而审核输入基本是中文（字符量级≈token 量级），于是单次审核超过 60s → `REVIEW_TIMEOUT` → 回答被扣留。现在 `reviewMaxChars` 默认 **48000**、`reviewTimeoutMs` 默认 **120000**，历史记录最多只占预算的 1/4；审核超时后还会**去掉历史重试一次**，不再直接吞掉答案。
- 修复审核输出超限（`max-tokens`）：`draftParts` 此前**一行一段**，长回答会拆出上百段，审核器为覆盖全文要输出大量 JSON，6000/12000 的预算两次都撑爆 → 回答被扣留。现在段落按 ~400 字符分组，首轮 `maxTokens` 12000、重试 24000，且重试会去掉可选历史；审核指令里也明确要求输出尽量少的段、不复述正文、不叙述分析过程。
- 修复 `INVALID_REVIEW`：它全部来自 `validateReview` 的 `fail()`（分段为空/编号不连续/正文覆盖不一致/引文不在原文里等），而 `reviewPacket` **只在 `max-tokens` 时重试**，于是一次格式错误就把整段回答扣留。现在：①非法 JSON 与契约不满足都会**带着校验器原话重试一次**；②`partIds` 与 `text` 混用但拼接后仍覆盖草稿时予以接受；③错误提示带上具体原因（例如「收到 2 个 partId，应为 0..0」），不再只有一个笼统错误码。实测证据：会话日志 17:09:34 记录 turn 12 = `INVALID_REVIEW`。
- **改变终局策略（按用户决定）：审核永不吞掉回答。** 补查预算用尽、审核服务故障、回放协议不支持时，不再扣留草稿，而是**照常放行并在末尾附一条「以上草稿未经完整审核」横幅**（列出未核实意见或故障码/原因）；预算内的驳回仍走 `doubt_review` 回执继续取证。动机：本会话先后出现 `INPUT_LIMIT`(15:53)、`REVIEW_TIMEOUT`(16:09)、`max-tokens`(16:31)、`INVALID_REVIEW`(17:09) 四次终局扣留，把正常回答整段吞掉。实现：`src/completion.ts` 的 `releasedDraft()`；`test/operations.test.mjs` 与 `test/host-loop.test.mjs` 的对应用例已改为断言「草稿必须出现且带横幅」。

## 0.5.0（最终正文显示前审核）

- 取消“调用过 bash/read 等工具就豁免整轮”的规则。
- 新增 llm/stream 暂存、独立模型证据审核、全文覆盖/原文引用/操作后时序契约；无需用户正文插入工具 ID。
- 不通过时使用 doubt_review 回执继续当前宿主 turn；审核失败和预算耗尽明确报告未完成。
- 保留 DeepSeek 思考回放所需内容/签名；未知回放协议和未暴露回执的 PTC-only 模式报告能力不足。
- 修正诚实的未完成说明被误拦、验收 actionIds 与 check 混淆、失败输出不能用于如实报错，以及同步异常/超时处理。
- 防止旧 idle 循环并发、取消轮追问与异步结果污染新轮。
- 新增离线审核契约、真实宿主运行时/AgentLoop 集成测试、18 项真实模型合成证据评测。18 项在修正后一次运行符合预期；不代表生产错误率。
- 真实模型继续执行测试发现并修复了思考回放丢失、流式协议开销误计为正文长度两个问题；故障注入后已实测自动回读临时配置并收尾，无需人工追问。
- 每次最终回答新增一次模型调用/延迟；审核用量尚未并入原回答统计。中间文字、磁盘文档、图像验收和完整历史任务状态不在此显示闸的保证范围内。

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
| 15 | 项目图标三件套：`icon.png` 512×512、`icon-256.png` 256×256、`icon.ico` 七种尺寸                    | 有出处                       | Pillow 12.3.0 实测读回 `(512, 512)`、`(256, 256)`，`ico.sizes()` = 16/24/32/48/64/128/256                                                                                                                                                                                          |
| 16 | 图标由 `assets/make-icon.py`（Pillow，`SS = 4` 超采样 + LANCZOS 下采样）生成                    | 有出处                       | 已提交的脚本实测三处命中：`from PIL import Image, ImageDraw`、`SS = 4`、`LANCZOS`                                                                                                                                                                                                            |
| 17 | `.gitattributes` 已把 `*.png` / `*.ico` 标记为二进制                                    | 有出处                       | 该文件第 2、3 行实测为 `*.png binary` / `*.ico binary`（本轮未改动此文件，属既有约定）                                                                                                                                                                                                         |
| 18 | 占位符 `<你的GitHub账号>` → `Yangxingyu789`，共 5 处                                     | 有出处                       | 三份文件中 `Yangxingyu789` 计数 = 1 / 1 / 3；`<你的GitHub账号>` 残留 0 处                                                                                                                                                                                                             |
| 19 | `.gitignore` 忽略 `_diag/`，本次提交不含该目录                                            | 有出处                       | `git check-ignore -v _diag` → `.gitignore:15:_diag/`；`git show --name-only 7e3d42b` 的 9 个文件里无 `_diag/`                                                                                                                                                                 |
| 20 | 提交 `7e3d42b` 作者为 `Yangxingyu789 <128827493+Yangxingyu789@users.noreply.github.com>` | 有出处                       | `git log -1 --format` 实测；邮箱格式依据 GitHub 官方文档《Email addresses reference》「Your noreply email address」：2017-07-18 **之后**创建的账号为 `ID+USERNAME@users.noreply.github.com`（该页实测 HTTP 200）；ID `128827493` 取自 `https://api.github.com/users/Yangxingyu789` 实测响应（HTTP 200，其 `created_at` 为 2023-03-24，晚于该分界日） |
| 21 | 私有仓库 `github.com/Yangxingyu789/dsh-doubt` 已创建，且当时为空仓库                          | 有出处                       | 用已登录会话实测：HTTP 200、标题 `Yangxingyu789/dsh-doubt: …`、含 `svg.octicon-lock` 与 `Private`、无 `Public`、命中空仓库引导文案；独立来源：匿名 `GET api.github.com/repos/Yangxingyu789/dsh-doubt` → **404**                                                                                                |
| 22 | 自动建仓脚本的选择器：`#repository-name-input` 有效；第一版猜的三个选择器**全部落空**                     | 有出处（实测纠正）                 | 第一版实测 `FORM name=null`（`#repository_name`、`input[name="repository[name]"]`、`input[aria-label="Repository name"]` 均未命中）；真实 DOM 转储给出 `#repository-name-input`（值 `dsh-doubt`），改用后 `AFTER_CREATE url=https://github.com/Yangxingyu789/dsh-doubt`；`getByRole('button', { name: 'Create repository' })` 实测命中 |
| 23 | 工作区新出现的 `yarn.lock`（2026-10-16 22:16:18 创建、1925 字节、yarn v1 格式，内容为本项目那几个依赖）    | **无依据（来源未核实）**             | 本仓库用 pnpm（`pnpm-lock.yaml` 在版本库内）；它不是本轮任何命令的产物（本轮只跑了 `npm run check/build/test/smoke/audit`、`git`、Playwright 与 Pillow）。我没有删除、也没有提交它，来源需仓库所有者确认                                                                                                                     |
| 24 | 扫描器报的 `(version) v24.21.0` / `Version 0.15`                                 | **无依据（不是本轮文档里的断言）**        | 在这三份文档里搜不到这两个串。`v24.21.0` 是本会话 `node -v` 的实测输出，只出现在对话里；`Version 0.15` 来自 `dsh-plugin.json` 的 `manifestVersion`（实测存在，本轮未改）。按溯源闸要求**保留、不删**                                                                                                                          |
| 25 | 扫描器报的 `(version) 5.9.3`                                                      | 有出处                       | 文档里的 `5.9.3` 是本轮之前就有的内容，指本机 `node_modules/typescript` 版本；`npm run verify` 实测输出「typescript=5.9.3，2 个独立来源」                                                                                                                                                            |
| 26 | `npm run verify` 此前不含 `verify:host` / `verify:host-loop` / `verify:independent` | 有出处 | 改前后各看一次 `package.json`：`git show HEAD:package.json` 的 `verify` 止于 `npm run audit`；改后串上三项。这解释了「三项全红而 `verify` 全绿」 |
| 27 | 宿主测试能自动定位桌面应用，缺应用时 SKIP 且退出码 0 | 有出处 | `scripts/host-app.mjs`（探测顺序：`--app` → `DSH_APP_DIR` → 运行中进程 → 常见安装位置）；本机实测 `npm run verify:host`、`verify:host-loop` 不带参数均 PASS |
| 28 | `npm run host:unpack` 解包 `resources/app.asar` 并写 `.unpacked.json` 标记 | 有出处 | `scripts/unpack-host.mjs`；本机实测输出 `16711 packed + 1583 unpacked`，合计 18294，与 asar 头自报的文件数一致 |
| 29 | 改动前的解包陈旧且不完整（87/287 个包缺 `package.json`），使 `verify:independent` 第 1 项以 `ERR_MODULE_NOT_FOUND` FAIL | 有出处（重新解包前实测；该状态已不存在） | 实测 `dsh-asar` 2026-10-16 21:01 vs `app.asar` 2026-10-17 12:49；87/287 缺 `package.json`；重新解包后该轮检查为 **6 PASS / 0 FAIL / 0 SKIP**，第 1 项输出 `- id: dsh-doubt` |
| 30 | 工具输出多的一轮曾超过 `reviewMaxChars`，导致整段最终回答被 `INPUT_LIMIT` 扣留 | 有出处（本机会话实测） | 用插件自己的 `buildReviewPacket` 从本机会话事件复算：第 6 轮 77 次调用、当前轮证据 209,267 字符，payload = 216,921 字符（上限 120,000）；修复后同一轮 = 119,735 字符 |
| 31 | 超长结果改为按份额截短、带显式标记，当前轮记录全部保留 | 有出处 | `src/completion.ts` 的 `clipRecord()`；`test/operations.test.mjs` flood 回归（77×2,700 字符）断言 payload ≤ 上限、77 条全在、`truncatedCalls > 0`、保留前缀引文可通过 `validateReview` |
| 32 | `verify:host-loop` 现在跑四种场景；`--exhausted` 此前是红的 | 有出处 | `package.json` 脚本实测；修复前 `--exhausted` 报 `AssertionError: The input did not match /自动取证轮数已用尽/`（实际输出「已停止自动补查」），修复后四种场景退出码均为 0 |
| 33 | 审核 payload 会被历史记录填到接近上限（7 轮里 6 轮 ≈119.5k–119.7k 字符） | 有出处（本机会话实测） | 用插件自己的 `buildReviewPacket` 逐轮复算：turn 1/2/3/4/5/6/7 = 81,757 / 119,724 / 119,570 / 119,738 / 119,713 / 119,706 / 119,668 字符（当时上限 120,000） |
| 34 | 这使审核调用超时（`REVIEW_TIMEOUT`）并扣留回答；现改为 48000 字符上限 + 历史占 1/4 + 120s 超时 + 超时去历史重试 | 有出处（源码 + 测试） | `src/config.ts` 默认值与 `cordis.patch.yml`；`src/completion.ts` 的 `historyLeft` 上限与 `guardStream` 重试分支；`test/operations.test.mjs` 断言 payload < 48000×0.8、当前轮证据仍优先、超时后恰好重试一次并放行 |
| 35 | 文档里的审核条目与配置表已同步新默认值 | 有出处 | `README.md` / `README.zh-CN.md` 的配置表与「操作取证闸」第 6 条；`cordis.patch.yml` 中 `reviewTimeoutMs: 120000`、`reviewMaxChars: 48000` |
| 36 | 长回答时审核器输出预算两次耗尽（`max-tokens`）导致草稿被扣留 | 有出处（本机会话日志实测） | 本会话日志：turn 8 = `插件审核服务出错（max-tokens）`；同一份日志里 turn 6 = `INPUT_LIMIT`、turn 7 = `REVIEW_TIMEOUT` |
| 37 | 段落改为 ~400 字符分组，重试预算 12000→24000 并去掉历史 | 有出处（源码 + 测试） | `src/completion.ts` 的 `draftParts()` 与 `maxTokens: retry ? 24000 : 12000`、重试分支；`test/operations.test.mjs` 断言 200 行 → ≤30 段且拼回一致、重试时只剩当前轮记录 |
| 38 | `INVALID_REVIEW` 只出自 `validateReview` 的 `fail()`，本会话出现一次 | 有出处（源码 + 会话日志） | `src/completion.ts` 的 `fail()`；会话日志 turn 12 = `INVALID_REVIEW`，本地时间 17:09:34 |
| 39 | 契约/JSON 错误带原因重试一次、混用分段可接受、提示带具体原因 | 有出处（源码 + 测试） | `src/completion.ts` 的 `repair()` 与覆盖分支；`test/operations.test.mjs` 的四条新断言（重试带校验器原话、非法 JSON 重试、混用放行、编号错误报细节） |

**未能核对的**：第 10、11 条依赖的原始回放脚本已删除，无法重跑；第 12、13、24 条属于扫描器的抽取噪声，不是可核验的技术断言；第 23 条的 `yarn.lock` 来源未核实（未删、未提交）。以上均按溯源闸要求显式标注、保留原样。

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
