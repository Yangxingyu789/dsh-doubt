/**
 * 自动取证循环（v0.2 核心改动）：
 *
 * turn 结束 → 扫描断言 → **插件自己**跑 Tier A（本机 oracle）/ Tier B（多来源交叉）
 * → 需要时跑 Tier C（无草稿上下文独立重推导 + 多数投票）
 * → 把**实测证据**注入下一轮，而不是请求模型「再去检查一遍」。
 *
 * 为什么这样改：内在自纠错（只让它再看一遍）在文献里会让结果变差
 * （arXiv 2310.01798：GPT-4 GSM8K 95.5→89.0，Llama-2 62.0→36.5；
 * 改动案例里「把对的改错」多于「把错的改对」）。
 * 外部反馈才有效（arXiv 2305.11738 CRITIC）。所以注入的是执行结果。
 */

import { randomUUID } from 'node:crypto'
import { extractClaims, type Claim } from './claims.js'
import type { DoubtConfig } from './config.js'
import { gatherEvidence, type Evidence } from './evidence.js'
import { factoredCheck, type FactoredOutcome } from './factored.js'
import { buildEvidenceText, buildProvenanceText, buildRecheckText, detectLanguage } from './prompts.js'
import { agentWorkspace, extractTurn, lastTurn, scanAnswer, sessionCwd, writtenDeliverables } from './scanner.js'

/** 只声明用到的最小 agent 形状，避免把 dsh-agent 类型拉进依赖 */
export interface DoubtAgent {
  id?: string
  status?: string
  session?: {
    id?: string
    snapshotEvents?: () => unknown[]
    events?: unknown[]
  }
  inbox?: { hasPending?: () => boolean; size?: number; length?: number }
  followup?: (message: unknown) => void
}

export interface LoopOptions {
  getConfig: () => DoubtConfig
  log?: (...args: unknown[]) => void
  /** Terminal completion-review failures must not restart legacy checks or provenance. */
  skipTurn?: (agent: DoubtAgent, turn: number) => boolean
  /** Reviewed prose needs no second assertion/Tier C pass; document provenance still applies. */
  reviewedTurn?: (agent: DoubtAgent, turn: number) => boolean
  /** 注入延迟（ms）：让宿主先把 idle 状态落稳，避免与用户 submit 竞态 */
  delayMs?: number
  /** 联网探测（可注入以便测试） */
  probe?: { state: () => Promise<{ online: boolean }> }
  /** Tier C 宿主能力（ctx.subagents + 当前 agent 作为 parent） */
  factoredHost?: (agent: DoubtAgent) => { subagents: any; parent: any } | null
}

interface Slot {
  rounds: number
  handledTurn: number
  /** 已经就「出处标注」问过的交付文档路径——同一份文档只问一次 */
  askedDocs: Set<string>
  /** 溯源要求的独立预算（与 rounds 分开，避免被断言级 maxRounds 饿死） */
  provAsks: number
}

const SESSION_CAP = 200
const SESSION_EVICT = 50

/** 交付文档的溯源闸用到的阈值 */
const PROVENANCE_MIN_CHARS = 1200
/** 一次人工回合内最多要求几次溯源（防止与模型来回 ping-pong） */
const PROVENANCE_MAX_ASKS = 4
/**
 * 文档路径的比对键。Windows 路径大小写不敏感，独立验证者实测过
 * `deliverable.md` / `DELIVERABLE.md` 会被当成两份文档各问一次。
 */
const docKey = (p: string): string => (process.platform === 'win32' ? p.toLowerCase() : p)
/**
 * 正文里**真的**有溯源产物的标志：必须是一个出处/溯源性质的标题。
 *
 * 这里刻意不认「官方文档」出现几次、也不认 `#### 3.4.1 顺序规则（有官方依据` 这种
 * 顺带提到「依据」的小标题 —— 实测一份 46k 字的手册里「官方文档」出现 58 次、
 * 「未验证」45 次，靠词频当判据会让所有引用充分的文档全部漏过。
 */
const PROVENANCE_SECTION_RE = /(^|\n)[ \t]*#{1,6}[ \t]*[^\n]{0,40}(溯源|出处|逐步骤|参考文献|来源总表|来源表|来源清单|引用清单|未验证项|依据表)/

export const SOURCE_KIND = 'dsh-doubt'

function sessionEvents(agent: DoubtAgent): unknown[] {
  const session = agent.session
  if (!session) return []
  try {
    if (typeof session.snapshotEvents === 'function') return session.snapshotEvents() ?? []
  } catch { /* ignore */ }
  try {
    if (Array.isArray(session.events)) return session.events
  } catch { /* ignore */ }
  return []
}

function inboxBusy(agent: DoubtAgent): boolean {
  try {
    const inbox = agent.inbox
    if (!inbox) return false
    if (typeof inbox.hasPending === 'function' && inbox.hasPending()) return true
    if (typeof inbox.size === 'number' && inbox.size > 0) return true
    if (typeof inbox.length === 'number' && inbox.length > 0) return true
  } catch { /* ignore */ }
  return false
}

/**
 * 本轮入口消息是不是我们自己注入的（用来数轮数、并在人工消息时重置预算）。
 *
 * 实测过的宿主落盘形状：`user/message` 的 data 只有 `{content,id,role,source}`，
 * **没有 turn 字段**（本机 337/337 条都不带），所以不能按 turn 去匹配——按 turn 匹配
 * 会永远返回 ''，于是每轮都把 rounds 归零，maxRounds 形同虚设（实测连插 4 轮，
 * 日志每次都写「第 1 轮」）。
 *
 * 真实顺序（本机 192 个 turn 实测）是：入口消息落在 `turn/start(N)` 之后，
 * 而自动注入的上下文（runtime-context / skill-catalog / tool-jobs / 各种提醒）落在**更后面**。
 * 所以必须取窗口里**第一条** user/message：
 *   - 取第一条 → user 122、goal 61、user-approval 5…（没有任何一条是 runtime-context / skill-catalog）
 *   - 取最后一条 → 12 条被 skill-catalog、4 条被 runtime-context 顶掉；
 *     这 16 个 turn 会把预算错误地归零，maxRounds 在这些轮里依然失效。
 */
function turnEntrySource(events: readonly unknown[], turn: number): string {
  const kindOf = (i: number): string => {
    const ev = events[i] as { type?: string; data?: any }
    const kind = ev.data?.source?.kind
    return typeof kind === 'string' ? kind : ''
  }
  let start = -1
  let end = -1
  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i] as { type?: string; data?: any }
    if (ev?.type === 'turn/end' && Number(ev.data?.turn) === turn) { end = i; break }
    if (start < 0 && ev?.type === 'turn/start' && Number(ev.data?.turn) === turn) start = i
  }
  if (end < 0) return ''
  if (start >= 0) {
    for (let i = start; i <= end; i += 1) {
      if ((events[i] as { type?: string })?.type === 'user/message') return kindOf(i)
    }
    return ''
  }
  // 极老/异常记录里没有 turn/start：退回「本轮结束前最后一条」，总比不判好
  for (let i = end; i >= 0; i -= 1) {
    if ((events[i] as { type?: string })?.type === 'user/message') return kindOf(i)
  }
  return ''
}

function makeMessage(text: string, summary = 'evidence'): unknown {
  return {
    id: `${SOURCE_KIND}-${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: SOURCE_KIND, form: 'notice', summary },
  }
}

/** 把断言改写成自包含、不含草稿的是非题（CoVe factored 风格） */
export function toQuestion(claim: Claim): string | null {
  switch (claim.kind) {
    case 'package':
      return `npm 包 \`${claim.text}\` 是否存在于 npm registry？只回答 yes 或 no。`
    case 'path':
      return `文件路径 \`${claim.text}\` 是否存在？只回答 yes 或 no。`
    case 'command':
      return `程序 \`${claim.text.split(/\s+/)[0]}\` 是否可在本机 PATH 中找到？只回答 yes 或 no。`
    case 'version':
      return `版本号 \`${claim.text}\` 是否与本机实际安装版本一致？回答 yes/no，若否给出实际版本。`
    case 'symbol':
      return `标识符 \`${claim.text}\` 是否真实存在于相关依赖或源码中？只回答 yes 或 no。`
    default:
      return null
  }
}

export function installDoubtLoop(ctx: any, options: LoopOptions): { dispose: () => void } {
  const log = options.log ?? (() => { /* noop */ })
  const delayMs = Number.isFinite(options.delayMs) ? Number(options.delayMs) : 150
  const slots = new Map<string, Slot>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const evaluating = new Set<string>()
  let disposed = false

  function slot(sessionId: string): Slot | null {
    if (!sessionId) return null
    let cur = slots.get(sessionId)
    if (!cur) {
      if (slots.size >= SESSION_CAP) {
        let i = 0
        for (const key of slots.keys()) {
          if (i >= SESSION_EVICT) break
          slots.delete(key)
          i += 1
        }
      }
      cur = { rounds: 0, handledTurn: 0, askedDocs: new Set<string>(), provAsks: 0 }
      slots.set(sessionId, cur)
    }
    return cur
  }

  async function evaluate(agent: DoubtAgent): Promise<void> {
    const id = String(agent.id ?? agent.session?.id ?? '')
    if (disposed || evaluating.has(id)) return
    evaluating.add(id)
    try { await evaluateTurn(agent) } finally { evaluating.delete(id) }
  }

  async function evaluateTurn(agent: DoubtAgent): Promise<void> {
    const cfg = options.getConfig()
    if (!cfg.enabled || !cfg.autoVerify) return
    if (agent.status === 'running' || inboxBusy(agent)) return

    const sessionId = String(agent.id ?? agent.session?.id ?? '')
    const entry = slot(sessionId)
    if (!entry) return

    const events = [...sessionEvents(agent)]
    const turn = lastTurn(events)
    if (turn <= 0 || entry.handledTurn === turn) return
    if (options.skipTurn?.(agent, turn)) { entry.handledTurn = turn; return }
    const end = events.findLast((e: any) => e?.type === 'turn/end' && Number(e.data?.turn) === turn) as any
    // DSH records reason as { kind: 'completed' }; older fixtures used a string.
    const endReason = typeof end?.data?.reason === 'string' ? end.data.reason : end?.data?.reason?.kind
    if (endReason && endReason !== 'completed') return

    const entrySource = turnEntrySource(events, turn)
    if (entrySource !== SOURCE_KIND) {
      entry.rounds = 0
      entry.provAsks = 0
    }

    const extract = extractTurn(events, turn)
    if (extract.text.length < cfg.minAnswerChars) return

    const scan = scanAnswer(extract.text, { detectors: cfg.detectors })

    // ── 交付文档溯源闸：与「只有正面反驳才说话」**并列**的独立触发类 ──
    //
    // 为什么单独一条：实测在一份 46k 字的部署手册上，机械判定只能覆盖 21 条断言，
    // 其中 20 条「本机判不了」、1 条还是假证伪；而同一个模型被问一句「所有流程是否
    // 都有据可依」后，能自己产出 42 项 / 9 类的溯源表。所以文档场景下正确的动作不是
    // 「判不了就沉默」，而是**要求它自己披露依据**。
    //
    // 历史上这条分支早于工具名豁免：对文档而言「用了 read/write」不是取证。
    // 工具名豁免已移除；文档溯源仍保留自己的触发条件与预算。
    //
    // 预算独立于 maxRounds：maxRounds 是为「断言级插话」设的（默认 2），而一份文档一份
    // 溯源表是交付要求。只在本轮**新写出的**交付文档上触发、同一路径只问一次，另加
    // provAsks 硬顶，避免与模型来回 ping-pong。
    if (cfg.requireProvenance && entry.provAsks < PROVENANCE_MAX_ASKS && extract.text.length >= PROVENANCE_MIN_CHARS) {
      const written = writtenDeliverables(events, turn)
      if (written.length > 0) {
        const fresh = written.filter((p) => !entry.askedDocs.has(docKey(p)))
        for (const p of written) entry.askedDocs.add(docKey(p))
        if (fresh.length > 0 && scan.score >= cfg.minScore) {
          const hasProvenance = PROVENANCE_SECTION_RE.test(extract.text)
          if (!hasProvenance && typeof agent.followup === 'function') {
            agent.followup(makeMessage(
              buildProvenanceText({ files: fresh, score: scan.score, findings: scan.findings }, detectLanguage(extract.text, cfg.language)),
              'provenance',
            ))
            entry.handledTurn = turn
            entry.provAsks += 1
            log(`dsh-doubt：turn ${turn} 写了交付文档但正文没有出处标注（风险分 ${scan.score}），已要求逐步骤溯源表（第 ${entry.provAsks} 次）：${fresh.join(' / ')}`)
            return
          }
        }
      }
    }

    // Completion review already checked this prose against evidence. Keep the
    // independent deliverable requirement above, but do not audit it again via
    // legacy claims or create factored children after the answer was accepted.
    if (options.reviewedTurn?.(agent, turn)) { entry.handledTurn = turn; return }

    // 断言级检查也必须继续：用过工具并不能证明回答中的其它断言。
    if (entry.rounds >= cfg.maxRounds) return
    if (scan.score < cfg.minScore) return

    const claims = extractClaims(scan.findings, { executeAnswerCommands: cfg.executeAnswerCommands, text: extract.text })
    if (claims.length === 0) return

    const net = options.probe
      ? await options.probe.state()
      : { online: false }
    // 运行时权威来源是 agent.session.header.cwd（宿主自己的工具也用这个）；
    // 事件扫描只在拿不到 header 时兜底。
    const workspace = agentWorkspace(agent) ?? sessionCwd(events) ?? undefined
    const evidence: Evidence[] = await gatherEvidence(claims, cfg, { online: net.online, probedAt: Date.now(), latencyMs: 0 }, workspace)

    const actionable = evidence.filter((e) => e.verdict !== 'confirmed')
    const factored: Record<string, FactoredOutcome> = {}

    // Tier C：只在「本机/网络拿不出判据」或「来源冲突」时补，且必须离线或证据不足
    if (cfg.factored) {
      const need = actionable.filter((e) => e.verdict === 'unverifiable' || e.verdict === 'inconclusive')
      const host = options.factoredHost?.(agent) ?? null
      for (const e of need.slice(0, 3)) {
        const claim = claims.find((c) => c.id === e.claimId)
        const q = claim ? toQuestion(claim) : null
        if (!q) continue
        factored[e.claimId] = await factoredCheck(q, {
          provider: cfg.factoredProvider,
          votes: cfg.factoredVotes,
          timeoutMs: cfg.timeoutMs,
        }, host)
      }
    }

    const mechanical = evidence.filter((e) => e.verdict !== 'unverifiable')
    // 插话闸门（评测实测：旧规则「非 confirmed 就说话」= 152/152 全插话，纯噪音）。
    // 只有**正面反驳**或**独立重推导不一致**才值得打断；单纯「核验不了」不打扰。
    const hard = evidence.filter((e) => e.verdict === 'refuted' || (e.verdict === 'inconclusive' && e.contradicting > 0))
    const disagreed = Object.values(factored).some((f) => f.available && f.majority === null)
    if (hard.length === 0 && !disagreed) {
      const ok = evidence.filter((e) => e.verdict === 'confirmed').length
      const unk = evidence.filter((e) => e.verdict === 'unverifiable').length
      log(`dsh-doubt：turn ${turn} ${evidence.length} 条断言（证实 ${ok}／无法核验 ${unk}），没有正面反驳，不打扰`)
      entry.handledTurn = turn
      return
    }

    const lang = detectLanguage(extract.text, cfg.language)
    let text: string
    if (mechanical.length === 0 && Object.keys(factored).every((k) => !factored[k].available)) {
      // 完全无法机械核验、也没有子代理能力 → 退化成让模型自己取证
      text = buildRecheckText(claims, scan.score, lang, cfg.maxFindings)
    } else {
      text = buildEvidenceText({
        evidence: hard.concat(mechanical.filter((e) => e.verdict === 'inconclusive' && e.contradicting === 0)),
        factored: Object.keys(factored).length > 0 ? factored : undefined,
        strictLabeling: cfg.strictLabeling,
        requireSources: cfg.requireSources,
        online: net.online,
      }, lang)
    }

    // 取证可能耗时；用户已继续、出现新事件或插件已卸载时不得注入旧结论。
    if (disposed || agent.status === 'running' || inboxBusy(agent)
      || sessionEvents(agent).length !== events.length || !options.getConfig().enabled
      || typeof agent.followup !== 'function') return
    try {
      agent.followup(makeMessage(text))
      entry.handledTurn = turn
      entry.rounds += 1
      const counts = actionable.reduce<Record<string, number>>((acc, e) => {
        acc[e.verdict] = (acc[e.verdict] ?? 0) + 1
        return acc
      }, {})
      log(`dsh-doubt：turn ${turn} 风险分 ${scan.score}，已注入实测证据（${Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(' ')}），第 ${entry.rounds} 轮`)
    } catch (e) {
      log('dsh-doubt：followup 失败', e)
    }
  }

  function listen(name: string, handler: (payload: any) => void): (() => void) | null {
    if (typeof ctx?.on !== 'function') return null
    try {
      const off = ctx.on(name, handler, { global: true })
      return typeof off === 'function' ? off : null
    } catch {
      try {
        const off = ctx.on(name, handler)
        return typeof off === 'function' ? off : null
      } catch {
        return null
      }
    }
  }

  const offStatus = listen('agent/status', (payload) => {
    const agent = payload?.agent as DoubtAgent | undefined
    if (!agent || payload?.status !== 'idle') return
    const timer = setTimeout(() => {
      timers.delete(timer)
      evaluate(agent).catch((e) => log('dsh-doubt：取证评估异常', e))
    }, delayMs)
    timers.add(timer)
  })

  return {
    dispose() {
      disposed = true
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      slots.clear()
      try {
        offStatus?.()
      } catch { /* ignore */ }
    },
  }
}
