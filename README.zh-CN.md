# dsh-doubt

**把「你确定吗」变成 DSH 的自动动作。**

模型第一遍回答经常不严谨：命令没跑过、路径没确认、版本号是记忆的、API 签名是编的。
你只能反复追问「你确定吗」——它每次去查都能查出问题，于是一个可靠结论要问好几次。

`dsh-doubt` 把这一遍追问自动化：**回答里凡是能被外部证据核验、却没给证据的断言，插件自己发现、自己追加复核轮，并给它一个真实执行取证的工具。**

中文 | [English](README.md)

---

## 它做三件事

```
                    ┌──────────────────────────────────────────┐
   模型回答 ───────►│ 1. 风险扫描器（纯函数，9 个检测器）        │
                    │    命令 / 路径 / 版本 / API 符号 / 包名 /  │
                    │    数字 / 代码块 / 绝对化措辞 / 改口       │
                    └───────────────┬──────────────────────────┘
                                    │ 风险分 ≥ 阈值 且 本轮没调用过取证工具
                                    ▼
                    ┌──────────────────────────────────────────┐
                    │ 2. 自动追加一轮复核（agent.followup）      │
                    │    「这 6 条断言没有证据，逐条取证后      │
                    │      给修正版结论；错了就明说之前错了」    │
                    └───────────────┬──────────────────────────┘
                                    │ 模型需要真实证据
                                    ▼
                    ┌──────────────────────────────────────────┐
                    │ 3. verify_claims 工具：本机真跑            │
                    │    command / fileExists / fileMatch /     │
                    │    httpStatus / expr / textEquals         │
                    │    → 退出码、实测输出、判定理由            │
                    └──────────────────────────────────────────┘
```

第 3 件是核心：**不靠「让另一个模型怀疑它」，靠外部执行**。内省不可靠，跑一遍的结果可靠。

---

## 安装

### 方式一：插件市场

在 DSH 的插件管理里搜 `dsh-doubt`。

### 方式二：命令行

```bash
dsh plugin --profile desktop add dsh-doubt
```

### 方式三：离线目录安装（不联网）

```powershell
git clone https://github.com/YOUR_NAME/dsh-doubt.git
cd dsh-doubt
pnpm install --offline        # 或联网 pnpm install
node scripts/install-local.mjs --dry     # 先看会改什么
node scripts/install-local.mjs           # 写入 %DSH_HOME%\plugins + profile/package.json
cd $env:USERPROFILE\.dsh\profiles\desktop
pnpm install --offline
# 重启 DSH 宿主
```

卸载：删掉 `profiles/<profile>/package.json` 里新增的 `dependencies["dsh-doubt"]` 和 `bundles` 末尾的 `"dsh-doubt"`，再 `pnpm install --offline`，重启。

---

## 配置

在 `cordis.patch.yml`（profile 层，后加载优先）里覆盖：

```yaml
- id: dsh-doubt
  name: "dsh-doubt"
  config:
    enabled: true
    autoRecheck: true
    maxRounds: 2
    minScore: 6
    minAnswerChars: 240
    detectors:
      number: false      # 关掉「具体数字」检测
```

| 字段 | 默认 | 作用 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `verifyTool` | `true` | 注册 `verify_claims` |
| `promptSection` | `true` | 注入「先取证再断言」的提示词段 |
| `autoRecheck` | `true` | 自动复核循环 |
| `maxRounds` | `2` | 每个 session 自动复核轮数上限（人工发新消息即重置） |
| `minScore` | `6` | 触发复核的风险分阈值，调高 = 更少打扰 |
| `maxFindings` | `8` | 复核消息里最多列几条断言 |
| `minAnswerChars` | `240` | 短于这个长度的回答不触发 |
| `detectors` | `{}` | 单个检测器开关，`{"number": false}` 即关闭 |
| `verificationTools` | 见下 | 本轮出现过这些工具调用就算「已取证」 |
| `denyBinaries` | `rm/del/format/...` | `verify_claims` 拒绝执行的程序名 |
| `timeoutMs` | `15000` | 单条检查超时 |
| `language` | `auto` | 注入文本语言（`auto` 按回答文本判断；提示词段用 `zh`，除非设成 `en`） |

---

## 检测器

| kind | 权重 | 抓什么 | 要求它做什么 |
|---|---|---|---|
| `command` | 2 | shell 代码块里的命令行 | 真跑一遍，贴退出码与输出 |
| `path` | 1 | `E:\...` / `/a/b/c` 路径 | 确认存在，不存在就改 |
| `version` | 2 | `v1.2.3`、`版本 4.0`、`^4.0.4` | 用 `package.json` / `--version` 核对 |
| `symbol` | 2 | 反引号里的 `foo.bar()` 签名 | 读定义处或类型声明，别编 API |
| `package` | 2 | 反引号里的包名 | 查 registry / 本地 `node_modules` |
| `number` | 1 | `30 秒`、`12 MB`、`47%` | 给出测量方式，否则改成区间 |
| `code` | 2 | 非 shell 代码块 | 编译/运行一次，贴真实结果 |
| `absolute` | 2 | 「一定」「绝对」「100%」「guaranteed」 | 换成有出处的表述 |
| `reversal` | 3 | 「抱歉我之前说错了」 | 把被推翻的结论连正确版本一起重新核验 |

分数 = 各类命中权重之和，**每类默认最多计 3 条**——所以长回答不会必然触发，短促的「好的收到」也不会被打扰。

---

## `verify_claims` 长什么样

模型提交：

```json
{
  "checks": [
    { "kind": "command", "claim": "pnpm install --offline 能离线装依赖",
      "argv": ["pnpm", "install", "--offline"], "expectMatch": "downloaded 0" },
    { "kind": "fileExists", "claim": "patch 文件在 profile 根目录",
      "path": "C:\\Users\\me\\.dsh\\profiles\\desktop\\cordis.patch.yml" },
    { "kind": "expr", "source": "21 * 2", "expectMatch": "42" }
  ]
}
```

插件回填（实测，不是复述）：

```json
{
  "summary": "失败 0 条 / 通过 3 条。可以引用上面的实测输出作为证据。",
  "results": [
    { "ok": true, "kind": "command",
      "detail": "$ pnpm install --offline\n判定：输出包含 \"downloaded 0\"\n退出码 0\nstdout: Progress: resolved 6, reused 6, downloaded 0 …" }
  ]
}
```

---

## 免打扰设计

自动追加轮次很容易变成噪音，所以有四道闸：

1. **本轮已经取过证就不打扰**：出现过 `bash` / `pwsh` / `read` / `grep` / `web_search` / `verify_claims` 等调用即视为已核验。
2. **短回答不打扰**：`minAnswerChars` 以下直接跳过。
3. **轮数上限**：`maxRounds`（默认 2）。人工发一条新消息即重置预算。
4. **状态闸**：agent 处于 `running` 或 inbox 有积压时不注入，避免和用户的 submit 抢时序。

---

## 安全边界

`verify_claims` 会在本机执行命令，所以边界写死在代码里：

- **不经过 shell**：`argv` 数组直接 `spawn`，没有管道/重定向/`&&`，也就没有 shell 注入面。Windows 下遇到 `.cmd`/`.bat` 才用 `cmd.exe /d /s /c` 包装，参数逐个按 msvcrt 规则转义。
- **黑名单**：`rm` / `del` / `format` / `diskpart` / `dd` / `reg` / `schtasks` / `vssadmin` / `wevtutil` 等直接拒绝。
- **超时**：每条检查默认 15 秒，超时 `SIGKILL` 并如实报告。
- **输出上限**：4000 字符截断，不会把巨型输出灌进上下文。
- **`expr` 空沙箱**：`vm.runInNewContext` + 空 context，没有 `require` / `process` / `globalThis`。

它**不**走 DSH 的沙箱与审批链——这是插件层的已知限制。要更严就配 `denyBinaries`，或把 `verifyTool` 关掉只留自动复核。

---

## 开发

```bash
pnpm install            # 联网
pnpm install --offline  # 已有 pnpm store 时离线
npm run verify          # tsc 检查 + 构建 + 4 套测试
```

代码结构：

| 文件 | 职责 |
|---|---|
| [src/index.ts](src/index.ts) | 入口：注册工具、注入提示词段、装复核循环 |
| [src/scanner.ts](src/scanner.ts) | 风险扫描器（纯函数，无宿主依赖） |
| [src/verify.ts](src/verify.ts) | 断言执行器（命令 / 文件 / HTTP / 表达式 / 文本） |
| [src/loop.ts](src/loop.ts) | 自动复核循环（`agent/status` → `agent.followup`） |
| [src/tool.ts](src/tool.ts) | `verify_claims` 定义（裸 JSON Schema，不 import 宿主包） |
| [src/prompts.ts](src/prompts.ts) | 注入文本与提示词段（中英） |
| [src/config.ts](src/config.ts) | 配置类型 + StandardSchemaV1 校验 + 归一化 |

用到的宿主扩展点：`ctx.tools.register()`、`ctx.systemPrompt.section()`、`ctx.on('agent/status', …, {global:true})`、`agent.session.snapshotEvents()`、`agent.followup()`。

---

## 已知限制

- 扫描器是启发式：它判断「这条可核验」，不判断「这条对不对」。判定交给执行。
- 复核轮会多花一轮模型调用与 token。`minScore` 调高、`maxRounds` 调低可控制成本。
- 只扫最终回答文本，不扫工具结果里的内容。
- 提示词段固定用中文，除非 `language: en`。

---

## 许可

MIT
