import assert from 'node:assert/strict'
import { createCompletionGuard, reviewDraft, planReviewChunks, toolOnlyChunks } from '../lib/completion.js'
import { normalizeConfig } from '../lib/config.js'

const cfg = normalizeConfig({ factored: false, guardLiveMutation: false, reviewTimeoutMs: 100 })
const messages = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '检查文件。' }] }]
const events = (turn, id) => [
  { type: 'tool/call', data: { turn, callId: id, name: 'read', arguments: '{}' } },
  { type: 'tool/result', data: { turn, message: { toolCallId: id, content: [{ type: 'text', text: 'True' }] } } },
]
const text = (value) => [{ type: 'text-delta', index: 0, text: value }, { type: 'finish', reason: { kind: 'stop' } }]
const iterable = async function* (chunks) { yield* chunks }
const collect = async (stream) => { const chunks = []; for await (const c of stream) chunks.push(c); return chunks }
const approve = (r) => JSON.stringify({ decision: 'approve', segments: [{
  partIds: JSON.parse(r.messages[1].content[0].text).draftParts.map((p) => p.id),
  kind: 'observation', evidence: [{ callId: 'current', quote: 'True' }],
}] })

// Missing context cannot improve by paying for another review with LESS evidence.
for (const code of ['EVIDENCE_CONTEXT_LIMIT', 'REVIEW_TIMEOUT']) {
  let calls = 0
  const out = await reviewDraft(events(0, 'history'), 1, messages, '文件存在。', {}, { stream() {
    calls++
    return iterable(code === 'REVIEW_TIMEOUT' ? [{ type: 'finish', reason: { kind: 'error', failure: { code } } }]
      : text(JSON.stringify({ decision: 'unavailable', issues: ['missing record'] })))
  } }, cfg)
  assert.equal(calls, 1)
  assert.equal(out.decision.failure.code, code)
}

// Capability fallback persists through JSON repair, compact fallback and across
// segments, but must not leak to the next independent model/request.
for (const failure of ['throw', 'finish']) {
  const requests = [], attempts = []
  let generated = 0
  const out = await reviewDraft(events(1, 'current'), 1, messages, '文件存在。', {}, { stream(r) {
    requests.push(r)
    if ('reasoningEffort' in r) {
      if (failure === 'throw') throw Object.assign(Error('unsupported'), { code: 'UNSUPPORTED_REASONING_EFFORT' })
      return iterable([{ type: 'finish', reason: { kind: 'error', failure: { code: 'UNSUPPORTED_REASONING_EFFORT' } } }])
    }
    const value = ++generated < 3 ? 'invalid JSON' : '{"decision":"verify","issues":["missing functional test"]}'
    return iterable([{ type: 'usage', usage: { inputTokens: 10, outputTokens: 2, privateText: 'DO-NOT-LOG' } }, ...text(value)])
  } }, cfg, (attempt) => attempts.push(attempt))
  assert.equal(out.decision.approved, false)
  assert.equal(out.decision.failure, undefined, 'semantic rejection must still reach the author')
  assert.equal(requests.length, 4, 'unsupported effort is attempted only once, not once per repair stage')
  assert.ok(requests.every((r) => r.signal.aborted), 'each attempt is cleaned up')
  assert.deepEqual(attempts.map((a) => a.attempt), [1, 2, 3, 4])
  assert.equal(attempts[0].usage, undefined, 'missing usage is unknown')
  assert.equal(attempts.reduce((sum, a) => sum + (a.usage?.inputTokens ?? 0), 0), 30)
  assert.ok(!JSON.stringify(attempts).includes('DO-NOT-LOG'))
}
{
  let supportedRequests = 0
  const draft = ('文件存在。'.repeat(100) + '\n').repeat(20)
  const small = { ...cfg, reviewMaxChars: 8000 }
  let calls = 0
  const out = await reviewDraft(events(1, 'current'), 1, messages, draft, {}, { stream(r) {
    calls++
    if ('reasoningEffort' in r) { supportedRequests++; throw Object.assign(Error('unsupported'), { code: 'UNSUPPORTED_REASONING_EFFORT' }) }
    return iterable(text(approve(r)))
  } }, small)
  assert.equal(out.decision.approved, true)
  assert.equal(supportedRequests, 1)
  assert.equal(calls, planReviewChunks(draft, 8000).length + 1)
  await reviewDraft(events(1, 'current'), 1, messages, '文件存在。', {}, { stream(r) {
    assert.equal(r.reasoningEffort, 'off', 'next review does not inherit another model capability')
    return iterable(text(approve(r)))
  } }, cfg, () => { throw Error('logger must not affect verification') })
}
// Cancellation also disposes attempts, without starting repair calls.
{
  const controller = new AbortController(), attempts = []
  let calls = 0
  const pending = reviewDraft(events(1, 'current'), 1, messages, '文件存在。', { signal: controller.signal }, {
    stream: async function* () { calls++; await new Promise(() => {}) },
  }, cfg, (a) => attempts.push(a))
  controller.abort()
  await assert.rejects(pending)
  assert.equal(calls, 1)
  assert.equal(attempts.length, 1)
}

const toolChunks = (names) => {
  const body = names.flatMap((name, index) => {
    const block = { type: 'tool-call', id: `call-${index}`, name, arguments: '{"reviewId":"invented"}' }
    return [{ type: 'block-start', index, blockType: 'tool-call' }, { type: 'tool-call-delta', index, id: block.id, name, argumentsDelta: block.arguments }, { type: 'block-end', index, block }]
  })
  return [...body, { type: 'finish', reason: { kind: 'tool-calls' }, replayState: {
    response: { kind: 'deepseek-messages', version: 1 }, blocks: names.map(() => ({ type: 'tool-call' })),
  } }]
}
{
  const handlers = new Map(), signal = new AbortController().signal
  const agent = { id: 'cost-fixture', session: { id: 'cost-fixture', snapshotEvents: () => [] } }
  let reviewerCalls = 0
  const guard = createCompletionGuard(() => cfg)
  const installed = guard.install({ tools: { get: () => guard.reviewTool }, on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name) } }, {
    stream() { reviewerCalls++; return iterable(text('{"decision":"verify","issues":["missing check"]}')) },
  })
  const assembly = Object.freeze({ tools: Object.freeze([{ name: 'read' }, { name: 'doubt_review' }]), sections: ['unchanged'] })
  const filtered = await handlers.get('system-prompt/assemble')(assembly, {}, async () => assembly)
  assert.deepEqual(filtered.tools.map((t) => t.name), ['read'])
  assert.equal(assembly.tools.length, 2, 'do not mutate shared/frozen host assembly')
  assert.equal(filtered.sections, assembly.sections)
  const request = { sessionId: agent.id, signal, messages, tools: [{ name: 'read' }] }
  await handlers.get('agent/request')({ agent, turn: 1, signal }, async () => ({}))
  const invalid = await collect(handlers.get('llm/stream')(request, () => iterable(toolChunks(['doubt_review']))))
  assert.equal(invalid.at(-1).reason.kind, 'stop', 'a model-authored receipt must not cause another agent step')
  assert.equal(invalid.some((c) => c.type === 'tool-call-delta'), false)
  assert.match(invalid.find((c) => c.type === 'text-delta').text, /尚未完成验证/)
  assert.equal(guard.failedTurn(agent, 1), true, 'legacy loop must not restart the stopped cycle')
  assert.equal(reviewerCalls, 0)
  await handlers.get('agent/request')({ agent, turn: 2, signal }, async () => ({}))
  const mixed = await collect(handlers.get('llm/stream')(request, () => iterable(toolChunks(['doubt_review', 'read']))))
  assert.deepEqual(mixed.filter((c) => c.type === 'block-end').map((c) => c.block.name), ['read'])
  assert.equal(mixed.at(-1).reason.kind, 'tool-calls', 'real work must continue')
  assert.deepEqual(mixed.at(-1).replayState.blocks, [{ type: 'tool-call' }])
  const original = toolChunks(['read'])
  assert.deepEqual(toolOnlyChunks(original, ['doubt_review']), original)
  // Legal receipts still work even though the model cannot see the tool schema.
  const rejected = await collect(handlers.get('llm/stream')(request, () => iterable(text('文件存在。'))))
  const receipt = rejected.find((c) => c.type === 'block-end').block
  assert.equal(receipt.name, 'doubt_review')
  assert.equal((await guard.reviewTool.execute(JSON.parse(receipt.arguments), { agent })).status, 'verification-required')
  installed.dispose()
  assert.equal(handlers.size, 0)
}

// Registration alone does not imply execution permission: in PTC mode the host
// admits only run_code as a direct call, while get() still resolves inner tools.
{
  const handlers = new Map(), signal = new AbortController().signal
  const agent = { id: 'restricted', session: { id: 'restricted', snapshotEvents: () => events(1, 'current') } }
  const guard = createCompletionGuard(() => ({ ...cfg, reviewNotice: 'banner' }))
  const installation = guard.install({ tools: {
    get: () => guard.reviewTool,
    resolveExecution(name, scope, nested) {
      assert.equal(name, 'doubt_review'); assert.equal(scope, agent); assert.equal(nested, false)
      return undefined
    },
  }, on(name, fn) { handlers.set(name, fn); return () => handlers.delete(name) } }, {
    stream: () => iterable(text('{"decision":"verify","issues":["missing functional check"]}')),
  })
  await handlers.get('agent/request')({ agent, turn: 1, signal }, async () => ({}))
  const out = await collect(handlers.get('llm/stream')({ sessionId: agent.id, signal, messages, tools: [{ name: 'run_code' }] },
    () => iterable(text('文件存在。'))))
  assert.equal(out.some((c) => c.type === 'tool-call-delta'), false, 'never emit a receipt that the host cannot execute')
  assert.match(out.filter((c) => c.type === 'text-delta').map((c) => c.text).join(''), /缺少自动补查工具/)
  assert.equal(guard.failedTurn(agent, 1), true)
  installation.dispose()
}
// The last malformed fallback must be logged as failed, even if the provider
// completed transport normally. Otherwise usage diagnostics look successful.
{
  const attempts = []
  const out = await reviewDraft(events(1, 'current'), 1, messages, '文件存在。', {}, {
    stream: () => iterable(text('invalid JSON')),
  }, cfg, (a) => attempts.push(a))
  assert.equal(out.decision.failure.code, 'INVALID_REVIEW')
  assert.equal(attempts.length, 3)
  assert.equal(attempts.at(-1).failureCode, 'INVALID_REVIEW')
}
console.log('token-budget.test OK: private receipts, bounded misuse, mixed tools/replay, evidence gaps, capability retries, metering, cancellation, execution permissions')
