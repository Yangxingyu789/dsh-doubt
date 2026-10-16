/**
 * Tier C：离线时的「多次检查」——**不是**「再看一遍你确定吗」。
 *
 * 文献依据：
 * - 内在自纠错会让推理变差（arXiv 2310.01798，GPT-4 GSM8K 95.5→89.0，Llama-2 62.0→36.5）
 * - 独立重推导 + 多数投票有效（self-consistency），且 CoVe 的 factored 变体
 *   要求核验时**不能看到自己的草稿**，否则会复制同一个幻觉
 *
 * 所以这里做的是：把断言改写成自包含的是非题，丢给**没有草稿上下文**的
 * 独立子代理回答 N 次，取多数。拿不到子代理能力就如实返回 unavailable。
 */

export interface FactoredHost {
  /** ctx.subagents */
  subagents: any
  /** 发起方 agent（用于 lineage / workspace） */
  parent: any
}

export interface FactoredVote {
  raw: string
  normalized: string
}

export interface FactoredOutcome {
  available: boolean
  /** 多数答案（归一化后）；分裂时为 null */
  majority: string | null
  agree: number
  total: number
  votes: FactoredVote[]
  reason?: string
}

/** 归一化：把「是的，存在 / yes / 确认」压成同一类 */
export function normalizeAnswer(text: string): string {
  const t = text.trim().toLowerCase()
  if (!t) return ''
  if (/^(yes|y|true|correct|存在|是|对|确认|成立|可以|能)/.test(t) || /(^|[\s,。])(yes|true|存在|是|对|成立)/.test(t.slice(0, 40))) {
    if (/(not|no|不存在|错误|不成立|不能|无法)/.test(t.slice(0, 60))) return 'negative'
    return 'affirmative'
  }
  if (/^(no|not|false|不存在|否|错|不成立|不能|无法)/.test(t)) return 'negative'
  // 版本号 / 路径 / 数字类答案：取第一个可比较 token（v1.2.3 与 1.2.3 必须归一到同一票）
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
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs)
      run = await host.subagents.start(opts.provider, {
        label: `dsh-doubt-factored-${i + 1}`,
        // 自包含提问：不含草稿，避免 CoVe 说的「复制同一幻觉」
        prompt: [{ type: 'text', text: `只回答事实，不要解释，不要道歉。${question}` }],
        parent: host.parent,
        signal: controller.signal,
      })
      const result = await run.result
      clearTimeout(timer)
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
