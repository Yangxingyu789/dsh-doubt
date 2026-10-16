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
import { buildEvidenceText, buildRecheckText, detectLanguage } from './prompts.js'
import { extractTurn, lastTurn, scanAnswer, turnHadVerification } from './scanner.js'

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
}

const SESSION_CAP = 200
const SESSION_EVICT = 50

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

/** 本轮入口消息是不是我们自己注入的（用来数轮数、并在人工消息时重置） */
function turnEntrySource(events: readonly unknown[], turn: number): string {
  for (const raw of events) {
    const ev = raw as { type?: string; data?: any }
    if (ev?.type !== 'user/message' || Number(ev.data?.turn) !== turn) continue
    const kind = ev.data?.source?.kind
    return typeof kind === 'string' ? kind : ''
  }
  return ''
}

function makeMessage(text: string): unknown {
  return {
    id: `${SOURCE_KIND}-${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: SOURCE_KIND, form: 'notice', summary: 'evidence' },
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
      cur = { rounds: 0, handledTurn: 0 }
      slots.set(sessionId, cur)
    }
    return cur
  }

  async function evaluate(agent: DoubtAgent): Promise<void> {
    const cfg = options.getConfig()
    if (!cfg.enabled || !cfg.autoVerify) return
    if (agent.status === 'running' || inboxBusy(agent)) return

    const sessionId = String(agent.id ?? agent.session?.id ?? '')
    const entry = slot(sessionId)
    if (!entry) return

    const events = sessionEvents(agent)
    const turn = lastTurn(events)
    if (turn <= 0 || entry.handledTurn === turn) return

    const entrySource = turnEntrySource(events, turn)
    if (entrySource !== SOURCE_KIND) entry.rounds = 0
    if (entry.rounds >= cfg.maxRounds) return

    const extract = extractTurn(events, turn)
    if (extract.text.length < cfg.minAnswerChars) return
    if (turnHadVerification(extract.toolNames, cfg.verificationTools)) return

    const scan = scanAnswer(extract.text, { detectors: cfg.detectors })
    if (scan.score < cfg.minScore) return

    const claims = extractClaims(scan.findings, { executeAnswerCommands: cfg.executeAnswerCommands })
    if (claims.length === 0) return

    const net = options.probe
      ? await options.probe.state()
      : { online: false }
    const evidence: Evidence[] = await gatherEvidence(claims, cfg, { online: net.online, probedAt: Date.now(), latencyMs: 0 })

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
    if (actionable.length === 0) {
      log(`dsh-doubt：turn ${turn} 的 ${evidence.length} 条断言全部核实通过，不打扰`)
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
        evidence,
        factored: Object.keys(factored).length > 0 ? factored : undefined,
        strictLabeling: cfg.strictLabeling,
        requireSources: cfg.requireSources,
        online: net.online,
      }, lang)
    }

    if (typeof agent.followup !== 'function') return
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
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      slots.clear()
      try {
        offStatus?.()
      } catch { /* ignore */ }
    },
  }
}
