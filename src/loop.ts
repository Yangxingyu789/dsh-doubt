/**
 * 自动复核循环：turn 结束后扫描这一轮的回答，
 * 若存在「可核验但没取证」的断言，就自动追加一轮 followup 让模型去取证。
 *
 * 等价于用户手动连问「你确定吗」，但由插件判定、有轮数上限、可关。
 */

import { randomUUID } from 'node:crypto'
import type { DoubtConfig } from './config.js'
import { buildRecheckText, detectLanguage } from './prompts.js'
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

/** 本轮入口消息是不是我们自己注入的（用来数复核轮数、并在人工消息时重置） */
function turnEntrySource(events: readonly unknown[], turn: number): string {
  for (const raw of events) {
    const ev = raw as { type?: string; data?: any }
    if (ev?.type !== 'user/message' || Number(ev.data?.turn) !== turn) continue
    const kind = ev.data?.source?.kind
    return typeof kind === 'string' ? kind : ''
  }
  return ''
}

function makeRecheckMessage(text: string): unknown {
  return {
    id: `${SOURCE_KIND}-${randomUUID()}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: SOURCE_KIND, form: 'notice', summary: 'recheck' },
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

  function evaluate(agent: DoubtAgent): void {
    const cfg = options.getConfig()
    if (!cfg.enabled || !cfg.autoRecheck) return
    if (agent.status === 'running' || inboxBusy(agent)) return

    const sessionId = String(agent.id ?? agent.session?.id ?? '')
    const entry = slot(sessionId)
    if (!entry) return

    const events = sessionEvents(agent)
    const turn = lastTurn(events)
    if (turn <= 0 || entry.handledTurn === turn) return

    const entrySource = turnEntrySource(events, turn)
    if (entrySource === SOURCE_KIND) {
      // 这一轮是复核轮本身：轮数已经消耗过
    } else {
      entry.rounds = 0
    }
    if (entry.rounds >= cfg.maxRounds) return

    const extract = extractTurn(events, turn)
    if (extract.text.length < cfg.minAnswerChars) return
    if (turnHadVerification(extract.toolNames, cfg.verificationTools)) return

    const scan = scanAnswer(extract.text, { detectors: cfg.detectors })
    if (scan.score < cfg.minScore) return

    const lang = detectLanguage(extract.text, cfg.language)
    const text = buildRecheckText(scan.findings, scan.score, lang, cfg.maxFindings)
    if (typeof agent.followup !== 'function') return

    try {
      agent.followup(makeRecheckMessage(text))
      entry.handledTurn = turn
      entry.rounds += 1
      log(`dsh-doubt：turn ${turn} 风险分 ${scan.score}，已追加第 ${entry.rounds} 轮复核（${scan.findings.length} 条断言）`)
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
      try {
        evaluate(agent)
      } catch (e) {
        log('dsh-doubt：复核评估异常', e)
      }
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
