/** Real DSH AgentLoop, session log, tools and filesystem. Scripted author/reviewer
 * deliberately attempts an unsupported completion, then obeys the receipt.
 * The app directory is auto-detected (scripts/host-app.mjs). When no install is present
 * this suite SKIPs with exit 0 instead of pretending to have run.
 * This tests automatic recovery in the host, not model accuracy or the desktop UI.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { HOST_HINT, resolveHostApp } from '../scripts/host-app.mjs'
const app = resolveHostApp()
const live = process.argv.includes('--live')
const reviewerError = process.argv.includes('--reviewer-error')
const history = process.argv.includes('--history')
const exhausted = process.argv.includes('--exhausted')
if ([live, reviewerError, history, exhausted].filter(Boolean).length > 1) throw Error('Choose only one scenario flag')
if (!app) {
  console.log(`SKIP host-loop.test: no installed DSH app found (${HOST_HINT})`)
  process.exit(0)
}
if (!process.argv.includes('--worker')) {
  const r = spawnSync(join(app, 'DeepSeek Harness.exe'), [fileURLToPath(import.meta.url), '--worker', ...process.argv.slice(2)], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8', timeout: live ? 180000 : 30000 })
  process.stdout.write(r.stdout ?? ''); process.stderr.write(r.stderr ?? '')
  if (r.error) console.error(r.error.message)
  process.exit(r.status ?? 1)
}
const load = (name) => import(pathToFileURL(join(app, 'resources/app.asar/dsh/node_modules/@deepseek-ai', name, 'lib/index.js')).href)
const { Context } = await load('cordis')
const { LlmRuntime, LlmAdapter } = await load('dsh-llm')
const { ToolRuntime } = await load('dsh-tools')
const { AgentRegistry } = await load('dsh-agent')
const { AgentLoop } = await load('dsh-agent-loop')
const { SessionStore } = await load('dsh-session')
const { SessionProjectionRegistry } = await load('dsh-session-projection')
const { SystemPrompt } = await load('dsh-system-prompt')
const pluginAt = process.argv.indexOf('--plugin')
const plugin = pluginAt < 0 ? new URL('../lib/index.js', import.meta.url).href : pathToFileURL(join(resolve(process.argv[pluginAt + 1]), 'lib/index.js')).href
const { apply, version } = await import(plugin)
assert.equal(version, JSON.parse(readFileSync(new URL('../package.json', plugin), 'utf8')).version)
const { NetProbe } = await import(new URL('./network.js', plugin).href)
const model = process.argv[process.argv.indexOf('--model') + 1]
const accountHome = process.argv[process.argv.indexOf('--account-home') + 1]
if (live && (!process.argv.includes('--model') || !process.argv.includes('--account-home'))) throw Error('Live mode requires explicit --model and --account-home')
const adapter = live ? await (await import('../eval/live-adapter.mjs')).liveAdapter(app, accountHome) : null
const dir = mkdtempSync(join(tmpdir(), 'dsh doubt loop ')), file = join(dir, 'config.json')
writeFileSync(file, '{"port":9000}')
const ctx = new Context(), errors = [], frames = []
let legacyProbes = 0, factoredStarts = 0
const originalProbe = NetProbe.prototype.state
if (exhausted) {
  NetProbe.prototype.state = async function () { legacyProbes++; return { online: false, probedAt: Date.now(), latencyMs: 0 } }
  ctx.provide('subagents', { async start() { factoredStarts++; return { result: Promise.resolve({ output: [{ type: 'text', text: 'unverified' }] }), async dispose() {} } } })
}
ctx.on('agent/error', ({ error }) => errors.push(error.message), { global: true })
ctx.on('agent/assistant-stream', ({ frame }) => frames.push(frame), { global: true })
new SystemPrompt(ctx, {})
new SessionStore(ctx); new SessionProjectionRegistry(ctx); new AgentRegistry(ctx)
const llm = new LlmRuntime(ctx)
let tools, loop
ctx.inject(['systemPrompt'], (c) => { tools = new ToolRuntime(c) })
ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
ctx.inject(['agentLoop'], (c) => { loop = c.agentLoop })
apply(ctx, { factored: exhausted, requireProvenance: false, maxRounds: exhausted ? 2 : 0, minAnswerChars: 1, minScore: 0, operationMaxRounds: 2, reviewNotice: 'banner' })
await new Promise((r) => setTimeout(r, 20))
assert.ok(loop); assert.ok(tools)
for (const name of ['fixture_write', 'fixture_read']) tools.register({ name,
  description: name === 'fixture_write' ? 'Set fixture port to 8080' : 'Read fixture configuration',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: { schema: { type: 'string' }, render: (_a, value) => [{ type: 'text', text: value }] },
  async execute() { if (name === 'fixture_read') return readFileSync(file, 'utf8'); writeFileSync(file, '{"port":8080}'); return 'saved' },
})
function* thinkingChunks() { yield { type: 'block-start', index: 0, blockType: 'reasoning' }; yield { type: 'reasoning-delta', index: 0, text: 'Synthetic fault-injection fixture.' }; yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'Synthetic fault-injection fixture.' } } }
function* textChunks(text, reasoning = false) { if (reasoning) yield* thinkingChunks(); const index = reasoning ? 1 : 0; yield { type: 'block-start', index, blockType: 'text' }; yield { type: 'text-delta', index, text }; yield { type: 'block-end', index, block: { type: 'text', text } }; yield { type: 'finish', reason: { kind: 'stop' } } }
const premature = '重要：系统记录显示电脑其实没有重启过。'
function* callChunks(id, name) {
  yield* thinkingChunks()
  yield { type: 'block-start', index: 1, blockType: 'text' }
  yield { type: 'text-delta', index: 1, text: premature }
  yield { type: 'block-end', index: 1, block: { type: 'text', text: premature } }
  const index = 2, block = { type: 'tool-call', id, name, arguments: '{}' }
  yield { type: 'block-start', index, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index, id, name, argumentsDelta: '{}' }
  yield { type: 'block-end', index, block }
  yield { type: 'finish', reason: { kind: 'tool-calls' }, replayState: { response: { kind: 'deepseek-messages', version: 1, model: live ? model : 'fixture-model' }, blocks: [{ type: 'reasoning' }, { type: 'text' }, { type: 'tool-call' }] } }
}
let authorCalls = 0, reviews = 0
const bad = '配置已修复，全部验证通过。', good = 'port 已写为 8080，写入后回读确认值为 8080。'
const historical = '上一轮写入后的回读记录显示 port 为 8080。'
class Fixture extends LlmAdapter {
  async *stream(request) {
    if (request.sessionId) {
      const phase = authorCalls++
      if (phase === 0) { yield* callChunks('edit', 'fixture_write'); return }
      if (history) {
        if (phase === 1) { yield* callChunks('check', 'fixture_read'); return }
        if (phase === 2) { yield* textChunks(good); return }
        assert.equal(phase, 3, 'historical confirmation must not repeat commands')
        assert.equal(request.messages.filter((m) => m.role === 'user').length, 1)
        assert.ok(!JSON.stringify(request.messages).includes('fixture_write'), 'simulate compacted wire context with historical tool messages absent')
        assert.ok(!JSON.stringify(request.messages).includes('8080'), 'wire context must not carry the first human request or prior answer')
        yield* textChunks(historical); return
      }
      if (exhausted) {
        assert.ok(phase <= 3, 'terminal notice must not restart the author through idle followup')
        if (phase > 1) assert.ok(JSON.stringify(request.messages).includes('verification-required'))
        yield* textChunks(bad, true); return
      }
      if (phase === 1) { yield* textChunks(bad, true); return }
      if (live) {
        assert.ok(phase < 8, 'bound live recovery cost')
        yield* adapter.stream({ ...request, provider: 'deepseek-account', model }); return
      }
      if (phase === 2) {
        assert.ok(JSON.stringify(request.messages).includes('verification-required'), 'host feeds the receipt back automatically')
        yield* callChunks('check', 'fixture_read'); return
      }
      assert.equal(phase, 3, 'exactly one autonomous recovery')
      yield* textChunks(good); return
    }
    reviews++
    if (reviewerError) { yield { type: 'finish', reason: { kind: 'error', failure: { code: 'SERVER', message: 'fixture provider failure' } } }; return }
    if (live) { yield* adapter.stream({ ...request, provider: 'deepseek-account', model }); return }
    const packet = JSON.parse(request.messages[1].content[0].text)
    assert.ok(Array.isArray(packet.draftParts)); assert.equal(packet.draft, undefined, 'draft must only be sent once as numbered parts')
    const draft = packet.draftParts.map((part) => part.text).join('')
    assert.ok(packet.requests.some((s) => s.includes('8080')), 'real user source reaches reviewer')
    if (exhausted) {
      yield* textChunks(JSON.stringify({ decision: 'verify', issues: ['配置文件 E:\\fixture\\config.yaml 缺少独立回读。pwsh 没有返回验证结果，不能确认设置成功。'] }))
      return
    }
    const checked = packet.evidence.find((e) => e.id === 'check')
    if (history && reviews === 2) {
      assert.equal(draft, historical)
      assert.equal(packet.requests.at(-1), '继续')
      assert.equal(packet.evidenceContext.currentTurn, 2)
      assert.equal(packet.evidenceContext.currentCalls, 0)
      assert.equal(packet.evidenceContext.historicalCalls, 2)
      assert.equal(packet.evidenceContext.complete, true)
      assert.deepEqual(packet.evidence.map((e) => [e.id, e.turn]), [['edit', 1], ['check', 1]])
      assert.equal(checked.resultText, '{"port":8080}')
    }
    const response = checked ? { decision: 'approve', segments: [{ partIds: packet.draftParts.map((p) => p.id), kind: history && reviews === 2 ? 'observation' : 'postcondition', actionIds: ['edit'], evidence: [{ callId: 'check', quote: '{"port":8080}' }] }] }
      : { decision: 'verify', issues: ['写入回执不能替代写入后的独立回读。'] }
    yield* textChunks(JSON.stringify(response))
  }
}
llm.registerAdapter(['fixture'], new Fixture())
try {
  const agent = await loop.create('doubt-loop-fixture', { provider: 'fixture', model: live ? model : 'fixture-model' }, { cwd: dir })
  let followups = 0
  const followup = agent.followup.bind(agent)
  agent.followup = (...args) => { followups++; return followup(...args) }
  agent.followup({ id: 'human', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '把配置 port 设置为 8080，并回读确认。' }] })
  await agent.whenIdle()
  if (history) {
    // Real durable host events remain intact; only the model-facing request
    // projection loses history, as after a summary-only compaction. This tests
    // the guard's provenance source without pretending to run the compactor.
    const deriveMessages = agent.session.deriveMessages.bind(agent.session)
    agent.session.deriveMessages = () => deriveMessages().filter((m) => m.id === 'human-followup')
    agent.followup({ id: 'human-followup', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] })
    await agent.whenIdle()
    agent.session.deriveMessages = deriveMessages
  }
  if (exhausted) await new Promise((r) => setTimeout(r, 350)) // Legacy idle callback is scheduled after 150 ms.
  if (live) { mkdirSync('eval/out', { recursive: true }); writeFileSync('eval/out/loop-live.json', JSON.stringify({ model, authorCalls, reviews, errors, events: agent.session.snapshotEvents() }, null, 2)) }
  assert.deepEqual(errors, [])
  const events = agent.session.snapshotEvents()
  const messages = events.filter((e) => e.type === 'assistant/message').map((e) => e.data.message)
  // In-budget rejections never reach the surface; the terminal fallback releases the
  // draft with an explicit "unreviewed" banner instead of swallowing it.
  if (!exhausted && !reviewerError) assert.ok(!JSON.stringify(messages).includes(bad), 'in-budget rejection must not enter the session surface')
  assert.ok(!JSON.stringify(messages).includes(premature), 'tool-stage diagnosis must not enter session')
  assert.ok(frames.length > 0, 'actual UI stream frames were observed')
  assert.ok(!JSON.stringify(frames).includes(premature), 'tool-stage diagnosis must not reach UI stream')
  const final = messages.at(-1).content.filter((c) => c.type === 'text').map((c) => c.text).join('')
  if (reviewerError) {
    assert.match(final, /审核服务未完成（SERVER）/)
    assert.ok(final.includes(historical || bad) || final.length > 20, 'reviewer failure releases the draft with a banner')
    assert.equal(authorCalls, 2); assert.equal(reviews, 1)
    assert.deepEqual(events.filter((e) => e.type === 'tool/call').map((e) => e.data.name), ['fixture_write'], 'no spurious author retry')
    console.log('host-loop.test PASS: reviewer SERVER failure stayed distinct from task failure; no retry commands; draft released with an unreviewed banner')
  } else if (exhausted) {
    assert.match(final, /未经完整审核/)
    assert.match(final, /自动补查预算已用尽/)
    assert.equal(authorCalls, 4); assert.equal(reviews, 3)
    assert.deepEqual(events.filter((e) => e.type === 'tool/call').map((e) => e.data.name), ['fixture_write', 'doubt_review', 'doubt_review'])
    assert.equal(legacyProbes, 0, 'terminal plugin output must not trigger legacy network probing')
    assert.equal(factoredStarts, 0, 'terminal plugin output must not create factored subagents')
    assert.equal(followups, 1, 'only the real human followup may enter the agent')
    assert.equal(events.filter((e) => e.type === 'turn/start').length, 1)
    console.log('host-loop.test PASS: two bounded evidence retries ended once; terminal notice caused no legacy probe, factored child, or followup')
  } else if (history) {
    assert.equal(final, historical)
    assert.equal(authorCalls, 4); assert.equal(reviews, 2); assert.equal(followups, 2)
    assert.deepEqual(events.filter((e) => e.type === 'tool/call').map((e) => [e.data.name, e.data.turn]), [['fixture_write', 1], ['fixture_read', 1]])
    assert.equal(events.filter((e) => e.type === 'turn/start').length, 2)
    console.log('host-loop.test PASS: second human turn reused real first-turn write/read evidence despite a wire request with no history; no duplicate operation or receipt')
  } else {
  assert.ok(final.includes(live ? '8080' : good), 'verified final answer must reach the actual session')
  assert.ok(!final.includes('[dsh-doubt]'), 'exhausted fallback is not a successful recovery')
  assert.deepEqual(events.filter((e) => e.type === 'tool/call').map((e) => e.data.name), ['fixture_write', 'doubt_review', 'fixture_read'])
  assert.ok(reviews >= 2)
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).port, 8080)
  console.log(`host-loop.test PASS: real AgentLoop automatically executed receipt, read actual file after write, and completed without a second human message (${live ? 'fault-injected draft; live reviewer and live author recovery' : 'scripted models'})`)
  if (live) console.log(JSON.stringify({ model, authorCalls, reviews, final }))
  }
} finally { NetProbe.prototype.state = originalProbe; await ctx.fiber.dispose(); rmSync(dir, { recursive: true, force: true }) }
