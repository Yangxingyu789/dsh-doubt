import assert from 'node:assert/strict'
import { toolTrace } from '../lib/operations.js'
import { createCompletionGuard, validateReview, reviewPacket, REVIEW_TOOL, draftParts, buildReviewPacket, reviewPayload } from '../lib/completion.js'
import { normalizeConfig } from '../lib/config.js'
const call = (id, name, args = {}) => ({ type: 'tool/call', data: { turn: 1, callId: id, name, arguments: JSON.stringify(args) } })
const result = (id, text, extra = {}) => ({ type: 'tool/result', surfaceOp: 'append', data: { turn: 1, message: { toolCallId: id, source: { callId: id }, content: [{ type: 'text', text }], ...extra } } })
const textChunks = (text) => [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: 'stop' }, replayState: { response: 'original-only' } }]
const iterable = async function* (items) { yield* items }
const collect = async (stream) => { const out = []; for await (const c of stream) out.push(c); return out }
const visible = (chunks) => chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join('')
const approval = (text, evidence = [], kind = 'observation', actionIds) => ({ decision: 'approve', segments: [{ text, kind, evidence, actionIds }] })
const refs = [{ callId: 'check', quote: 'True' }]
const events = [call('edit', 'edit'), result('edit', 'saved'), call('check', 'pwsh', { command: 'Test-Path target.ini' }), result('check', 'True')]
const packet = { requests: ['检查目标文件是否存在。'], draft: '目标文件存在。', evidence: toolTrace(events, 1) }
assert.equal(validateReview(approval(packet.draft, refs), packet).approved, true)
assert.equal(validateReview(approval(packet.draft, refs, 'postcondition', ['edit']), packet).approved, true)
for (const bad of [approval('目标文件', refs), approval(packet.draft, [{ callId: 'invented', quote: 'True' }]), approval(packet.draft, [{ callId: 'check', quote: 'function works' }]), approval(packet.draft, refs, 'postcondition', ['check']), approval(packet.draft, [], 'unverified')]) {
  assert.equal(validateReview(bad, packet).approved, false, 'no omitted text, forged source, invented quote, self-certification or concealed uncertainty')
}
const stale = { ...packet, evidence: toolTrace([call('check', 'read'), result('check', 'True'), call('edit', 'edit'), result('edit', 'saved')], 1) }
assert.equal(validateReview(approval(stale.draft, refs, 'postcondition', ['edit']), stale).approved, false)
for (const body of ['[exit code: 1]', '[timed out after 1000ms]', '{"failed":1,"results":[{"ok":false}]}', '[still running after 1000ms; moved to background job x]']) {
  assert.equal(validateReview(approval(packet.draft, [{ callId: 'check', quote: body }], 'postcondition', ['edit']), { ...packet, evidence: toolTrace([call('edit', 'edit'), result('edit', 'saved'), call('check', 'bash'), result('check', body)], 1) }).approved, false)
}
const failurePacket = { ...packet, draft: '检查返回 Access denied，尚无法确认修复结果。', evidence: toolTrace([call('check', 'pwsh'), result('check', 'Access denied', { isError: true })], 1) }
assert.equal(validateReview(approval(failurePacket.draft, [{ callId: 'check', quote: 'Access denied' }]), failurePacket).approved, true, 'failure output can support an honest failure report')
assert.deepEqual(toolTrace([call('a', 'read'), call('b', 'read'), result('b', 'error', { isError: true }), result('a', 'True')], 1).map((c) => c.state), ['completed', 'failed'])

function harness({ review, config = {}, trace = events, draft = packet.draft } = {}) {
  const handlers = new Map(), cfg = normalizeConfig({ factored: false, reviewTimeoutMs: 200, ...config }), controller = new AbortController()
  const agent = { id: 's1', session: { id: 's1', snapshotEvents: () => trace } }
  const guard = createCompletionGuard(() => cfg)
  const installed = guard.install({ on: (name, h) => { handlers.set(name, h); return () => handlers.delete(name) } }, { stream: review })
  const request = { provider: 'fixture', model: 'fixture-model', sessionId: 's1', signal: controller.signal, messages: [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '修复 WPS 并验收。' }] }], tools: [{ name: REVIEW_TOOL }] }
  return { guard, installed, request, controller, agent, handlers, cfg,
    async run(text = draft, turn = 1) {
      await handlers.get('agent/request')({ agent, turn, signal: controller.signal }, async () => ({ provider: 'fixture', model: 'fixture-model' }))
      return handlers.get('llm/stream')(request, () => iterable(textChunks(text)))
    },
  }
}
// Controlled reviewer verifies orchestration only; semantic quality needs live eval.
for (const draft of ['卸载程序已修复 [tool:check]。', 'WPS 已修复。', '现在可以正常使用了。']) {
  const h = harness({ draft, trace: [call('check', 'pwsh', { command: 'Test-Path missing.exe' }), result('check', 'False')], review: (r) => {
    const p = JSON.parse(r.messages[1].content[0].text)
    assert.equal(p.draftParts.map((x) => x.text).join(''), draft); assert.equal(p.evidence[0].resultText, 'False'); assert.deepEqual(r.tools, [])
    return iterable(textChunks(JSON.stringify({ decision: 'verify', issues: ['文件检查为 False，不能证明功能已修复。'] })))
  } })
  const out = await collect(await h.run())
  assert.equal(visible(out), '', 'rejected draft never reaches display')
  const block = out.find((c) => c.type === 'block-end').block
  assert.equal(block.name, REVIEW_TOOL); assert.equal(out.at(-1).replayState, undefined)
  assert.equal((await h.guard.reviewTool.execute(JSON.parse(block.arguments), { agent: { id: 'other' } })).status, 'invalid')
  assert.equal((await h.guard.reviewTool.execute(JSON.parse(block.arguments), { agent: h.agent })).status, 'verification-required')
  assert.equal((await h.guard.reviewTool.execute(JSON.parse(block.arguments), { agent: h.agent })).status, 'invalid')
  h.installed.dispose()
}
let finishReview
const delayed = harness({ review: async function* () { await new Promise((r) => { finishReview = r }); yield* textChunks(JSON.stringify(approval(packet.draft, refs))) } })
const stream = (await delayed.run())[Symbol.asyncIterator]()
let emitted = false
const first = stream.next().then((r) => { emitted = true; return r })
await new Promise((r) => setTimeout(r, 15))
assert.equal(emitted, false, 'no token before reviewer completes')
finishReview(); assert.equal((await first).value.type, 'block-start')
assert.equal(visible(await collect({ [Symbol.asyncIterator]: () => stream })), packet.draft)
delayed.installed.dispose()
const denied = harness({ config: { operationMaxRounds: 1 }, review: () => iterable(textChunks('{"decision":"verify","issues":["缺少功能验收"]}')) })
assert.equal(visible(await collect(await denied.run())), '')
const exhaustedOut = visible(await collect(await denied.run()))
assert.ok(exhaustedOut.includes(packet.draft), 'terminal review never swallows the answer')
assert.match(exhaustedOut, /未经完整审核/)
assert.match(exhaustedOut, /自动补查预算已用尽/)
assert.equal(denied.guard.failedTurn(denied.agent, 1), true)
assert.equal(visible(await collect(await denied.run(packet.draft, 2))), '', 'new turn resets budget')
denied.installed.dispose()
for (const review of [() => { throw Error('synchronous adapter failure') }, () => iterable(textChunks('not json')), () => iterable([{ type: 'finish', reason: { kind: 'error' } }]), async function* () { await new Promise(() => {}) }]) {
  const h = harness({ config: { operationMaxRounds: 2, reviewTimeoutMs: 100 }, review })
  const start = Date.now()
  const output = await collect(await h.run())
  const shown = visible(output)
  assert.ok(shown.includes(packet.draft), 'reviewer failure never swallows the answer')
  assert.match(shown, /未经完整审核/)
  assert.ok(!output.some((c) => c.type === 'tool-call-delta'), 'reviewer failure must not ask author to re-execute commands')
  assert.equal(h.guard.failedTurn(h.agent, 1), true)
  assert.ok(Date.now() - start < 1500); h.installed.dispose()
}
assert.equal((await reviewPacket({ ...packet, draft: 'x'.repeat(2000) }, {}, { stream: () => { throw Error('must not call') } }, normalizeConfig({ reviewMaxChars: 1000 }))).approved, false)
const noTools = harness({ review: () => iterable(textChunks('{"decision":"verify","issues":["missing"]}')) })
noTools.request.tools = []; assert.match(visible(await collect(await noTools.run())), /缺少自动补查工具/); noTools.installed.dispose()
const cancelled = harness({ review: async function* () { await new Promise(() => {}) } })
const pending = collect(await cancelled.run()); setTimeout(() => cancelled.controller.abort(), 10)
await assert.rejects(pending); cancelled.installed.dispose()
const smalltalk = harness({ draft: '你好。', trace: [], review: () => iterable(textChunks(JSON.stringify(approval('你好。', [], 'nonfactual')))) })
assert.equal(visible(await collect(await smalltalk.run())), '你好。'); smalltalk.installed.dispose()
const fragmented = JSON.stringify(approval(packet.draft, refs))
assert.equal((await reviewPacket(packet, {}, { stream: async function* () {
  for (let i = 0; i < 10000; i++) yield { type: 'reasoning-delta', index: 0, text: 'x' }
  for (const text of fragmented) yield { type: 'text-delta', index: 1, text }
  yield { type: 'finish', reason: { kind: 'stop' } }
} }, normalizeConfig({ reviewMaxChars: 1000 }))).approved, true, 'protocol overhead/reasoning must not count as JSON response text')
const replay = harness({ review: () => iterable(textChunks('{"decision":"verify","issues":["missing check"]}')) })
await replay.run()
const nativeDraft = [
  { type: 'block-start', index: 0, blockType: 'reasoning' },
  { type: 'reasoning-delta', index: 0, text: 'fixture' },
  { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'fixture' } },
  ...textChunks('unsupported final').map((c) => c.index === undefined ? c : { ...c, index: 1 }),
]
nativeDraft.at(-1).replayState = { response: { kind: 'deepseek-messages', version: 1, model: 'fixture-model' }, blocks: [{ type: 'reasoning', signature: 'test-signature' }, { type: 'text' }] }
const preserved = await collect(replay.handlers.get('llm/stream')(replay.request, () => iterable(nativeDraft)))
assert.equal(visible(preserved), '', 'rejected visible draft is withheld')
assert.deepEqual(preserved.at(-1).replayState.blocks, [{ type: 'reasoning', signature: 'test-signature' }, { type: 'tool-call' }])
assert.equal(preserved.find((c) => c.type === 'tool-call-delta').index, 1)
nativeDraft.at(-1).replayState.response.kind = 'unknown-native-provider'
assert.match(visible(await collect(replay.handlers.get('llm/stream')(replay.request, () => iterable(nativeDraft)))), /回放协议不支持/)
replay.installed.dispose()

// Incident regressions: long draft coverage, reviewer failure isolation, and
// pre-tool assertions leaking before the final-answer guard.
const longDraft = ('甲'.repeat(1100) + '\n\n').repeat(8) + '尾\n'
const parts = draftParts(longDraft)
assert.equal(parts.map((p) => p.text).join(''), longDraft)
const indexedPacket = { requests: ['写诗'], draft: longDraft, evidence: [] }
const indexed = { decision: 'approve', segments: [{ partIds: parts.map((p) => p.id), kind: 'nonfactual', evidence: [] }] }
assert.equal(validateReview(indexed, indexedPacket).approved, true)
assert.equal(validateReview({ decision: 'approve', segments: [{ partIds: [0, 0], kind: 'nonfactual' }] }, indexedPacket).approved, false)
let attempts = 0
const retried = await reviewPacket(packet, {}, { stream: async function* (r) {
  attempts++
  if (attempts === 1) { assert.equal(r.maxTokens, 12000); yield { type: 'finish', reason: { kind: 'max-tokens' } }; return }
  assert.equal(r.maxTokens, 24000)
  yield* textChunks(JSON.stringify({ decision: 'approve', segments: [{ partIds: [0], kind: 'observation', evidence: refs }] }))
} }, normalizeConfig({}))
assert.equal(retried.approved, true); assert.equal(attempts, 2)
attempts = 0
const exhausted = await reviewPacket(packet, {}, { stream: async function* () {
  attempts++; yield { type: 'finish', reason: { kind: 'max-tokens' } }
} }, normalizeConfig({}))
assert.equal(attempts, 2); assert.equal(exhausted.failure.code, 'max-tokens')

// Regression (live INVALID_REVIEW): a formatting mistake used to be terminal.
// malformed JSON / contract violations must be retried once with the exact
// validator complaint; malformed numbering must report its shape, and a mixed
// partIds/text representation is fine when the concatenated text covers the draft.
let repairAttempts = 0
const repaired = await reviewPacket(packet, {}, { stream: async function* (r) {
  repairAttempts++
  const system = r.messages[0].content[0].text
  if (repairAttempts === 1) {
    assert.ok(!system.includes('rejected by the output validator'))
    yield* textChunks(JSON.stringify({ decision: 'approve', segments: [] }))
    return
  }
  assert.ok(system.includes('rejected by the output validator'), 'repair retry carries the validator complaint')
  assert.ok(system.includes('partIds 0..0'), 'repair retry states the exact numbering contract')
  yield* textChunks(JSON.stringify(approval(packet.draft, refs)))
} }, normalizeConfig({}))
assert.equal(repaired.approved, true); assert.equal(repairAttempts, 2)
let jsonAttempts = 0
const repairedJson = await reviewPacket(packet, {}, { stream: async function* () {
  jsonAttempts++
  if (jsonAttempts === 1) { yield* textChunks('not json'); return }
  yield* textChunks(JSON.stringify(approval(packet.draft, refs)))
} }, normalizeConfig({}))
assert.equal(repairedJson.approved, true); assert.equal(jsonAttempts, 2)
// A quote that was reflowed while copying still counts as grounded.
assert.equal(validateReview(approval(packet.draft, [{ callId: 'check', quote: 'T r u e' }]), packet).approved, true, 'whitespace-insensitive quote match')
// If the segmented contract fails twice, a bare verdict is the last resort: a formatting
// problem must never turn into a withheld answer.
let compactAttempts = 0
const compacted = await reviewPacket(packet, {}, { stream: async function* (r) {
  compactAttempts++
  const system = r.messages[0].content[0].text
  if (compactAttempts < 3) {
    assert.ok(!system.includes('FINAL ATTEMPT'))
    yield* textChunks(JSON.stringify({ decision: 'approve', segments: [] }))
    return
  }
  assert.ok(system.includes('FINAL ATTEMPT'), 'third attempt uses the bare-verdict instruction')
  yield* textChunks(JSON.stringify({ decision: 'approve' }))
} }, normalizeConfig({}))
assert.equal(compacted.approved, true); assert.equal(compactAttempts, 3)
const badIds = validateReview({ decision: 'approve', segments: [{ partIds: [0, 2], kind: 'observation', evidence: refs }] }, indexedPacket)
assert.equal(badIds.failure.code, 'INVALID_REVIEW')
assert.match(String(badIds.failure.detail), /partId/)
const mixed = validateReview({ decision: 'approve', segments: [
  { partIds: [0], text: parts[0].text, kind: 'nonfactual', evidence: [] },
  { text: parts.slice(1).map((p) => p.text).join(''), kind: 'nonfactual', evidence: [] },
] }, indexedPacket)
assert.equal(mixed.approved, true, 'mixed partIds/text is covered by the text-coverage check')
// Reviewers emit partIds as strings or comma-joined lists; that is still valid coverage.
const stringIds = validateReview({ decision: 'approve', segments: [{ partIds: parts.map((p) => String(p.id)), kind: 'nonfactual', evidence: [] }] }, indexedPacket)
assert.equal(stringIds.approved, true, 'numeric-string partIds are valid coverage')
const joinedIds = validateReview({ decision: 'approve', segments: [{ partIds: parts.map((p) => p.id).join(','), kind: 'nonfactual', evidence: [] }] }, indexedPacket)
assert.equal(joinedIds.approved, true, 'comma-joined partIds are valid coverage')
const transport = await reviewPacket(packet, {}, { stream: () => iterable([{ type: 'finish', reason: { kind: 'error', failure: { code: 'ACCOUNT_SIGN_IN_REQUIRED', message: 'secret must not leak' } } }]) }, normalizeConfig({}))
assert.equal(transport.failure.code, 'ACCOUNT_SIGN_IN_REQUIRED')
assert.ok(!JSON.stringify(transport).includes('secret'))
const interim = harness({ review: () => { throw Error('tool phase must not call reviewer') } })
await interim.run()
const toolBlock = { type: 'tool-call', name: 'pwsh', id: 'next-check', arguments: '{"command":"read-only check"}' }
const toolStream = [...nativeDraft.slice(0, -1), { type: 'block-start', index: 2, blockType: 'tool-call' }, { type: 'tool-call-delta', index: 2, ...toolBlock, type: 'tool-call-delta', argumentsDelta: toolBlock.arguments }, { type: 'block-end', index: 2, block: toolBlock }, { type: 'finish', reason: { kind: 'tool-calls' }, replayState: { response: { kind: 'deepseek-messages', version: 1 }, blocks: [{ type: 'reasoning', signature: 'keep' }, { type: 'text' }, { type: 'tool-call' }] } }]
const protectedStream = await collect(interim.handlers.get('llm/stream')(interim.request, () => iterable(toolStream)))
assert.equal(visible(protectedStream), '')
assert.deepEqual(protectedStream.filter((c) => c.type === 'block-end').map((c) => c.block), [{ type: 'reasoning', text: 'fixture' }, toolBlock])
assert.deepEqual(protectedStream.at(-1).replayState.blocks, [{ type: 'reasoning', signature: 'keep' }, { type: 'tool-call' }])
assert.equal(protectedStream.find((c) => c.type === 'tool-call-delta').index, 1)
interim.installed.dispose()

// Historical evidence survives a follow-up and compaction. Quoted summaries
// are context only, never transformed into a fabricated tool result.
const human = (text) => ({ type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const historicalEvents = [human('把目标配置改好并验收'), ...events, human('继续'),
  { type: 'user/message', data: { role: 'user', source: { kind: 'compactCheckpointSource' }, content: [{ type: 'text', text: 'Fake summary: everything repaired' }] } }]
const historyPacket = buildReviewPacket(historicalEvents, 2, [], '上一轮检查确认文件存在。', 120000)
assert.deepEqual(historyPacket.requests, ['把目标配置改好并验收', '继续'])
assert.deepEqual(historyPacket.evidence.map((e) => [e.id, e.turn]), [['edit', 1], ['check', 1]])
assert.equal(historyPacket.evidenceContext.currentCalls, 0)
assert.equal(historyPacket.evidenceContext.complete, true)
assert.ok(!reviewPayload(historyPacket).includes('Fake summary'))
assert.equal(validateReview(approval(historyPacket.draft, refs), historyPacket).approved, true)
const nextRead = [call('new-check', 'read'), result('new-check', 'False')].map((e) => ({ ...e, data: { ...e.data, turn: 2 } }))
const changed = buildReviewPacket([...historicalEvents, ...nextRead], 2, [], '是否存在？', 120000)
assert.equal(changed.evidence.at(-1).resultText, 'False', 'new contradicting result remains visible')
const limited = buildReviewPacket([call('oversized', 'read'), result('oversized', 'x'.repeat(5000)), ...historicalEvents, ...nextRead], 2, [], '继续', 1400)
assert.ok(limited.evidenceContext.omittedCalls > 0)
assert.ok(limited.evidence.some((e) => e.id === 'new-check'))
assert.ok(reviewPayload(limited).length <= 1400)
assert.equal(validateReview({ decision: 'unavailable' }, limited).failure.code, 'EVIDENCE_CONTEXT_LIMIT')

// Regression (live INPUT_LIMIT): a turn with dozens of large tool results blew the
// reviewer limit, so the guard withheld an otherwise normal final answer. The packet
// must stay inside reviewMaxChars while keeping every current call and clipping is
// explicit, never silent.
const flood = []
for (let i = 0; i < 77; i++) flood.push(call(`f${i}`, 'pwsh', { i }), result(`f${i}`, 'y'.repeat(2700)))
const floodPacket = buildReviewPacket(flood, 1, [], '检查完成。', 120000)
assert.ok(reviewPayload(floodPacket).length <= 120000, 'review packet must fit the configured limit')
assert.equal(floodPacket.evidenceContext.currentCalls, 77)
assert.equal(floodPacket.evidence.length, 77, 'no current-turn call is dropped when it can be clipped')
assert.equal(floodPacket.evidenceContext.omittedCalls, 0)
assert.ok(floodPacket.evidenceContext.truncatedCalls > 0, 'oversized results are clipped and reported')
assert.equal(floodPacket.evidenceContext.complete, false)
const clippedRecord = floodPacket.evidence.find((e) => e.truncated)
assert.match(clippedRecord.resultText, /\[dsh-doubt\] result truncated: kept \d+ of 2700 chars/, 'clipping is explicit')
assert.equal(validateReview(approval('检查完成。', [{ callId: clippedRecord.id, quote: clippedRecord.resultText.slice(0, 8) }]), floodPacket).approved, true)
const oneHuge = buildReviewPacket([call('huge', 'read'), result('huge', 'z'.repeat(400000))], 1, [], '读完了。', 120000)
assert.ok(reviewPayload(oneHuge).length <= 120000, 'one absurdly large result still fits')
assert.equal(oneHuge.evidence.length, 1); assert.ok(oneHuge.evidence[0].truncated > 0)
const noRoom = buildReviewPacket([call('a', 'pwsh'), result('a', 'ok')], 1, [], 'x'.repeat(3000), 1000)
assert.equal(noRoom.evidence.length, 0, 'an over-budget draft adds no evidence instead of overflowing')
assert.ok(noRoom.evidenceContext.omittedCalls > 0)

// History must not pad the request to the limit: the measured payloads were
// ~119.7k chars on ordinary turns, which made every review call slow enough to
// hit REVIEW_TIMEOUT and withhold the answer.
const lotsOfHistory = Array.from({ length: 120 }, (_, i) => [call(`h${i}`, 'pwsh'), result(`h${i}`, 'z'.repeat(2000))]).flat()
const capped = buildReviewPacket([...lotsOfHistory, ...nextRead], 2, [], '继续', 48000)
assert.ok(reviewPayload(capped).length <= 48000)
assert.ok(reviewPayload(capped).length < 48000 * 0.8, `history must not pad to the limit (${reviewPayload(capped).length})`)
assert.ok(capped.evidenceContext.omittedCalls > 0)
assert.ok(capped.evidence.some((e) => e.id === 'new-check'), 'current-turn evidence still wins the budget')

// A timed-out review retries once without optional history instead of eating the answer.
let timeoutAttempts = 0
const timeoutRetried = harness({
  trace: [...historicalEvents, ...nextRead],
  draft: historyPacket.draft,
  config: { reviewTimeoutMs: 150 },
  review: (r) => {
    timeoutAttempts++
    const p = JSON.parse(r.messages[1].content[0].text)
    if (timeoutAttempts === 1) {
      assert.ok(p.evidence.some((e) => e.turn === 1), 'first attempt carries historical records')
      return (async function* () { await new Promise(() => {}) })()
    }
    assert.ok(p.evidence.every((e) => e.turn === 2), 'timeout retry drops historical records')
    return iterable(textChunks(JSON.stringify(approval(historyPacket.draft, [{ callId: 'new-check', quote: 'False' }]))))
  },
})
assert.equal(visible(await collect(await timeoutRetried.run(historyPacket.draft, 2))), historyPacket.draft)
assert.equal(timeoutAttempts, 2, 'exactly one cheaper retry after a timeout')
timeoutRetried.installed.dispose()

// Regression (live max-tokens): one part per source line made long answers emit
// one JSON segment per line, so the reviewer's output budget ran out twice and the
// draft was withheld. Parts are now grouped and the retry also drops history.
const manyLines = Array.from({ length: 200 }, (_, i) => `第 ${i} 行：检查结果正常。`).join('\n')
const merged = draftParts(manyLines)
assert.equal(merged.map((p) => p.text).join(''), manyLines, 'merging keeps the exact draft')
assert.ok(merged.length <= 30, `parts must be grouped, not one per line (${merged.length})`)
assert.equal(merged.every((p, i) => p.id === i), true)
let retryAttempt = 0
const truncated = await reviewPacket(buildReviewPacket([...historicalEvents, ...nextRead], 2, [], '继续', 48000), {}, { stream: async function* (r) {
  retryAttempt++
  const p = JSON.parse(r.messages[1].content[0].text)
  if (retryAttempt === 1) {
    assert.equal(r.maxTokens, 12000)
    assert.ok(p.evidence.some((e) => e.turn === 1), 'first attempt carries historical records')
    yield { type: 'finish', reason: { kind: 'max-tokens' } }; return
  }
  assert.equal(r.maxTokens, 24000)
  assert.ok(p.evidence.every((e) => e.turn === 2), 'max-tokens retry drops historical records')
  yield* textChunks(JSON.stringify({ decision: 'approve', segments: [{ partIds: [0], kind: 'observation', evidence: [{ callId: 'new-check', quote: 'False' }] }] }))
} }, normalizeConfig({}))
assert.equal(truncated.approved, true); assert.equal(retryAttempt, 2)
const hHistory = harness({ trace: historicalEvents, draft: historyPacket.draft, review: (r) => {
  const p = JSON.parse(r.messages[1].content[0].text)
  assert.equal(p.evidenceContext.currentCalls, 0)
  assert.equal(p.evidence.find((e) => e.id === 'check').turn, 1)
  return iterable(textChunks(JSON.stringify(approval(historyPacket.draft, refs))))
} })
hHistory.request.messages = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] }]
assert.equal(visible(await collect(await hHistory.run(historyPacket.draft, 2))), historyPacket.draft)
assert.equal(hHistory.guard.reviewedTurn(hHistory.agent, 2), true)
hHistory.installed.dispose()
console.log('operations.test OK: whole-answer review, withholding, grounding, chronology, retry/timeout/cancellation (controlled reviewer)')
