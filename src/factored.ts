

export interface FactoredHost {
  /** ctx.subagents */
  subagents: any

  parent: any
}

export interface FactoredVote {
  raw: string
  normalized: string
}

export interface FactoredOutcome {
  available: boolean

  majority: string | null
  agree: number
  total: number
  votes: FactoredVote[]
  reason?: string
}


const AFFIRM_HEAD_RE = /^(yes|y|true|correct)\b/
const AFFIRM_CJK_HEAD_RE = /^(存在|是|对|确认|成立|可以|能)/
const NEG_HEAD_RE = /^(no|not|false|none|never)\b/
const NEG_CJK_HEAD_RE = /^(不存在|否|错|不成立|不能|无法)/


const AFFIRM_INLINE_RE = /(^|[\s,。])(yes|true)\b|\b(exists|present|installed|available)\b|(?<!不)存在|(?<!不)成立/
const NEG_INLINE_RE = /\b(not|no|false)\b|不存在|错误|不成立|不能|无法/

export function normalizeAnswer(text: string): string {
  const t = text.trim().toLowerCase()
  if (!t) return ''
  const head = t.slice(0, 60)
  const negative = NEG_HEAD_RE.test(t) || NEG_CJK_HEAD_RE.test(t) || NEG_INLINE_RE.test(head)
  const affirmative = AFFIRM_HEAD_RE.test(t) || AFFIRM_CJK_HEAD_RE.test(t) || AFFIRM_INLINE_RE.test(head)
  if (negative && !affirmative) return 'negative'
  if (affirmative && !negative) return 'affirmative'


  const m = /(v?\d+\.\d+(?:\.\d+)?)|([A-Za-z]:\\[\w\\.-]+|\/[\w./-]+)/.exec(t)
  if (m) return (m[1] ?? m[2] ?? t.slice(0, 60)).replace(/^v(?=\d)/, '')
  return t.replace(/\s+/g, ' ').slice(0, 60)
}

function firstText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const b of blocks) {
    if (b && typeof b === 'object' && (b as any).type === 'text' && typeof (b as any).text === 'string') {
      parts.push((b as any).text)
    }
  }
  return parts.join('\n').trim()
}

export async function factoredCheck(
  question: string,
  opts: { provider: string; votes: number; timeoutMs: number },
  host: FactoredHost | null,
): Promise<FactoredOutcome> {
  if (!host?.subagents?.start || !host.parent) {
    return { available: false, majority: null, agree: 0, total: 0, votes: [], reason: '宿主未提供 subagent 能力，Tier C 跳过' }
  }
  const votes: FactoredVote[] = []
  for (let i = 0; i < opts.votes; i += 1) {
    let run: any
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const controller = new AbortController()
      timer = setTimeout(() => controller.abort(), opts.timeoutMs)
      run = await host.subagents.start(opts.provider, {
        label: `dsh-doubt-factored-${i + 1}`,

        prompt: [{ type: 'text', text: `只回答事实，不要解释，不要道歉。${question}` }],
        parent: host.parent,
        signal: controller.signal,
      })
      const result = await run.result
      const raw = firstText(result?.output)
      const normalized = normalizeAnswer(raw)
      if (normalized) votes.push({ raw: raw.slice(0, 200), normalized })
    } catch (e) {
      return {
        available: false,
        majority: null,
        agree: 0,
        total: votes.length,
        votes,
        reason: `subagent 调用失败：${String(e instanceof Error ? e.message : e)}`,
      }
    } finally {

      if (timer) clearTimeout(timer)
      try {
        await run?.dispose?.()
      } catch { /* 忽略清理失败 */ }
    }
  }

  if (votes.length === 0) {
    return { available: true, majority: null, agree: 0, total: 0, votes, reason: '子代理没有给出可用答案' }
  }
  const counts = new Map<string, number>()
  for (const v of votes) counts.set(v.normalized, (counts.get(v.normalized) ?? 0) + 1)
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const [top, n] = sorted[0]
  const need = Math.floor(votes.length / 2) + 1
  if (n < need) {
    return { available: true, majority: null, agree: n, total: votes.length, votes, reason: `投票分裂：${sorted.map(([k, c]) => `${k}×${c}`).join(' / ')}` }
  }
  return { available: true, majority: top, agree: n, total: votes.length, votes }
}
