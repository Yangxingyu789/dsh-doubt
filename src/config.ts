

export interface DoubtConfig {

  enabled: boolean

  verifyTool: boolean

  promptSection: boolean


  autoVerify: boolean

  requireSources: number

  probeUrls: string[]

  registryUrls: string[]

  onlineTimeoutMs: number


  factored: boolean

  factoredVotes: number

  factoredProvider: string


  executeAnswerCommands: boolean

  strictLabeling: boolean

  requireProvenance: boolean

  requireOperationEvidence: boolean

  operationMaxRounds: number

  reviewTimeoutMs: number

  reviewMaxChars: number

  segmentedReview: boolean

  reviewReasoningEffort: 'off' | 'low' | 'high' | 'max' | 'default'

  guardLiveMutation: boolean

  guardPreExecute: boolean

  reviewNotice: 'banner' | 'short' | 'off'

  reviewMaterialOnly: boolean

  liveMutationPaths: string[]

  workspace: string


  maxRounds: number

  minScore: number

  maxFindings: number

  minAnswerChars: number

  detectors: Record<string, boolean>

  verificationTools: string[]

  denyBinaries: string[]

  timeoutMs: number

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


  factoredProvider: 'spawn',

  executeAnswerCommands: false,
  strictLabeling: true,
  requireProvenance: true,
  requireOperationEvidence: true,
  operationMaxRounds: 3,
  reviewTimeoutMs: 120_000,
  reviewMaxChars: 120_000,
  segmentedReview: true,
  reviewReasoningEffort: 'off',
  guardLiveMutation: true,
  guardPreExecute: true,
  reviewNotice: 'off',
  reviewMaterialOnly: true,
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
    reviewReasoningEffort: (['off', 'low', 'high', 'max', 'default'] as const).includes(src.reviewReasoningEffort as any)
      ? (src.reviewReasoningEffort as DoubtConfig['reviewReasoningEffort'])
      : d.reviewReasoningEffort,
    guardLiveMutation: bool(src.guardLiveMutation, d.guardLiveMutation),
    guardPreExecute: bool(src.guardPreExecute, d.guardPreExecute),
    reviewNotice: src.reviewNotice === 'banner' || src.reviewNotice === 'short' || src.reviewNotice === 'off'
      ? src.reviewNotice
      : d.reviewNotice,
    reviewMaterialOnly: bool(src.reviewMaterialOnly, d.reviewMaterialOnly),
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
