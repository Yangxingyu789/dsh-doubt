/**
 * 危险变更闸门：从工具轨迹里机械识别「会改变正在运行的宿主/系统」的动作，
 * 并核对三件产物——回滚路径、用户确认点、动作后的独立健康检查。
 *
 * 事故背景：上一窗口在 DSH 宿主运行中把改造版插件装进 live profile
 * （`.dsh/plugins` + `.dsh/profiles/desktop`），宿主随后所有工具报
 * `cannot get required service "sessionProjections" in inactive context`，用户被迫重启。
 * 这个闸门把「模型破坏自己的运行环境」变成结构性打回 + 回归测试，而不是道歉话术。
 *
 * 全部是纯函数：无 I/O、无网络、无模型调用；同样输入必得同样输出。
 *
 * 作用域 = **当前轮**：只检测 `call.turn === undefined || call.turn === turn` 的调用
 * （没有 turn 字段的 fixture 视为当前轮）。历史轮的危险变更**不参与**判定——否则一次
 * 早期安装会让之后每一轮普通回答都被要求附回滚路径，变成永久假阳性。历史完成声明
 * 仍由现有 LLM 审核的 postcondition 时序契约负责。
 */
import { DEFAULT_CONFIG, type DoubtConfig } from './config.js'
import { toolTrace, type ToolTrace } from './operations.js'
import { collectText } from './scanner.js'

export type LiveMutationKind = 'install' | 'write' | 'delete' | 'process' | 'service' | 'registry'

export interface LiveMutationFinding {
  callId: string
  name: string
  kind: LiveMutationKind
  /** 命中的目标（路径或命令片段，≤120 字符） */
  target: string
  /** 稳定规则名，测试可断言，见规格 §4 */
  rule: string
}

export interface LiveMutationAssessment {
  mutated: boolean
  findings: LiveMutationFinding[]
  requirements: { rollback: boolean; confirm: boolean; healthCheck: boolean }
  present: { rollback: boolean; confirm: boolean; healthCheck: boolean }
  /** 打回意见（中文、逐条、可直接展示给作者），未满足时非空 */
  gaps: string[]
  satisfied: boolean
}

const GAP_ROLLBACK = '危险变更缺少回滚路径：必须给出备份位置（备份/backup/.bak/快照）和可直接执行的回滚命令。'
const GAP_CONFIRM = '危险变更缺少用户确认点：宿主运行中的插件/profile 安装或写入不许模型自行决定，必须先说明影响面并取得确认（批准事件或用户明确授权）。'
const GAP_HEALTH = '危险变更后缺少独立健康检查：必须在变更后另起一次工具调用证明宿主/工具仍可用（安装回执不算），并把结果写进回答。'

/** 同一调用命中多规则时取最高危：install > registry/service > process > delete > write */
const KIND_RANK: Record<LiveMutationKind, number> = {
  install: 6,
  registry: 5,
  service: 5,
  process: 4,
  delete: 3,
  write: 2,
}

const MAX_TARGET = 120
const WRITE_TOOLS = new Set(['write', 'edit', 'ops_replace'])
const SHELL_TOOLS = new Set(['pwsh', 'bash', 'shell', 'ops_pwsh', 'ops_bash', 'exec', 'run', 'verify_claims'])
const WRITE_PATH_KEYS = ['file_path', 'filePath', 'path', 'target', 'dest', 'destination', 'to'] as const
const WORKDIR_KEYS = ['workdir', 'cwd', 'dir', 'workingDirectory'] as const

const norm = (s: string): string => s.replace(/\\/g, '/').toLowerCase()
/** 作用域 = 当前轮；没有 turn 字段的旧记录视为当前轮 */
const inScope = (call: ToolTrace, turn: number): boolean => call.turn === undefined || call.turn === turn
const clip = (s: string): string => (s.length > MAX_TARGET ? s.slice(0, MAX_TARGET) : s)

/** liveMutationPaths 为空（或全是空串）时退回默认值，与 config.ts 的 strings() 语义一致 */
function livePaths(config: DoubtConfig): string[] {
  const raw = Array.isArray(config.liveMutationPaths) ? config.liveMutationPaths : []
  const kept = raw.filter((s): s is string => typeof s === 'string' && s.trim() !== '')
  return (kept.length ? kept : DEFAULT_CONFIG.liveMutationPaths).map(norm)
}

function isLivePath(path: string, config: DoubtConfig): boolean {
  if (!path) return false
  const p = norm(path)
  return livePaths(config).some((raw) => p.includes(raw))
}

function firstString(args: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

/** 命令文本来源：command / cmd / script；verify_claims 的 command checks 用 argv.join(' ') */
function commandTexts(args: Record<string, unknown>): string[] {
  const texts: string[] = []
  for (const key of ['command', 'cmd', 'script'] as const) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) texts.push(value)
  }
  if (Array.isArray(args.checks)) {
    for (const raw of args.checks) {
      if (!raw || typeof raw !== 'object') continue
      const check = raw as Record<string, unknown>
      if (check.kind !== 'command' || !Array.isArray(check.argv)) continue
      const argv = check.argv.filter((v): v is string => typeof v === 'string')
      if (argv.length) texts.push(argv.join(' '))
    }
  }
  return texts
}

// §4.3 触发规则（大小写不敏感）。防误报要点见规格：查询类命令、普通仓库 edit、
// 非递归单文件 del 都不得命中。
const RE_INSTALL = /\b(?:pnpm|npm|yarn|corepack)(?:\.cmd|\.exe)?\s+(?:install|i|add|ci|rebuild)\b/i
const RE_INSTALL_LOCAL_TRIGGER = /\bnode(?:\.exe)?\b[^\n]*install-local(?:\.mjs|\.js)?/i
const RE_INSTALL_LOCAL_NAME = /install-local(?:\.mjs|\.js)?/i
const RE_RECURSIVE_DELETE = /\b(?:remove-item|rmdir|rd|del|erase|rm)\b[^\n]*(?:\s-recurse\b|\/s\b|\s-rf\b|\s-r\b)/i
// Shell/JS source contains `=>`, `->`, `>=`, `<=` which are NOT shell redirects: a
// read-only `node -e "...map(x => x)..."` that mentions a live path was once classified
// as a live write and gated the answer. Drop arrow/comparison operators before testing
// redirect-style writes.
const stripOperators = (command: string): string => command.replace(/=>|->|>=|<=/g, ' ')
const RE_MUTATION_VERB = /\b(?:remove-item|del|erase|rmdir|rm|move-item|mv|copy-item|cp|set-content|out-file|add-content|new-item|tee)\b|(?:^|[\s\w)\]"])\s*>{1,2}\s*[^\s>&]/i
const RE_DELETE_VERB = /\b(?:remove-item|rmdir|rd|del|erase|rm)\b/i
const RE_PROCESS = /\b(?:stop-process|taskkill|kill|shutdown|restart-computer|stop-service|sc\s+stop|net\s+stop)\b/i
const RE_REG = /\breg\s+(?:add|delete|import|load|restore)\b/i
const RE_ITEMPROPERTY = /\b(?:set|new)-itemproperty[^\n]*(?:hklm|hkcu|hkey_)/i
const RE_SCHTASKS = /\bschtasks\s+\/create\b/i

function writeFinding(call: ToolTrace, config: DoubtConfig): LiveMutationFinding | undefined {
  if (!WRITE_TOOLS.has(call.name)) return undefined
  // ops_replace 的 dryRun 只是观察，不是变更
  if (call.name === 'ops_replace' && call.args.dryRun === true) return undefined
  const path = firstString(call.args, WRITE_PATH_KEYS)
  if (!path || !isLivePath(path, config)) return undefined
  return { callId: call.id, name: call.name, kind: 'write', target: clip(path), rule: 'live-path-write' }
}

const SYSTEM_DELETE_HINTS = ['windows', 'program files', 'programdata', 'system32', 'syswow64']
/** POSIX temp roots (path-relative) and cross-platform temp variable markers. */
const SAFE_DELETE_PREFIXES = ['/tmp/', '/var/tmp/', '/private/tmp/']
const SAFE_DELETE_CONTAINS = ['$env:temp', '$env:tmp', '%temp%', '%tmp%', '/temp/']

/** Extract the first non-flag argument after a delete verb; [] when no target is visible.
 *  Flags like -Recurse/-Force or /s are skipped; quoted paths are unquoted. */
function deleteTargets(command: string): string[] {
  const verb = /\b(?:remove-item|rmdir|rd|del|erase|rm)\b/i.exec(command)
  if (!verb) return []
  const tail = command.slice(verb.index + verb[0].length)
  const tokens = tail.match(/"[^"]*"|'[^']*'|[^\s;|]+/g) ?? []
  const targets: string[] = []
  for (const raw of tokens) {
    const token = raw.replace(/^["']|["']$/g, '')
    if (!token) continue
    if (/^[-/]/.test(token)) continue // PowerShell/cmd flags (paths start with a drive letter)
    if (/^(?:-|&&|\|\||\||;)/.test(token)) continue
    targets.push(token)
    if (targets.length >= 4) break
  }
  return targets
}

function dangerousDeleteTarget(target: string, workdir: string, config: DoubtConfig): boolean {
  const t = norm(target)
  if (isLivePath(target, config)) return true
  if (SYSTEM_DELETE_HINTS.some((hint) => t.includes(hint))) return true
  if (/^[a-z]:\/+$/.test(t)) return true // drive root
  if (SAFE_DELETE_PREFIXES.some((hint) => t.startsWith(hint)) || SAFE_DELETE_CONTAINS.some((hint) => t.includes(hint))) return false
  // A recursive delete under a supplied, non-live working directory is a normal
  // project cleanup (e.g. `rm -rf node_modules`); do not gate it.
  const relativeTarget = !/^[a-z]:[\\/]/i.test(target) && !target.startsWith('/') && !target.startsWith('\\')
  if (workdir && !isLivePath(workdir, config) && (relativeTarget || t.startsWith(norm(workdir)))) return false
  // Unknown / arbitrary external path: keep blocking (conservative).
  return true
}

/** Non-flag path-ish tokens after a verb (flags like -Recurse / -Force or /s are skipped). */
function pathTokens(text: string): string[] {
  const tokens = text.match(/"[^"]*"|'[^']*'|[^\s;|]+/g) ?? []
  const out: string[] = []
  for (const raw of tokens) {
    const token = raw.replace(/^["']|["']$/g, '')
    if (!token) continue
    if (/^[-/]/.test(token)) continue
    if (/^(?:&&|\|\||\||;)/.test(token)) continue
    out.push(token)
    if (out.length >= 6) break
  }
  return out
}

/** Destination a shell command writes to; undefined when the shape is not recognized.
 *  Direction matters: copying the live plugin directory OUT to a backup is read-only,
 *  while copying anything INTO a live path is a mutation. */
function writeDestination(command: string): string | undefined {
  const redirect = /(?:^|[\s|;)])(?:>{1,2})\s*([^\s>&]+)/.exec(command)
  if (redirect) return redirect[1]
  const copy = /\b(copy-item|move-item|cp|mv|xcopy|robocopy)\b/i.exec(command)
  if (copy) {
    const tokens = pathTokens(command.slice(copy.index + copy[0].length))
    return tokens[tokens.length - 1]
  }
  const content = /\b(set-content|out-file|add-content|new-item|tee)\b/i.exec(command)
  if (content) {
    const pathFlag = /-(?:path|literalpath|filepath|destination)\s+["']?([^"'\s;|]+)/i.exec(command)
    if (pathFlag) return pathFlag[1]
    const tokens = pathTokens(command.slice(content.index + content[0].length))
    return tokens[tokens.length - 1]
  }
  return undefined
}

function shellFindings(call: ToolTrace, config: DoubtConfig): LiveMutationFinding[] {
  if (!SHELL_TOOLS.has(call.name)) return []
  const workdir = firstString(call.args, WORKDIR_KEYS) ?? ''
  const out: LiveMutationFinding[] = []
  const add = (kind: LiveMutationKind, rule: string, target: string): void => {
    out.push({ callId: call.id, name: call.name, kind, target: clip(target), rule })
  }
  for (const command of commandTexts(call.args)) {
    const context = `${command} ${workdir}`
    const live = isLivePath(context, config)
    const mutationText = stripOperators(command)
    const installer = RE_INSTALL.exec(command)
    if (installer && live) add('install', 'install-into-live-profile', installer[0])
    // 本仓库安装脚本会写 .dsh/plugins，不需要命令里再出现 live 路径
    if (RE_INSTALL_LOCAL_TRIGGER.test(command)) {
      add('write', 'install-local-script', RE_INSTALL_LOCAL_NAME.exec(command)?.[0] ?? 'install-local')
    }
    if (RE_RECURSIVE_DELETE.test(command)) {
      const targets = deleteTargets(command)
      // No visible target (e.g. `Remove-Item -Recurse $var`) stays conservative → flagged.
      const dangerous = targets.length === 0 ? true : targets.some((target) => dangerousDeleteTarget(target, workdir, config))
      if (dangerous) add('delete', 'recursive-delete', command)
    }
    if (live && RE_MUTATION_VERB.test(mutationText)) {
      if (RE_DELETE_VERB.test(mutationText)) {
        add('delete', 'live-path-shell-mutation', command)
      } else {
        const destination = writeDestination(command)
        // Unknown destination keeps the conservative behavior; a live path used only as
        // a copy source (e.g. backing up the live plugin directory) is read-only.
        if (destination === undefined || isLivePath(destination, config)) add('write', 'live-path-shell-mutation', command)
      }
    }
    if (RE_PROCESS.test(command)) add('process', 'process-control', command)
    if (RE_REG.test(command)) add('registry', 'registry-or-service', command)
    else if (RE_ITEMPROPERTY.test(command)) add('registry', 'registry-or-service', command)
    if (RE_SCHTASKS.test(command)) add('service', 'registry-or-service', command)
  }
  return out
}

function pickFinding(candidates: readonly LiveMutationFinding[]): LiveMutationFinding | undefined {
  let best: LiveMutationFinding | undefined
  for (const candidate of candidates) {
    if (!best || KIND_RANK[candidate.kind] > KIND_RANK[best.kind]) best = candidate
  }
  return best
}

/** §4.2/§4.3：识别当前轮的 live 环境变更；一条工具调用最多一个 finding（按 callId 去重） */
export function detectLiveMutations(events: readonly unknown[], turn: number, config: DoubtConfig): LiveMutationFinding[] {
  const byCall = new Map<string, LiveMutationFinding>()
  for (const call of toolTrace(events)) {
    if (!inScope(call, turn)) continue
    const candidates: LiveMutationFinding[] = []
    const write = writeFinding(call, config)
    if (write) candidates.push(write)
    candidates.push(...shellFindings(call, config))
    const best = pickFinding(candidates)
    if (!best) continue
    const previous = byCall.get(call.id)
    if (!previous || KIND_RANK[best.kind] > KIND_RANK[previous.kind]) byCall.set(call.id, best)
  }
  return [...byCall.values()]
}

/** 回滚路径：回滚词 + 备份证据 + 可直接执行的回滚命令，三者同时满足 */
export function rollbackDisclosed(draft: string): boolean {
  const rollbackWord = /回滚|rollback|还原|撤销|revert/i.test(draft)
  const backupEvidence = /备份|backup|\.bak\b|快照|snapshot|副本|回滚点/i.test(draft)
  const executable = draft.includes('```') || /^\s*(?:cd|copy|cp|robocopy|xcopy|git|node|pnpm|npm|remove-item|restore)\b/im.test(draft)
  return rollbackWord && backupEvidence && executable
}

/** 用户确认点：批准事件必须在对应 mutation 的 tool/call 之前；draft 自述「已确认」不算 */
export function confirmationSeen(
  events: readonly unknown[],
  findings: readonly LiveMutationFinding[],
  messages?: readonly any[],
): boolean {
  if (!findings.length) return false
  const callIndexById = new Map<string, number>()
  const approvalIndices: number[] = []
  for (let i = 0; i < events.length; i++) {
    const ev = events[i] as { type?: string; data?: any }
    if (ev?.type === 'tool/call') {
      const id = String(ev.data?.callId ?? ev.data?.id ?? '')
      if (id && !callIndexById.has(id)) callIndexById.set(id, i)
    } else if (ev?.type === 'user/message' && ev.data?.source?.kind === 'user-approval') {
      approvalIndices.push(i)
    }
  }
  const approvedBefore = (index: number | undefined): boolean =>
    index !== undefined && approvalIndices.some((approval) => approval < index)
  const eventApproval = findings.every((finding) => approvedBefore(callIndexById.get(finding.callId)))
  if (eventApproval && approvalIndices.length > 0) return true
  // 可选兜底：最后一条真人请求本身授权了这次动作（不是草稿里的自我声明）
  const humans = (messages ?? []).filter((m: any) =>
    m && m.role === 'user' && (!m.source?.kind || ['user', 'user-approval'].includes(m.source.kind)))
  const last = humans.length ? humans[humans.length - 1] : undefined
  if (!last) return false
  return explicitAuthorization(collectText(last))
}

/** A human message that explicitly authorizes one dangerous action.
 *  Either a short standalone confirmation, or a confirmation word together with
 *  the kind of action. Used for the post-hoc confirmation point AND (with the
 *  last human message only) for the pre-execution approval seam. */
export function explicitAuthorization(text: string): boolean {
  const trimmed = text.trim()
  // 明确的一句确认（如用户在模型询问安装后回复「确认」）本身就是授权；
  // 旧规则要求同句出现动作词，会把这种真实确认误判为缺失。
  if (/^(?:确认|批准|同意|允许|授权|approved?|confirm(?:ed)?|yes|ok)[。.!！\s]*$/i.test(trimmed)) return true
  return /确认|批准|同意|允许|授权|approve|confirm/i.test(trimmed)
    && /安装|写入|修改|删除|停止|重启|install|write|delete|stop|restart/i.test(trimmed)
}

/** Pre-execution classification for one tool call (same rules as the post-hoc trace scan).
 *  Exported so the pre-execute gate and its tests use exactly one set of rules. */
export function classifyToolCall(name: string, args: unknown, config: DoubtConfig): LiveMutationFinding | undefined {
  let parsed: unknown = args
  if (typeof args === 'string') {
    try { parsed = JSON.parse(args) } catch { parsed = {} }
  }
  const normalized = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  const call: ToolTrace = { id: 'pre-execute', name, args: normalized, callIndex: 0, resultIndex: -1, state: 'pending', resultText: '' }
  const candidates: LiveMutationFinding[] = []
  const write = writeFinding(call, config)
  if (write) candidates.push(write)
  candidates.push(...shellFindings(call, config))
  return pickFinding(candidates)
}

/** 动作后的独立健康检查：变更完成后另起一次工具调用并真实完成（安装回执不算） */
export function healthChecked(
  events: readonly unknown[],
  turn: number,
  findings: readonly LiveMutationFinding[],
): { ok: boolean; callIds: string[] } {
  if (!findings.length) return { ok: false, callIds: [] }
  const trace = toolTrace(events).filter((call) => inScope(call, turn))
  const findingIds = new Set(findings.map((finding) => finding.callId))
  const byId = new Map(trace.map((call) => [call.id, call] as const))
  let last = -1
  for (const finding of findings) {
    const call = byId.get(finding.callId)
    if (!call || call.resultIndex < 0) return { ok: false, callIds: [] }
    if (call.resultIndex > last) last = call.resultIndex
  }
  const callIds = trace
    .filter((call) => call.callIndex > last && call.resultIndex >= 0 && call.state === 'completed' && !findingIds.has(call.id))
    .map((call) => call.id)
  return { ok: callIds.length > 0, callIds }
}

/** 汇总裁定：mutated 时三件产物缺任何一件 → satisfied=false，gaps 逐条给出中文打回意见 */
export function assessLiveMutation(input: {
  events: readonly unknown[]
  turn: number
  draft: string
  config: DoubtConfig
  /** 真人请求（用于确认点兜底：最后一条请求本身授权了这次危险动作） */
  messages?: readonly any[]
}): LiveMutationAssessment {
  const { events, turn, draft, config, messages } = input
  const findings = config.guardLiveMutation === false ? [] : detectLiveMutations(events, turn, config)
  const mutated = findings.length > 0
  const present = {
    rollback: mutated ? rollbackDisclosed(draft) : false,
    confirm: mutated ? confirmationSeen(events, findings, messages) : false,
    healthCheck: mutated ? healthChecked(events, turn, findings).ok : false,
  }
  const requirements = { rollback: mutated, confirm: mutated, healthCheck: mutated }
  const gaps: string[] = []
  if (mutated) {
    if (!present.rollback) gaps.push(GAP_ROLLBACK)
    if (!present.confirm) gaps.push(GAP_CONFIRM)
    if (!present.healthCheck) gaps.push(GAP_HEALTH)
  }
  const satisfied = !mutated || (present.rollback && present.confirm && present.healthCheck)
  return { mutated, findings, requirements, present, gaps, satisfied }
}
