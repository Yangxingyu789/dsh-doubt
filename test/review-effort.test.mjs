



import assert from 'node:assert/strict'
import { reviewPacket } from '../lib/completion.js'
import { normalizeConfig } from '../lib/config.js'

const iterable = async function* (items) { yield* items }
const textChunks = (text) => [{ type: 'text-delta', index: 0, text }, { type: 'finish', reason: { kind: 'stop' } }]
const approve = JSON.stringify({ decision: 'approve', segments: [{ partIds: [0], kind: 'observation', evidence: [{ callId: 'check', quote: 'True' }] }] })
const packet = {
  requests: ['检查目标文件是否存在。'], draft: '目标文件存在。',
  evidence: [{ id: 'check', name: 'pwsh', args: {}, callIndex: 0, resultIndex: 1, state: 'completed', resultText: 'True', turn: 1 }],
  evidenceContext: { currentTurn: 1, currentCalls: 1, historicalCalls: 0, omittedCalls: 0, truncatedCalls: 0, complete: true },
}
const cfg = (extra = {}) => normalizeConfig({ reviewTimeoutMs: 2000, factored: false, ...extra })


{
  let seen
  const decision = await reviewPacket(packet, {}, { stream: (r) => { seen = r; return iterable(textChunks(approve)) } }, cfg())
  assert.equal(decision.approved, true)
  assert.equal(seen.reasoningEffort, 'off', `默认应显式传 off，实际 ${seen.reasoningEffort}`)
  assert.equal(seen.maxTokens, 12000)
  console.log('  ✓ 默认 reviewReasoningEffort=off：审核请求带 reasoningEffort=off')
}


{
  for (const [value, expected] of [['low', 'low'], ['high', 'high'], ['max', 'max']]) {
    let seen
    await reviewPacket(packet, {}, { stream: (r) => { seen = r; return iterable(textChunks(approve)) } }, cfg({ reviewReasoningEffort: value }))
    assert.equal(seen.reasoningEffort, expected, `${value} 应透传`)
  }
  let seen
  await reviewPacket(packet, {}, { stream: (r) => { seen = r; return iterable(textChunks(approve)) } }, cfg({ reviewReasoningEffort: 'default' }))
  assert.equal('reasoningEffort' in seen, false, "'default' 不应传该字段")
  assert.equal(normalizeConfig({ reviewReasoningEffort: 'bogus' }).reviewReasoningEffort, 'off', '非法值回退默认 off')
  console.log('  ✓ low/high/max 透传；default 不传字段；非法值回退 off')
}


{
  const seen = []
  let attempts = 0
  const decision = await reviewPacket(packet, {}, {
    stream: (r) => {
      attempts++
      seen.push(r)
      if (attempts === 1) {
        const error = new Error('provider does not support reasoning effort "off"')
        error.code = 'UNSUPPORTED_REASONING_EFFORT'
        throw error
      }
      return iterable(textChunks(approve))
    },
  }, cfg())
  assert.equal(decision.approved, true, '回退后应完成审核并放行')
  assert.equal(attempts, 2, `应重试一次，实际 ${attempts}`)
  assert.equal(seen[0].reasoningEffort, 'off')
  assert.equal('reasoningEffort' in seen[1], false, '回退请求不应再带 reasoningEffort')
  console.log('  ✓ UNSUPPORTED_REASONING_EFFORT → 去掉字段重试一次并完成审核')
}


{
  const seen = []
  let attempts = 0
  const decision = await reviewPacket(packet, {}, {
    stream: (r) => {
      attempts++
      seen.push(r)
      if (attempts === 1) return iterable([{ type: 'finish', reason: { kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT' } } }])
      return iterable(textChunks(approve))
    },
  }, cfg())
  assert.equal(decision.approved, true, '宿主 finish=error 形态也必须回退后完成审核')
  assert.equal(attempts, 2)
  assert.equal('reasoningEffort' in seen[1], false)
  console.log('  ✓ 宿主 finish=error（UNSUPPORTED_REASONING_EFFORT）→ 去掉字段重试并完成审核')
}


{
  const seen = []
  let attempts = 0
  const decision = await reviewPacket(packet, {}, {
    stream: (r) => {
      attempts++
      seen.push(r)
      if (attempts === 1) return iterable([{ type: 'finish', reason: { kind: 'max-tokens' } }])
      return iterable(textChunks(approve))
    },
  }, cfg())
  assert.equal(decision.approved, true)
  assert.equal(attempts, 2, `应重试，实际 ${attempts}`)
  assert.equal(seen[1].maxTokens, 24000, '重试应提高输出预算')
  assert.equal(seen[1].reasoningEffort, 'off', '重试仍应显式 off')
  console.log('  ✓ max-tokens 重试：maxTokens=24000 且 reasoningEffort 仍为 off')
}


{
  const c = normalizeConfig({})
  assert.equal(c.reviewReasoningEffort, 'off')
  assert.equal(c.reviewMaxChars, 120000)
  console.log('  ✓ 默认配置：reviewReasoningEffort=off，reviewMaxChars=120000')
}

console.log('review-effort.test OK：默认 off / 可配置 / 不支持时回退 / max-tokens 重试仍 off 全部符合预期')
