/** Real installed DSH runtime, offline scripted adapter. No account/profile changes.
 * node test/host.test.mjs [--app <installed DSH dir>]
 * The app directory is auto-detected (scripts/host-app.mjs). When no install is present
 * this suite SKIPs with exit 0 instead of pretending to have run.
 * This tests host integration, NOT a real model's semantic accuracy.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { HOST_HINT, resolveHostApp } from '../scripts/host-app.mjs'
const app = resolveHostApp()
if (!app) {
  console.log(`SKIP host.test: no installed DSH app found (${HOST_HINT})`)
  process.exit(0)
}
if (!process.argv.includes('--worker')) {
  const child = spawnSync(join(app, 'DeepSeek Harness.exe'), [fileURLToPath(import.meta.url), '--worker', ...process.argv.slice(2)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, encoding: 'utf8', timeout: 30000,
  })
  process.stdout.write(child.stdout ?? ''); process.stderr.write(child.stderr ?? '')
  if (child.error) console.error(child.error.message)
  process.exit(child.status ?? 1)
}
const load = (name) => import(pathToFileURL(join(app, 'resources/app.asar/dsh/node_modules/@deepseek-ai', name, 'lib/index.js')).href)
const { Context } = await load('cordis')
const { LlmRuntime, LlmAdapter, BlockAssembler } = await load('dsh-llm')
const { ToolRuntime } = await load('dsh-tools')
const { agentEvents } = await load('dsh-agent')
const pluginAt = process.argv.indexOf('--plugin')
const plugin = pluginAt < 0 ? new URL('../lib/index.js', import.meta.url).href : pathToFileURL(join(resolve(process.argv[pluginAt + 1]), 'lib/index.js')).href
const { apply, version } = await import(plugin)
assert.equal(version, '0.6.1')
const ctx = new Context()
ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {} })
const llm = new LlmRuntime(ctx)
let tools
ctx.inject(['systemPrompt'], (c) => { tools = new ToolRuntime(c) })
apply(ctx, { factored: false, requireProvenance: false, maxRounds: 0, operationMaxRounds: 2 })
await new Promise((r) => setTimeout(r, 30))
assert.ok(tools, 'real ToolRuntime must be mounted')
assert.ok(tools.get('doubt_review'), 'plugin entry must register the receipt tool in real host')
let phase = 'bad', reviewed = 0
const chunks = (text) => [{ type: 'block-start', index: 0, blockType: 'text' }, { type: 'text-delta', index: 0, text }, { type: 'block-end', index: 0, block: { type: 'text', text } }, { type: 'finish', reason: { kind: 'stop' } }]
class Adapter extends LlmAdapter {
  async *stream(options) {
    if (options.sessionId) { yield* chunks(phase === 'bad' ? '现在可以正常使用了。' : '目标文件存在。'); return }
    reviewed++
    const packet = JSON.parse(options.messages[1].content[0].text)
    assert.deepEqual(options.tools, [])
    const review = phase === 'bad' ? { decision: 'verify', issues: ['没有功能验收证据。'] }
      : { decision: 'approve', segments: [{ partIds: packet.draftParts.map((p) => p.id), kind: 'observation', evidence: [{ callId: 'check', quote: 'True' }] }] }
    yield* chunks(JSON.stringify(review))
  }
}
llm.registerAdapter(['fixture'], new Adapter())
const abort = new AbortController()
let events = []
const agent = { id: 'host-test', session: { id: 'host-test', snapshotEvents: () => events } }
const dispatch = agentEvents(ctx, agent)
const request = { provider: 'fixture', model: 'fixture-model', sessionId: agent.id, signal: abort.signal,
  messages: [{ id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '修复并检查目标文件。' }] }], tools: tools.wireSchemas(agent).schemas }
async function run() {
  await dispatch.waterfall('agent/request', { turn: 1, step: 1, signal: abort.signal }, async () => ({ provider: 'fixture', model: 'fixture-model' }))
  const assembler = new BlockAssembler(), seen = []
  for await (const c of llm.stream(request)) { assembler.push(c); seen.push(c) }
  return { blocks: assembler.blocks(), finish: assembler.finish, seen }
}
const rejected = await run()
assert.equal(rejected.finish.kind, 'tool-calls', JSON.stringify(rejected.finish))
assert.ok(!rejected.seen.some((c) => c.type === 'text-delta'), 'unreviewed text must never be displayed')
const receipt = rejected.blocks[0]
assert.equal(receipt.name, 'doubt_review')
const execution = await tools.execute({ callId: receipt.id, name: receipt.name, arguments: JSON.parse(receipt.arguments), agent, signal: abort.signal })
assert.notEqual(execution.isError, true, JSON.stringify(execution))
assert.ok(JSON.stringify(execution).includes('verification-required'), 'host validates and executes receipt output')
events = [{ type: 'tool/call', data: { turn: 1, callId: 'check', name: 'pwsh', arguments: '{"command":"Test-Path target"}' } },
  { type: 'tool/result', surfaceOp: 'append', data: { turn: 1, message: { toolCallId: 'check', source: { callId: 'check' }, content: [{ type: 'text', text: 'True' }] } } }]
phase = 'good'
const accepted = await run()
assert.equal(accepted.finish.kind, 'stop')
assert.equal(accepted.blocks[0].text, '目标文件存在。')
assert.equal(reviewed, 2, 'exactly one independent review per final answer, no recursion')
await ctx.fiber.dispose()
console.log('host.test PASS: real Cordis + LlmRuntime + BlockAssembler + ToolRuntime; blocked draft, executed receipt, accepted grounded answer (offline adapter)')
console.log(`Loaded ${version}: ${plugin}`)
