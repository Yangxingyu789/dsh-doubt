/**
 * 插件配置：类型、Standard Schema 校验器、归一化。
 *
 * 不依赖 schemastery/z，自己实现 StandardSchemaV1，
 * 这样 `dsh --dump-config-schema` 与 profile 配置校验都能吃到。
 */

export interface DoubtConfig {
  /** 总开关 */
  enabled: boolean
  /** 注册 verify_claims 工具（让模型能主动取证） */
  verifyTool: boolean
  /** 注入一段使用指引到系统提示词 */
  promptSection: boolean
  /** 自动复核循环：turn 结束后自动追加一轮取证 */
  autoRecheck: boolean
  /** 每个 session 自动复核的轮数上限（人工发新消息即重置） */
  maxRounds: number
  /** 风险分达到该阈值才触发复核 */
  minScore: number
  /** 复核消息里最多列出多少条断言 */
  maxFindings: number
  /** 短于该字符数的回答不触发（避免一句话也被拦） */
  minAnswerChars: number
  /** 单个检测器开关 */
  detectors: Record<string, boolean>
  /** 本轮出现过这些工具调用，就视为「已经取过证」 */
  verificationTools: string[]
  /** verify_claims 里禁止执行的程序名（小写、不含扩展名） */
  denyBinaries: string[]
  /** 单条 check 的执行超时 */
  timeoutMs: number
  /** 注入文本语言：auto 按回答文本判断 */
  language: 'auto' | 'zh' | 'en'
}

export const DEFAULT_CONFIG: DoubtConfig = {
  enabled: true,
  verifyTool: true,
  promptSection: true,
  autoRecheck: true,
  maxRounds: 2,
  minScore: 6,
  maxFindings: 8,
  minAnswerChars: 240,
  detectors: {},
  verificationTools: [
    'bash',
    'pwsh',
    'ops_bash',
    'ops_pwsh',
    'ops_run_background',
    'read',
    'ops_inspect_local_file',
    'grep',
    'ops_grep',
    'glob',
    'ops_glob',
    'web_search',
    'web_fetch',
    'verify_claims',
  ],
  denyBinaries: [
    'rm', 'del', 'erase', 'format', 'diskpart', 'mkfs', 'dd',
    'shutdown', 'reboot', 'reg', 'schtasks', 'netsh', 'cipher',
    'vssadmin', 'wevtutil', 'rmdir', 'erase',
  ],
  timeoutMs: 15_000,
  language: 'auto',
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(n)))
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (value === undefined || value === null) return fallback
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function strings(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  const out = value.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  return out.length > 0 ? out : [...fallback]
}

/** 把任意输入（patch YAML / 用户 JSON）归一化成可信配置 */
export function normalizeConfig(raw: unknown): DoubtConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const d = DEFAULT_CONFIG
  const detectors: Record<string, boolean> = {}
  const rawDetectors = (src.detectors && typeof src.detectors === 'object' ? src.detectors : {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(rawDetectors)) detectors[k] = bool(v, true)

  const lang = src.language === 'zh' || src.language === 'en' || src.language === 'auto'
    ? (src.language as DoubtConfig['language'])
    : d.language

  const maxRounds = clampInt(src.maxRounds, 0, 5, d.maxRounds)
  return {
    enabled: bool(src.enabled, d.enabled),
    verifyTool: bool(src.verifyTool, d.verifyTool),
    promptSection: bool(src.promptSection, d.promptSection),
    autoRecheck: bool(src.autoRecheck, d.autoRecheck) && maxRounds > 0,
    maxRounds,
    minScore: clampInt(src.minScore, 1, 100, d.minScore),
    maxFindings: clampInt(src.maxFindings, 1, 30, d.maxFindings),
    minAnswerChars: clampInt(src.minAnswerChars, 0, 100_000, d.minAnswerChars),
    detectors,
    verificationTools: strings(src.verificationTools, d.verificationTools).map((s) => s.trim()),
    denyBinaries: strings(src.denyBinaries, d.denyBinaries).map((s) => s.trim().toLowerCase()),
    timeoutMs: clampInt(src.timeoutMs, 500, 120_000, d.timeoutMs),
    language: lang,
  }
}

/** StandardSchemaV1：让 cordis 在启动时校验 patch 里的 config */
export const Config = {
  '~standard': {
    version: 1 as const,
    vendor: 'dsh-doubt',
    validate: (value: unknown) => {
      if (value !== undefined && value !== null && typeof value !== 'object') {
        return { issues: [{ message: 'dsh-doubt config 必须是一个对象' }] }
      }
      return { value: normalizeConfig(value) }
    },
    types: undefined as { input: unknown; output: DoubtConfig } | undefined,
  },
}
