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

  /** Tier A/B：turn 结束后插件**自己**取证并把实测结果注入，而不是请求模型去取证 */
  autoVerify: boolean
  /** 在线时 confirmed 需要几个互相独立的来源一致 */
  requireSources: number
  /** 联网探测候选 URL */
  probeUrls: string[]
  /** registry 候选（多来源交叉用） */
  registryUrls: string[]
  /** 在线请求超时 */
  onlineTimeoutMs: number

  /** Tier C：无草稿上下文的独立重推导 + 多数投票（离线时的「多次检查」） */
  factored: boolean
  /** 投票次数（self-consistency 的采样数） */
  factoredVotes: number
  /** subagent provider 名；探测失败会自动跳过 */
  factoredProvider: string

  /** 是否真的执行回答里出现的命令（默认只验证程序是否存在） */
  executeAnswerCommands: boolean
  /** 无法核验的断言必须在最终回答里显式标注「未验证」 */
  strictLabeling: boolean
  /** 交付文档（.md/.txt 等）被写出、但正文没有任何出处标注时，要求补一份逐步骤溯源表 */
  requireProvenance: boolean
  /** 在 llm/stream 暂存最终回答，结合实际工具证据独立审核后才显示 */
  requireOperationEvidence: boolean
  /** 最终正文退回补查上限（每个宿主 turn，独立于旧 followup 预算） */
  operationMaxRounds: number
  /** 独立审核超时（ms，两次尝试各自计时）；超时不能放行未经审核的草稿 */
  reviewTimeoutMs: number
  /** 审核请求的字符上限。审核输入基本是中文正文与工具证据，字符量级≈token 量级，
   *  120k 字符实测会让审核调用超过 60s 而超时（REVIEW_TIMEOUT → 回答被扣留） */
  reviewMaxChars: number
  /** 分段审核：单包装不下证据时，把草稿按段拆成多次审核，避免整轮 fail-open */
  segmentedReview: boolean
  /** 危险变更闸门：工具轨迹出现 live 环境变更（live profile/plugins 写入、宿主机安装、
   *  杀进程/停服务、注册表/服务、递归删除、系统目录写入）时，最终审核确定性打回，
   *  要求回滚路径 + 用户确认 + 动作后独立健康检查；false 时完全退回旧行为 */
  guardLiveMutation: boolean
  /** 受保护的 live 路径片段（大小写、斜杠不敏感）；空数组按默认值处理 */
  liveMutationPaths: string[]
  /** 本机查找 node_modules / package.json 的起点 */
  workspace: string

  /** 自动注入的轮数上限（人工发新消息即重置） */
  maxRounds: number
  /** 风险分达到该阈值才触发 */
  minScore: number
  /** 注入消息里最多列出多少条断言 */
  maxFindings: number
  /** 短于该字符数的回答不触发 */
  minAnswerChars: number
  /** 单个检测器开关 */
  detectors: Record<string, boolean>
  /** @deprecated 仅为兼容旧配置保留；不参与放行或豁免判断 */
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

  autoVerify: true,
  requireSources: 2,
  probeUrls: [
    'https://registry.npmmirror.com/-/ping',
    'https://registry.npmjs.org/-/ping',
    'https://export.arxiv.org/api/query?max_results=1',
  ],
  registryUrls: ['https://registry.npmmirror.com', 'https://registry.npmjs.org'],
  onlineTimeoutMs: 8_000,

  factored: true,
  factoredVotes: 3,
  // 实测核对：dsh-subagent-spawn-in-process 注册名 = config.providerName，默认 "spawn"
  // 该 provider 的子代理是 fresh child Agent、zero parent context —— 正是 Tier C 需要的无草稿上下文
  factoredProvider: 'spawn',

  executeAnswerCommands: false,
  strictLabeling: true,
  requireProvenance: true,
  requireOperationEvidence: true,
  operationMaxRounds: 2,
  reviewTimeoutMs: 120_000,
  reviewMaxChars: 48_000,
  segmentedReview: true,
  guardLiveMutation: true,
  liveMutationPaths: ['.dsh/profiles', '.dsh/plugins', 'program files', 'programdata', 'c:/windows'],
  workspace: process.cwd(),

  maxRounds: 2,
  minScore: 6,
  maxFindings: 8,
  minAnswerChars: 240,
  detectors: {},
  verificationTools: [
    'bash', 'pwsh', 'ops_bash', 'ops_pwsh', 'ops_run_background',
    'read', 'ops_inspect_local_file', 'grep', 'ops_grep', 'glob', 'ops_glob',
    'web_search', 'web_fetch', 'verify_claims',
  ],
  // 注意：verify.ts 比对前会剥掉 .exe/.cmd/.bat 等扩展名，所以这里写裸名即可。
  // shell 解释器必须在内：argv[0] 传 cmd/powershell 等于自己开一个 shell，
  // 实测 `cmd.exe /c del <文件>` 真的把文件删了，整个黑名单形同虚设。
  // 这不影响合法的 `.cmd` 目标（如 npm.cmd）：那种情况是 verify.ts 内部用 cmd.exe
  // 包装参数，黑名单只看 argv[0]，`npm.cmd` → `npm` 不在列表里。
  denyBinaries: [
    'rm', 'del', 'erase', 'format', 'diskpart', 'mkfs', 'dd',
    'shutdown', 'reboot', 'reg', 'schtasks', 'netsh', 'cipher',
    'vssadmin', 'wevtutil', 'rmdir',
    'cmd', 'powershell', 'pwsh', 'wscript', 'cscript', 'mshta',
    'sh', 'bash', 'zsh', 'dash', 'fish', 'ksh',
    'rundll32', 'regsvr32', 'certutil', 'bitsadmin',
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

    autoVerify: bool(src.autoVerify, d.autoVerify),
    requireSources: clampInt(src.requireSources, 1, 5, d.requireSources),
    probeUrls: strings(src.probeUrls, d.probeUrls),
    registryUrls: strings(src.registryUrls, d.registryUrls),
    onlineTimeoutMs: clampInt(src.onlineTimeoutMs, 500, 60_000, d.onlineTimeoutMs),

    factored: bool(src.factored, d.factored),
    factoredVotes: clampInt(src.factoredVotes, 1, 7, d.factoredVotes),
    factoredProvider: typeof src.factoredProvider === 'string' && src.factoredProvider.trim()
      ? src.factoredProvider.trim()
      : d.factoredProvider,

    executeAnswerCommands: bool(src.executeAnswerCommands, d.executeAnswerCommands),
    strictLabeling: bool(src.strictLabeling, d.strictLabeling),
    requireProvenance: bool(src.requireProvenance, d.requireProvenance),
    requireOperationEvidence: bool(src.requireOperationEvidence, d.requireOperationEvidence),
    operationMaxRounds: clampInt(src.operationMaxRounds, 0, 5, d.operationMaxRounds),
    reviewTimeoutMs: clampInt(src.reviewTimeoutMs, 100, 180_000, d.reviewTimeoutMs),
    reviewMaxChars: clampInt(src.reviewMaxChars, 1000, 500_000, d.reviewMaxChars),
    segmentedReview: bool(src.segmentedReview, d.segmentedReview),
    guardLiveMutation: bool(src.guardLiveMutation, d.guardLiveMutation),
    liveMutationPaths: strings(src.liveMutationPaths, d.liveMutationPaths).map((s) => s.trim()),
    workspace: typeof src.workspace === 'string' && src.workspace.trim() ? src.workspace.trim() : d.workspace,

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
