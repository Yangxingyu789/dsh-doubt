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

const SHELL_LANGS = new Set(['', 'bash', 'sh', 'shell', 'zsh', 'console', 'ps1', 'powershell', 'pwsh', 'cmd', 'batch', 'bat', 'text', ''])
const SHELL_PROMPT = /^\s*(?:\$|>|PS>|C:\\[^>]*>|#)\s*(.+)$/

/** 从 shell 代码块里抽出「像是会被执行的命令行」 */
function commandLines(text: string): string[] {
  const out: string[] = []
  for (const block of codeBlocks(text)) {
    if (!SHELL_LANGS.has(block.lang)) continue
    for (const raw of block.body.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#') || line.startsWith('//')) continue
      const m = SHELL_PROMPT.exec(line)
      const cmd = (m ? m[1] : line).trim()
      if (cmd.length > 2 && /\s/.test(cmd) || /^[A-Za-z0-9_.-]+$/.test(cmd)) out.push(cmd)
    }
  }
  return out
}

/** 路径字符类必须排除 CJK 与全角标点，否则 `E:\a\b.json。日志在` 会把整段中文吞进路径 */
const NOT_IN_PATH = String.raw`^\s` + '`' + String.raw`'"<>()|、。，；：！？` + String.raw`\u3000-\u303f\u4e00-\u9fff\uff00-\uffef`
const PATH_RE = new RegExp(`(?:[A-Za-z]:[/\\\\][${NOT_IN_PATH}]+)|(?:~?\\/(?:[\\w.@-]+\\/){1,}[\\w.@-]+)`, 'g')
/** 路径后面紧跟的半角句读会被误吞（`E:\a\b.json.`），必须剥掉 */
const TRAILING_PUNCT = /[.,;:!?'"）)\]]+$/
/** 裸版本号形态带上可能的前置包名，否则 `cordis 4.0.4` 只剩 `4.0.4`，会拿错对象去比对 */
const VERSION_RE = /(?:[vV]ersion|版本)\s*[:：]?\s*\d+(?:\.\d+){1,3}|[vV]\d+(?:\.\d+){1,3}|\^\s?\d+\.\d+\.\d+|~\d+\.\d+\.\d+|(?:[A-Za-z@][\w@/.-]*\s+)?\d+\.\d+\.\d+(?:[-+][\w.]+)?|\b\d{3,}\.\d{3,}\b/g
const SYMBOL_RE = /`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,4}\([^`)]{0,60}\))`/g
const PACKAGE_RE = /`((?:@[a-z0-9._-]+\/)?[a-z][a-z0-9._-]{1,60}(?:@[~^]?\d[\w.-]*)?)`/g
const ABSOLUTE_RE = /(绝对|必然|肯定|一定能|一定会|保证|百分之百|100%|不可能出错|万无一失|一定可以|稳赢|definitely|guaranteed|certainly|always works|impossible to fail|100%\s*works)/gi
const NUMBER_RE = /\b\d+(?:[.,]\d+)?\s*(?:MB|GB|TB|KiB|MiB|GiB|ms|s|秒|分钟|小时|行|loc|tokens?|个\s?(?:文件|条目|问题)|%|％)(?![A-Za-z0-9])/gi
const REVERSAL_RE = /(抱歉|对不起|我之前说错|我说错|更正一下|更正：|其实刚才|刚才那(?:个|条)(?:不对|有误)|我犯(?:了)?错|sorry,?\s+i\s+(?:was\s+)?wrong|apolog)/i

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
    find: (text) => [...new Set((text.match(PATH_RE) ?? []).map((p) => p.replace(TRAILING_PUNCT, '')).filter(Boolean))],
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
    find: (text) => [...new Set([...text.matchAll(PACKAGE_RE)].map((m) => m[1]))],
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
