import assert from 'node:assert/strict'
import { installDoubtLoop } from '../lib/loop.js'
import { normalizeConfig } from '../lib/config.js'
import { buildVerifyTool } from '../lib/tool.js'
import { apply } from '../lib/index.js'

const SLOPPY = [
  '改完直接跑：',
  '```bash',
  'pnpm run build && pnpm start',
  '```',
  '默认端口是 19387，配置文件在 E:\\app\\config.yaml。',
  '这样一定能成功，绝对没问题。',
].join('\n')

function events(turn, { sourceKind = 'user', text = SLOPPY, toolCalls = [] } = {}) {
  const list = [
    { type: 'turn/end', data: { turn } },
    { type: 'user/message', data: { turn, source: { kind: sourceKind } } },
    { type: 'assistant/message', data: { turn, message: { content: [{ type: 'text', text }] } } },
  ]
  for (const name of toolCalls) list.push({ type: 'tool/call', data: { turn, name } })
  return list
}

function makeAgent(id, evs) {
  const followups = []
  return {
    id,
    status: 'idle',
    session: { id, snapshotEvents: () => evs },
    followup: (msg) => followups.push(msg),
    followups,
  }
}

const cfg = normalizeConfig({ maxRounds: 2, minScore: 6, minAnswerChars: 40 })
const logs = []
const listeners = []
const loop = installDoubtLoop(
  { on: (name, handler) => { listeners.push([name, handler]); return () => {} } },
  { getConfig: () => cfg, log: (...a) => logs.push(a.join(' ')), delayMs: 0 },
)
const tick = () => new Promise((r) => setTimeout(r, 20))

// 1) 未取证的回答 → 追加一轮复核
const a1 = makeAgent('s1', events(1))
listeners.forEach(([, h]) => h({ agent: a1, status: 'idle' }))
await tick()
assert.equal(a1.followups.length, 1, '应追加 1 轮复核')
assert.equal(a1.followups[0].source.kind, 'dsh-doubt')
assert.ok(a1.followups[0].content[0].text.includes('复核'), '注入文本应包含复核字样')
assert.ok(a1.followups[0].content[0].text.includes('command'), '应列出 command 类断言')

// 2) 同一个 turn 不重复触发
listeners.forEach(([, h]) => h({ agent: a1, status: 'idle' }))
await tick()
assert.equal(a1.followups.length, 1, '同一 turn 不应重复触发')

// 3) 复核轮本身还能再来一次（maxRounds=2），第三次不再触发
const a2 = makeAgent('s1', events(2, { sourceKind: 'dsh-doubt' }))
listeners.forEach(([, h]) => h({ agent: a2, status: 'idle' }))
await tick()
assert.equal(a2.followups.length, 1, '第二轮复核应触发')
const a3 = makeAgent('s1', events(3, { sourceKind: 'dsh-doubt' }))
listeners.forEach(([, h]) => h({ agent: a3, status: 'idle' }))
await tick()
assert.equal(a3.followups.length, 0, '超过 maxRounds 应停手')

// 4) 本轮已经调用过取证工具 → 不打扰
const a4 = makeAgent('s2', events(1, { toolCalls: ['bash', 'read'] }))
listeners.forEach(([, h]) => h({ agent: a4, status: 'idle' }))
await tick()
assert.equal(a4.followups.length, 0, '已取证不应触发')

// 5) 短回答不触发
const a5 = makeAgent('s3', events(1, { text: '好的，收到。' }))
listeners.forEach(([, h]) => h({ agent: a5, status: 'idle' }))
await tick()
assert.equal(a5.followups.length, 0, '短回答不应触发')

// 6) running / inbox 忙时不触发
const a6 = makeAgent('s4', events(1))
a6.status = 'running'
listeners.forEach(([, h]) => h({ agent: a6, status: 'idle' }))
await tick()
assert.equal(a6.followups.length, 0, 'running 时不应触发')

// 7) 人工新消息重置轮数预算
const a7 = makeAgent('s1', events(9, { sourceKind: 'user' }))
listeners.forEach(([, h]) => h({ agent: a7, status: 'idle' }))
await tick()
assert.equal(a7.followups.length, 1, '人工轮应重置预算并重新允许复核')

loop.dispose()

// 8) apply() 在假宿主里注册工具与提示词段
const registered = []
const sections = []
const fakeCtx = {
  logger: () => ({ info: () => {} }),
  inject: (deps, cb) => cb(),
  tools: { register: (d) => registered.push(d) },
  systemPrompt: { section: (s) => sections.push(s) },
  on: () => () => {},
}
apply(fakeCtx, { maxRounds: 1 })
assert.deepEqual(registered.map((t) => t.name), ['verify_claims'], '应注册 verify_claims')
assert.equal(sections[0].name, 'dsh-doubt:self-check')
assert.ok(sections[0].order > 3000 && sections[0].order < 5000)

// 9) 工具能真的执行
const tool = buildVerifyTool(() => cfg)
const out = await tool.execute({ checks: [{ kind: 'expr', source: '6*7', expectMatch: '42' }, { kind: 'fileExists', path: 'E:\\不存在-aa' }] }, { signal: undefined })
assert.equal(out.results.length, 2)
assert.equal(out.results[0].ok, true)
assert.equal(out.results[1].ok, false)
assert.ok(out.summary.includes('失败 1 条'))

console.log('loop.test OK（复核循环 + 预算 + 免打扰 + 工具执行 全部通过）')
