// 分段审核切段逻辑的纯单元测试：文本零丢失、partIds 覆盖有序、段数有界
import assert from 'node:assert/strict'
import { planReviewChunks, draftParts } from '../lib/completion.js'

const draft = Array.from({ length: 120 }, (_, i) => `第${i}行：这是一段用于测试分段审核的正文，包含符号 ${i}%$#。`).join('\n')

for (const maxChars of [2000, 8000, 48000, 80000]) {
  const chunks = planReviewChunks(draft, maxChars)
  // 1) 拼接必须与原文完全一致（不能丢字、不能重复）
  assert.equal(chunks.map((c) => c.text).join(''), draft, `分段拼接必须等于原文（maxChars=${maxChars}）`)
  // 2) partIds 连续、有序、完整覆盖
  const parts = draftParts(draft)
  assert.deepEqual(chunks.flatMap((c) => c.partIds), parts.map((p) => p.id), `partIds 必须覆盖全部且有序（maxChars=${maxChars}）`)
  // 3) 段数有界
  assert.ok(chunks.length <= 6, `段数必须有界（maxChars=${maxChars}，实际 ${chunks.length}）`)
  // 4) 非末段长度受目标上限约束（单元本身最长 500 字符，留余量）
  const target = Math.max(2000, Math.floor(maxChars * 0.55))
  for (let i = 0; i < chunks.length - 1; i++) {
    assert.ok(chunks[i].text.length <= target + 600, `第 ${i} 段长度 ${chunks[i].text.length} 超过目标 ${target}`)
  }
}

// 5) 短草稿只切一段
assert.equal(planReviewChunks('很短的回答。', 48000).length, 1, '短草稿应为单段')

// 6) maxChunks 生效
const many = planReviewChunks('x'.repeat(50000), 1000, 3)
assert.ok(many.length <= 3, `段数不得超过 maxChunks，实际 ${many.length}`)
assert.equal(many.map((c) => c.text).join(''), 'x'.repeat(50000), '超长草稿也必须零丢失')

// 7) 空草稿不产生段
assert.equal(planReviewChunks('', 48000).length, 0, '空草稿不应产生段')

console.log('segments.test OK：文本零丢失 / partIds 覆盖有序 / 段数有界 / 短草稿单段 / 空草稿零段')
