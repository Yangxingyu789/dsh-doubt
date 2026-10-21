
import assert from 'node:assert/strict'
import { reviewDraft, planReviewChunks } from '../lib/completion.js'
import { normalizeConfig } from '../lib/config.js'

const iterable = async function* (items) { yield* items }
const textChunks = (text) => [{ type: 'text-delta', index: 0, text }, { type: 'finish', reason: { kind: 'stop' } }]
const payloadOf = (r) => JSON.parse(r.messages[1].content[0].text)
const approveReply = (r) => {
  const p = payloadOf(r)
  return JSON.stringify({ decision: 'approve', segments: [{ partIds: p.draftParts.map((x) => x.id), kind: 'nonfactual', evidence: [] }] })
}
const msgs = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '做一个长任务的验收。' }] }]
const historyEvent = (id, text) => [
  { type: 'tool/call', data: { turn: 0, callId: id, name: 'read', arguments: '{}' } },
  { type: 'tool/result', surfaceOp: 'append', data: { turn: 0, message: { toolCallId: id, source: { callId: id }, content: [{ type: 'text', text }] } } },
]


const draft = ('甲'.repeat(600) + '\n').repeat(40)
const cfg = normalizeConfig({ segmentedReview: true, reviewMaxChars: 8000, factored: false, reviewTimeoutMs: 2000 })
const segCount = planReviewChunks(draft, cfg.reviewMaxChars).length
assert.ok(segCount > 1, `测试前提：应切成多段，实际 ${segCount} 段`)


{
  let calls = 0
  const out = await reviewDraft([], 1, msgs, draft, {}, { stream: (r) => { calls++; return iterable(textChunks(approveReply(r))) } }, cfg)
  assert.equal(out.decision.approved, true, '全段通过应放行')
  assert.equal(out.uncovered.length, 0)
  assert.equal(calls, segCount, `每段应各审一次，实际 ${calls} 次 / ${segCount} 段`)
  console.log('  ✓ 全段通过：approved，调用次数 =', calls)
}


{
  let calls = 0
  const out = await reviewDraft([], 1, msgs, draft, {}, {
    stream: (r) => {
      calls++
      if (calls === 2) return iterable([{ type: 'finish', reason: { kind: 'stop' } }, { type: 'text-delta', index: 0, text: JSON.stringify({ decision: 'unavailable', issues: ['material omitted'] }) }])
      return iterable(textChunks(approveReply(r)))
    },
  }, cfg)
  assert.equal(out.decision.approved, false)
  assert.equal(out.uncovered.length, 1, '应只有 1 段未审完')
  assert.equal(out.uncovered[0].id, 1, '未审完的应是第 2 段（id=1）')
  assert.equal(out.decision.failure?.code, 'EVIDENCE_CONTEXT_LIMIT')
  assert.ok(out.uncovered[0].preview.length <= 40)
  console.log('  ✓ 单段 unavailable：只披露该段，failure =', out.decision.failure.code)
}


{
  let calls = 0
  const out = await reviewDraft([], 1, msgs, draft, {}, {
    stream: (r) => {
      calls++
      if (calls === 2) return iterable(textChunks(JSON.stringify({ decision: 'verify', issues: ['第 2 段缺少工具依据'] })))
      return iterable(textChunks(approveReply(r)))
    },
  }, cfg)
  assert.equal(out.decision.approved, false)
  assert.deepEqual(out.decision.issues, ['第 2 段缺少工具依据'])
  assert.equal(out.decision.failure, undefined, 'verify 不是审核服务故障')
  assert.equal(calls, 2, `应在第 2 段拿到意见后立即返回，实际调用了 ${calls} 次`)
  console.log('  ✓ 单段 verify：立即返回，调用次数 =', calls)
}


{
  let calls = 0
  const current = historyEvent('current', 'True').map((e) => ({ ...e, data: { ...e.data, turn: 1 } }))
  const out = await reviewDraft([...historyEvent('read', 'True'), ...current], 1, msgs, draft, {}, {
    stream: (r) => {
      calls++
      if (calls === 2) return iterable([{ type: 'finish', reason: { kind: 'error', failure: { code: 'REVIEW_TIMEOUT' } } }])
      const p = payloadOf(r)

      if (calls === 3) assert.ok(p.evidence.every((e) => e.turn === 1 || e.turn === undefined), '重试包应只保留当前轮证据')
      return iterable(textChunks(JSON.stringify({ decision: 'approve', segments: [{ partIds: p.draftParts.map((x) => x.id), kind: 'nonfactual', evidence: [] }] })))
    },
  }, cfg)
  assert.equal(out.decision.approved, true, '去历史重试后应放行')
  assert.equal(calls, segCount + 1, `应为 ${segCount} 段 + 1 次重试，实际 ${calls}`)
  console.log('  ✓ 单段超时：去历史重试一次后放行，调用次数 =', calls)
}


{
  let calls = 0
  const single = normalizeConfig({ segmentedReview: false, reviewMaxChars: 8000, factored: false, reviewTimeoutMs: 2000 })
  const smallDraft = '乙'.repeat(2000)
  const out = await reviewDraft([], 1, msgs, smallDraft, {}, { stream: (r) => { calls++; return iterable(textChunks(approveReply(r))) } }, single)
  assert.equal(out.decision.approved, true)
  assert.equal(calls, 1, '关闭分段后应只有一次审核调用')

  let calls2 = 0
  const big = await reviewDraft([], 1, msgs, draft, {}, { stream: (r) => { calls2++; return iterable(textChunks(approveReply(r))) } }, single)
  assert.equal(big.decision.approved, false)
  assert.ok(['INPUT_LIMIT', 'EVIDENCE_CONTEXT_LIMIT'].includes(big.decision.failure?.code), '超预算单包应返回输入/上下文限制，实际 ' + big.decision.failure?.code)
  console.log('  ✓ segmentedReview=false：小草稿单包一次调用；超预算草稿单包受限（' + big.decision.failure.code + '）—— 即改造前的 fail-open 机制')
}

console.log('review-draft.test OK：多段审核的通过/单段失败披露/立即返回/去历史重试/单包回退 全部符合预期')
