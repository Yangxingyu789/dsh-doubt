/**
 * 风险扫描器：纯函数，不依赖宿主，可单测。
 *
 * 目标不是「判断对错」——那需要另一个模型，同样不可靠。
 * 目标是找出**可被外部证据核验、但回答里没有证据**的断言，
 * 把它们列出来交给模型（或用户）去取证。
 */

export interface Finding {
  /** 检测器名，可在 config.detectors 里单独关掉 */
  kind: string
  /** 该条对总分贡献（已按 cap 截断后计入） */
  weight: number
  /** 命中的原文片段（截断到 160 字符） */
  snippet: string
  /** 该用什么手段取证 */
  hint: string
}

export interface ScanResult {
  score: number
  findings: Finding[]
  chars: number
}

export interface ScanOptions {
  detectors?: Record<string, boolean>
  /** 同一类检测器最多计几条，避免长回答必然触发 */
  capPerKind?: number
}

interface DetectorSpec {
  kind: string
  weight: number
  hint: string
  find: (text: string) => string[]
}

const SNIPPET_MAX = 160

function clip(s: string): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > SNIPPET_MAX ? `${t.slice(0, SNIPPET_MAX)}…` : t
}

/** ```lang ... ``` 代码块 */
function codeBlocks(text: string): { lang: string; body: string }[] {
  const out: { lang: string; body: string }[] = []
  const re = /```([^\n`]*)\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    out.push({ lang: (m[1] || '').trim().toLowerCase(), body: m[2] || '' })
  }
  return out
}

/**
 * 空 lang 和 `text` 必须排除：真实语料里大量日志/散文放在无语言标注的围栏里，
 * 曾被当成命令行 → 实测 9/13 的无效证伪来自这里。
 */
const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'fish', 'nu', 'console', 'ps1', 'powershell', 'pwsh', 'cmd', 'batch', 'bat'])
const SHELL_PROMPT = /^\s*(?:\$|>|PS>|C:\\[^>]*>|#)\s*(.+)$/
/** 日志/表格/散文特征：命中就不当命令（评测实测的假命令全来自这类行） */
const NOT_A_COMMAND = /[\u4e00-\u9fff→⇒]|=>|\|\s|\d{2}:\d{2}:\d{2}|\bPID\b|\bMiB\b|\bGiB\b|\bStatus\s*=|={3,}|-{3,}/

/**
 * shell / 批处理 / PowerShell 的**语法**不是「可执行程序」。
 *
 * 这是实测出来的最大一类假证伪：把部署手册里的 .bat / .ps1 代码块逐行拿去 `which`，
 * 于是 `@echo off`、`title MyApp`、`set "VCVARS=..."`、`if not exist (...)`、
 * `env:PATH = ...`、`[pscustomobject]@{` 全被当成命令，判「程序不在 PATH 中」→ refuted。
 * 脚本越完整，假证伪越多——正是最该给用户看的那种文档受害最重。
 */
const SHELL_SYNTAX = [
  /^@/,
  /^&/,                                    // @echo off
  /^:(?!:)/,                               // 批处理标签
  /\[[\w.]*\]\s*@?\{?\s*$/,                // [pscustomobject]@{ 、[ordered]@{}
  /^["'][^"']*["']\s*$/,                   // whole-line string literal
  /^(set|setx|export|alias|unset|declare|local|readonly)\b/i,   // set "X=Y" / export X=Y
  /^(if|then|elif|else|fi|for|foreach|while|until|do|done|case|esac|select|switch|foreach-object|where-object)\b/i,
  /^(env:|\$env:|function|filter|param|begin|process|end|try|catch|finally|throw|return|break|continue)\b/i,
  // 注意：`echo` / `cd` / `cls` 之类**不列在这里** —— 它们已由 local.ts 的 PS_ALIASES
  // 判成「PowerShell 别名，不在 PATH 里是正常的」，而 `echo hi && del x` 这种复合命令
  // 还需要被 commandLines 抓出来交给 claims.ts 标 unmechanizable（有测试守着这条）。
  /^(rem|title|pause|color|prompt|ver|verify|vol|shift|goto|call|pushd|popd|setlocal|endlocal|chcp|attrib|assoc|ftype|path|exit|start-sleep)\b/i,
  /^(new-item|write-host|write-output|out-null|convertto-json|convertfrom-json|get-content|set-content|add-content|copy-item|move-item|remove-item|test-path|join-path|split-path|resolve-path|invoke-webrequest|invoke-restmethod)\b/i,
]
function isShellSyntax(cmd: string): boolean {
  return SHELL_SYNTAX.some((re) => re.test(cmd))
}

/** 从 shell 代码块里抽出「像是会被执行的命令行」 */
function commandLines(text: string): string[] {
  const out: string[] = []
  for (const block of codeBlocks(text)) {
    const labeled = SHELL_LANGS.has(block.lang)
    for (const raw of block.body.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#') || line.startsWith('//')) continue
      const m = SHELL_PROMPT.exec(line)
      // 无语言标注的块里，只有带提示符的行才算命令
      if (!labeled && !m) continue
      const cmd = (m ? m[1] : line).trim()
      if (cmd.length <= 2) continue
      if (NOT_A_COMMAND.test(cmd)) continue
      if (isShellSyntax(cmd)) continue
      // URL、参数续行、变量赋值都不是「可执行程序」：评测实测这些占了剩余假证伪的大头
      if (/^[a-z][\w+.-]*:\/\//i.test(cmd)) continue
      if (/^-/.test(cmd)) continue
      if (/^\$?[A-Za-z_][\w.]*\s*=[^=]/.test(cmd)) continue
      // 未加引号、含空格的可执行路径无法安全切分 argv → 不猜
      const first = cmd.split(/\s+/)[0]
      if (/[\\/.]/.test(first) && /\s/.test(cmd) && !/^["']/.test(cmd)) continue
      out.push(cmd)
    }
  }
  return out
}

/** 路径字符类必须排除 CJK 与全角标点，否则 `E:\a\b.json。日志在` 会把整段中文吞进路径 */
const NOT_IN_PATH = String.raw`^\s` + '`' + String.raw`'"<>()|、。，；：！？` + String.raw`\u3000-\u303f\u4e00-\u9fff\uff00-\uffef`
/** 盘符前必须有词边界：`https://…` 里的 `s:` 曾被当成盘符，截出 `s://docs.openwebui.com/license` 去文件系统里找 */
const PATH_RE = new RegExp(`(?<![A-Za-z0-9])[A-Za-z]:[/\\\\][${NOT_IN_PATH}]+|~?\\/(?:[\\w.@-]+\\/){1,}[\\w.@-]+`, 'g')
/** 路径后面紧跟的半角句读会被误吞（`E:\a\b.json.`），必须剥掉 */
const TRAILING_PUNCT = /[.,;:!?'"）)\]]+$/
/** 裸版本号形态带上可能的前置包名，否则 `cordis 4.0.4` 只剩 `4.0.4`，会拿错对象去比对 */
const VERSION_RE = /(?:[vV]ersion|版本)\s*[:：]?\s*\d+(?:\.\d+){1,3}|[vV]\d+(?:\.\d+){1,3}|\^\s?\d+\.\d+\.\d+|~\d+\.\d+\.\d+|(?:[A-Za-z@][\w@/.-]*\s+)?\d+\.\d+\.\d+(?:[-+][\w.]+)?|\b\d{3,}\.\d{3,}\b/g
const SYMBOL_RE = /`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,4}\([^`)]{0,60}\))`/g
const PACKAGE_RE = /`((?:@[a-z0-9._-]+\/)?[a-z][a-z0-9._-]{1,60}(?:@[~^]?\d[\w.-]*)?)`/g
const ABSOLUTE_RE = /(绝对|必然|肯定|一定能|一定会|保证|百分之百|100%|不可能出错|万无一失|一定可以|稳赢|definitely|guaranteed|certainly|always works|impossible to fail|100%\s*works)/gi
const NUMBER_RE = /\b\d+(?:[.,]\d+)?\s*(?:MB|GB|TB|KiB|MiB|GiB|ms|s|秒|分钟|小时|行|loc|tokens?|个\s?(?:文件|条目|问题)|%|％)(?![A-Za-z0-9])/gi
const REVERSAL_RE = /(抱歉|对不起|我之前说错|我说错|更正一下|更正：|其实刚才|刚才那(?:个|条)(?:不对|有误)|我犯(?:了)?错|sorry,?\s+i\s+(?:was\s+)?wrong|apolog)/i

/** 反引号里的东西远不是都是 npm 包：域名、文件名、路径都曾被当包名去 registry 查 */
const FILE_EXT_RE = /\.(json5?|ya?ml|toml|txt|md|py|js|mjs|cjs|ts|tsx|jsx|bat|cmd|exe|dll|so|dylib|gguf|log|lock|bak\d*|csv|ini|cfg|sh|ps1|patch|diff|html|css|svg|png|jpg|zip|tar|gz|xz)$/i
const DOMAIN_RE = /\.(com|net|org|cn|io|dev|app|edu|gov|mil|xyz|top|cc|tv|me|co|jp|kr|de|fr|ru|ir|uk|us|info|biz|ai|sh|link|cloud)$/i
function isPlausiblePackageName(token: string): boolean {
  const name = token.split('@').filter(Boolean)[0] ?? token
  if (!name) return false
  if (token.includes('://') || token.includes('\\')) return false
  if (FILE_EXT_RE.test(token) || DOMAIN_RE.test(name)) return false
  if (/[A-Z]/.test(name)) return false
  if (/^\d/.test(name)) return false
  // npm 名几乎不用下划线；真实语料里带下划线的反引号词全是配置键（base_url、reasoning_content…）
  if (name.includes('_')) return false
  return true
}

/** 反引号整段优先：真实语料里带空格的路径（`F:\Call to Arms …`）被正则截到空格处 → 假证伪 */
function isPathLike(t: string): boolean {
  if (!t || t.includes('\n') || t.includes('://')) return false
  // `\boxed{}` 这类 LaTeX 控制序列不是路径：单反斜杠开头不算路径（UNC 要 `\\server`）
  if (/^\\(?![\\/])/.test(t)) return false
  if (/[{}$`]/.test(t)) return false
  if (t.includes('...')) return false // 占位符，如 `C:\Users\...\截图.png`
  if (/^\.\.[\\/]/.test(t)) return false // 纯向上相对路径多是探测样例，不是存在性断言
  return /^[A-Za-z]:[\\/]/.test(t) || /^~?[\\/]{2}/.test(t) || /^~?\//.test(t) || /^\.{1,2}[\\/]/.test(t)
}

function pathCandidates(text: string): string[] {
  // 反引号与尖括号整段优先：真实语料里带空格/中文的路径常被这两种括号包住，
  // 正则会在空格或 CJK 处截断（`F:\Call to Arms …`、<E:\1009\MECHREVO_控制台>）
  const spans = [
    ...[...text.matchAll(/`([^`\n]{2,240})`/g)].map((m) => m[1].trim()),
    ...[...text.matchAll(/<([^<>\n]{2,240})>/g)].map((m) => m[1].trim()),
  ].filter(isPathLike)
  const out = new Set<string>(spans)
  for (const m of text.matchAll(PATH_RE)) {
    const p = m[0].replace(TRAILING_PUNCT, '')
    const whole = [...out].find((s) => s.startsWith(p))
    out.add(whole ?? p)
  }
  return [...out]
}

const DETECTORS: DetectorSpec[] = [
  {
    kind: 'command',
    weight: 2,
    hint: '把这条命令真的跑一遍，贴出退出码与输出，别凭记忆描述结果',
    find: (text) => commandLines(text),
  },
  {
    kind: 'path',
    weight: 1,
    hint: '确认该路径存在（列目录或读文件），不存在就改掉',
    find: (text) => pathCandidates(text),
  },
  {
    kind: 'version',
    weight: 2,
    hint: '用实际来源核对版本号（package.json / --version / 官方页面）',
    find: (text) => [...new Set(text.match(VERSION_RE) ?? [])],
  },
  {
    kind: 'symbol',
    weight: 2,
    hint: '确认该函数/方法签名真实存在（读定义处或类型声明），不要凭印象编 API',
    find: (text) => [...new Set([...text.matchAll(SYMBOL_RE)].map((m) => m[1]))],
  },
  {
    kind: 'package',
    weight: 2,
    hint: '确认包名与版本可安装（查 registry 或本地 node_modules）',
    find: (text) => [...new Set([...text.matchAll(PACKAGE_RE)].map((m) => m[1]))].filter(isPlausiblePackageName),
  },
  {
    kind: 'number',
    weight: 1,
    hint: '这个数字从哪来？给出测量方式或来源，否则改成区间/删掉',
    find: (text) => [...new Set(text.match(NUMBER_RE) ?? [])],
  },
  {
    kind: 'code',
    weight: 2,
    hint: '把代码块实际编译/运行一次，贴出真实结果',
    find: (text) => codeBlocks(text).filter((b) => !SHELL_LANGS.has(b.lang)).map((b) => `${b.lang} 代码块 ${b.body.split('\n').length} 行`),
  },
  {
    kind: 'absolute',
    weight: 2,
    hint: '绝对化结论需要证据；把「一定」换成有出处的表述，或补上验证',
    find: (text) => [...new Set(text.match(ABSOLUTE_RE) ?? [])],
  },
  {
    kind: 'reversal',
    weight: 3,
    hint: '本轮出现改口/认错：把被推翻的结论连同正确版本一起重新核验',
    find: (text) => [...new Set(text.match(REVERSAL_RE) ?? [])],
  },
]

export const DETECTOR_KINDS: readonly string[] = DETECTORS.map((d) => d.kind)

/**
 * 扫描一段回答，返回风险分与逐条断言。
 * 分数 = 各类命中权重之和（每类默认最多计 3 条）。
 */
export function scanAnswer(text: string, options: ScanOptions = {}): ScanResult {
  const body = String(text ?? '')
  const cap = Math.max(1, options.capPerKind ?? 3)
  const findings: Finding[] = []
  let score = 0

  for (const spec of DETECTORS) {
    if (options.detectors?.[spec.kind] === false) continue
    const hits = spec.find(body).filter((s) => clip(s).length > 0)
    let counted = 0
    for (const hit of hits) {
      if (counted >= cap) break
      counted += 1
      score += spec.weight
      findings.push({ kind: spec.kind, weight: spec.weight, snippet: clip(hit), hint: spec.hint })
    }
  }

  findings.sort((a, b) => b.weight - a.weight)
  return { score, findings, chars: body.length }
}

/** 本轮是否已经调用过取证类工具 */
export function turnHadVerification(toolNames: Iterable<string>, allowed: readonly string[]): boolean {
  const set = new Set(allowed)
  for (const name of toolNames) if (set.has(name)) return true
  return false
}

/** 会被当作「交付文档」的扩展名 */
const DELIVERABLE_RE = /\.(md|mdx|markdown|txt|rst|adoc)$/i
/** 这些目录下的东西是日志/产物，不是交付文档（实测 `logs/eval/agent/toolcall-probe.txt` 被误判） */
const DELIVERABLE_EXCLUDE_RE = /(^|[\\/])(logs?|tmp|temp|\.cache|node_modules|dist|build|out|\.git)([\\/]|$)/i
/** 能写出文件的工具名 */
const DOC_WRITER_TOOLS = new Set(['write', 'edit', 'ops_replace', 'str_replace_editor', 'create_file', 'apply_patch'])

/**
 * 本轮 write/edit 写出的**交付文档**路径。
 *
 * 实测坑：`tool/call` 的 `data.arguments` 是 **JSON 字符串**而不是对象，必须 parse 一次
 * 才能取到 path 字段（我第一次写探针时正是踩了这个，得到「0 轮写了文档」的假结论）。
 */
export function writtenDeliverables(events: readonly unknown[], turn: number): string[] {
  const out = new Set<string>()
  for (const raw of events) {
    const ev = raw as { type?: string; data?: any }
    if (ev?.type !== 'tool/call' || Number(ev.data?.turn) !== turn) continue
    if (!DOC_WRITER_TOOLS.has(String(ev.data?.name ?? ''))) continue
    const rawArgs = ev.data?.arguments
    let args: Record<string, unknown> | null = null
    if (typeof rawArgs === 'string') {
      try { args = JSON.parse(rawArgs) as Record<string, unknown> } catch { args = null }
    } else if (rawArgs && typeof rawArgs === 'object') {
      args = rawArgs as Record<string, unknown>
    }
    const p = args?.file_path ?? args?.path ?? args?.filePath ?? args?.target
    if (typeof p === 'string' && DELIVERABLE_RE.test(p) && !DELIVERABLE_EXCLUDE_RE.test(p)) out.add(p)
  }
  return [...out]
}

/**
 * 会话的工作目录 —— **运行时**的权威来源。
 *
 * 宿主自己的工具就是这么拿的，两处独立一致：
 *   `dsh-tool-fs/lib/index.js`:   `function sessionCwd(exec) { return exec.agent?.session.header.cwd }`
 *   `dsh-tool-bash/lib/index.js`: `const headerCwd = exec.agent?.session.header.cwd`
 *
 * 我原先用的是下面这个 `sessionCwd(events)`（在事件流里找 `type === 'session'` 的顶层 `cwd`）——
 * 那是**会话日志文件**里的形状，不是运行时 agent 的形状。实测后果：两条路径都回落到
 * `cfg.workspace`（= 宿主进程 cwd = profile 目录），于是 `packageVersion typescript`
 * 报「本机没有该包」。事件扫描保留为兜底。
 */
export function agentWorkspace(agent: unknown): string | null {
  const cwd = (agent as { session?: { header?: { cwd?: unknown } } } | undefined)?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.trim() ? cwd : null
}

/**
 * 会话的工作目录（**日志事件**里的形状，作为兜底）。
 *
 * 会话日志的第一个事件是 `{ type:'session', version:4, id, createdAt, cwd, ... }`
 * —— `cwd` 是顶层字段，不在 `data` 里（实测）。但运行时 agent 上不一定有这条事件，
 * 所以优先用 `agentWorkspace(agent)`。
 */
export function sessionCwd(events: readonly unknown[]): string | null {
  for (const raw of events) {
    const ev = raw as { type?: string; cwd?: unknown }
    if (ev?.type !== 'session') continue
    if (typeof ev.cwd === 'string' && ev.cwd.trim()) return ev.cwd
  }
  return null
}

/** 从会话事件里抽出某一 turn 的 assistant 文本与工具名 */
export interface TurnExtract {
  turn: number
  text: string
  toolNames: string[]
}

export function extractTurn(events: readonly unknown[], turn: number): TurnExtract {
  let text = ''
  const toolNames: string[] = []
  for (const raw of events) {
    const ev = raw as { type?: string; data?: any }
    if (!ev || typeof ev.type !== 'string' || !ev.data) continue
    if (Number(ev.data.turn) !== turn) continue
    if (ev.type === 'assistant/message') {
      text += collectText(ev.data.message)
    } else if (ev.type === 'tool/call' || ev.type === 'tool/result') {
      const name = ev.data.name ?? ev.data.toolName ?? ev.data.call?.name
      if (typeof name === 'string') toolNames.push(name)
    }
  }
  return { turn, text, toolNames }
}

/** 尽力从各种 message 形状里抠出纯文本 */
export function collectText(message: unknown): string {
  if (!message) return ''
  if (typeof message === 'string') return message
  const content = (message as { content?: unknown }).content ?? message
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const item of content) {
    if (!item || typeof item !== 'object') continue
    const part = item as Record<string, unknown>
    if (part.type === 'text' && typeof part.text === 'string') parts.push(part.text)
    else if (typeof part.text === 'string' && part.type !== 'tool-call') parts.push(part.text)
  }
  return parts.join('\n')
}

/** 最后一个 turn/end 的 turn 号；没有则 0 */
export function lastTurn(events: readonly unknown[]): number {
  let turn = 0
  for (const raw of events) {
    const ev = raw as { type?: string; data?: any }
    if (ev?.type === 'turn/end' && Number.isFinite(Number(ev.data?.turn))) turn = Number(ev.data.turn)
  }
  return turn
}
