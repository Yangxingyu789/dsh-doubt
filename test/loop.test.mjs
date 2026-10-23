import assert from 'node:assert/strict'
import { join } from 'node:path'
import { installDoubtLoop } from '../lib/loop.js'
import { normalizeConfig } from '../lib/config.js'
import { buildVerifyTool } from '../lib/tool.js'
import { apply } from '../lib/index.js'

const MISSING = join(process.cwd(), '__dsh-doubt-loop-missing__', 'config.yaml')
const SLOPPY = [
  '改完直接跑：',
  '```bash',
  'pnpm run build && pnpm start',
  '```',
  `默认端口是 19387，配置文件在 ${MISSING}。`,
  '这样一定能成功，绝对没问题。',
].join('\n')


function events(turn, { sourceKind = 'user', text = SLOPPY, toolCalls = [], aux = null } = {}) {
  const list = [
    { type: 'turn/start', data: { turn } },
    { type: 'user/message', data: { content: [{ type: 'text', text: 'go' }], source: { kind: sourceKind }, role: 'user', id: `u${turn}` } },
    { type: 'assistant/message', data: { turn, step: 1, message: { content: [{ type: 'text', text }] } } },
  ]
  for (const name of toolCalls) list.push({ type: 'tool/call', data: { turn, name } })
  for (const kind of aux ?? []) {
    list.push({ type: 'user/message', data: { content: [{ type: 'text', text: 'aux' }], source: { kind }, role: 'user', id: `aux-${turn}-${kind}` } })
  }
  list.push({ type: 'turn/end', data: { turn, reason: 'completed' } })
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


const a1 = makeAgent('s1', events(1))
listeners.forEach(([, h]) => h({ agent: a1, status: 'idle' }))
await tick()
assert.equal(a1.followups.length, 1, '应追加 1 轮复核')
assert.equal(a1.followups[0].source.kind, 'dsh-doubt')
assert.ok(a1.followups[0].content[0].text.includes('取证结果'), '注入文本应是插件的实测取证结果')
assert.ok(a1.followups[0].content[0].text.includes('已证伪'), '不存在的路径应被实测证伪')
assert.ok(a1.followups[0].content[0].text.includes('无法核验'), '含 && 的命令应标为无法机械核验')


listeners.forEach(([, h]) => h({ agent: a1, status: 'idle' }))
await tick()
assert.equal(a1.followups.length, 1, '同一 turn 不应重复触发')


const a2 = makeAgent('s1', events(2, { sourceKind: 'dsh-doubt' }))
listeners.forEach(([, h]) => h({ agent: a2, status: 'idle' }))
await tick()
assert.equal(a2.followups.length, 1, '第二轮复核应触发')
const a3 = makeAgent('s1', events(3, { sourceKind: 'dsh-doubt' }))
listeners.forEach(([, h]) => h({ agent: a3, status: 'idle' }))
await tick()
assert.equal(a3.followups.length, 0, '超过 maxRounds 应停手')


const a4 = makeAgent('s2', events(1, { toolCalls: ['bash', 'read'] }))
listeners.forEach(([, h]) => h({ agent: a4, status: 'idle' }))
await tick()
assert.equal(a4.followups.length, 1, '仅出现 bash/read 不能跳过路径核验')


const a5 = makeAgent('s3', events(1, { text: '好的，收到。' }))
listeners.forEach(([, h]) => h({ agent: a5, status: 'idle' }))
await tick()
assert.equal(a5.followups.length, 0, '短回答不应触发')


const a6 = makeAgent('s4', events(1))
a6.status = 'running'
listeners.forEach(([, h]) => h({ agent: a6, status: 'idle' }))
await tick()
assert.equal(a6.followups.length, 0, 'running 时不应触发')


const a7 = makeAgent('s1', events(9, { sourceKind: 'user' }))
listeners.forEach(([, h]) => h({ agent: a7, status: 'idle' }))
await tick()
assert.equal(a7.followups.length, 1, '人工轮应重置预算并重新允许复核')




const a8a = makeAgent('s5', events(1, { sourceKind: 'user', aux: ['runtime-context', 'skill-catalog'] }))
listeners.forEach(([, h]) => h({ agent: a8a, status: 'idle' }))
await tick()
assert.equal(a8a.followups.length, 1, '带辅助注入的人工轮应触发第 1 轮')
const a8b = makeAgent('s5', events(2, { sourceKind: 'dsh-doubt', aux: ['tool-jobs'] }))
listeners.forEach(([, h]) => h({ agent: a8b, status: 'idle' }))
await tick()
assert.equal(a8b.followups.length, 1, '带 aux 的第 2 轮应仍计入预算（第 2 轮）')
const a8c = makeAgent('s5', events(3, { sourceKind: 'dsh-doubt', aux: ['repeat-tool-reminder'] }))
listeners.forEach(([, h]) => h({ agent: a8c, status: 'idle' }))
await tick()
assert.equal(a8c.followups.length, 0, 'aux 不得把已用满的预算归零')

loop.dispose()





const registered = []
const sections = []
const injectedCtx = {
  tools: { register: (d) => registered.push(d) },
  systemPrompt: { section: (s) => sections.push(s) },
  subagents: { start: async () => ({ result: Promise.resolve({ output: [] }), dispose: async () => {} }) },
}
const fakeCtx = {
  logger: () => ({ info: () => {} }),
  inject: (deps, cb) => cb(injectedCtx),
  on: () => () => {},
}
apply(fakeCtx, { maxRounds: 1, requireOperationEvidence: false })
assert.deepEqual(registered.map((t) => t.name), ['verify_claims'], '应注册 verify_claims')
assert.equal(sections[0].name, 'dsh-doubt:self-check')
assert.ok(sections[0].order > 3000 && sections[0].order < 5000)





const strictRegistered = []
const strictSections = []
const strictInjected = {
  tools: { register: (d) => strictRegistered.push(d.name) },
  systemPrompt: { section: (s) => strictSections.push(s.name) },
  subagents: { start: async () => ({ result: Promise.resolve({ output: [] }), dispose: async () => {} }) },
}
const strictCtx = {
  logger: () => ({ info: () => {} }),
  on: () => () => {},
  get tools() { throw new Error('cannot get property "tools" without inject') },
  get systemPrompt() { throw new Error('cannot get property "systemPrompt" without inject') },
  get subagents() { throw new Error('cannot get property "subagents" without inject') },
  inject: (deps, cb) => cb(strictInjected),
}
let strictErr = null
try { apply(strictCtx, { maxRounds: 1, requireOperationEvidence: false }) } catch (e) { strictErr = e }
assert.equal(strictErr, null, 'apply 不得在未 inject 的外层 ctx 上取服务：' + (strictErr && strictErr.message))
assert.deepEqual(strictRegistered, ['verify_claims'], '必须用注入后的上下文注册工具')
assert.equal(strictSections[0], 'dsh-doubt:self-check', '必须用注入后的上下文注入提示词段')


const tool = buildVerifyTool(() => cfg)
const out = await tool.execute({ checks: [{ kind: 'expr', source: '6*7', expectMatch: '42' }, { kind: 'fileExists', path: 'E:\\不存在-aa' }] }, { signal: undefined })
assert.equal(out.results.length, 2)
assert.equal(out.results[0].ok, true)
assert.equal(out.results[1].ok, false)
assert.ok(out.summary.includes('失败 1 条'))
const DOC_BODY = [
  '# 部署手册',
  '',
  '## 1. 环境准备',
  '版本要求：vLLM v0.30.0、CANN 8.35.1、PyTorch 2.14.1+cu132。',
  '```bash',
  'npu-smi info',
  'free -g',
  '```',
  '安装包放在 D:\\AI-Setup\\installers\\config.yaml。',
  '绝对可以一次装好。',
  '',
  ...Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 步：登录目标机执行上述命令，等待约 30 分钟。`),
].join('\n')

function docEvents(turn, { path, text, sourceKind = 'user' }) {
  return [
    { type: 'turn/start', data: { turn } },
    { type: 'user/message', data: { content: [{ type: 'text', text: 'go' }], source: { kind: sourceKind }, role: 'user', id: `u${turn}` } },

    { type: 'tool/call', data: { turn, name: 'write', arguments: JSON.stringify({ file_path: path, content: 'x' }) } },
    { type: 'assistant/message', data: { turn, step: 1, message: { content: [{ type: 'text', text }] } } },
    { type: 'turn/end', data: { turn, reason: 'completed' } },
  ]
}

const provListeners = []
const provFollowups = []
const provLoop = installDoubtLoop(
  { on: (name, handler) => { provListeners.push([name, handler]); return () => {} } },
  { getConfig: () => normalizeConfig({ maxRounds: 2, minScore: 6, minAnswerChars: 40 }), log: () => {}, delayMs: 0 },
)
let provEvents = []
const provAgent = {
  id: 'doc-session',
  status: 'idle',
  session: { id: 'doc-session', snapshotEvents: () => provEvents },
  followup: (m) => provFollowups.push(m),
}
const provCount = () => provFollowups.filter((m) => m.source?.summary === 'provenance').length
async function writeTurn(turn, path, text, sourceKind = 'user') {
  provEvents = [...provEvents, ...docEvents(turn, { path, text, sourceKind })]
  provListeners.forEach(([, h]) => h({ agent: provAgent, status: 'idle' }))
  await tick()
}

await writeTurn(1, 'E:\\proj\\DEPLOY.md', DOC_BODY)
assert.equal(provCount(), 1, '写了交付文档且正文无出处 → 应要求一次溯源')
assert.ok(provFollowups[0].content[0].text.includes('DEPLOY.md'), '注入文本应点名文件')
assert.ok(/逐步骤溯源表/.test(provFollowups[0].content[0].text), '应要求逐步骤溯源表')

await writeTurn(2, 'E:\\proj\\DEPLOY.md', DOC_BODY)
assert.equal(provCount(), 1, '同一份文档不得问第二次')

await writeTurn(3, 'E:\\proj\\OTHER.md', `${DOC_BODY}\n\n## 附录 A：版本与来源总表\n\n| 项 | 来源 |\n|---|---|\n| vLLM | 官方文档 |\n`)
assert.equal(provCount(), 1, '正文已有溯源小节 → 不再问')

await writeTurn(4, 'E:\\proj\\notes.mjs', DOC_BODY)
assert.equal(provCount(), 1, '非交付文档（.mjs）不触发')

await writeTurn(5, 'E:\\proj\\logs\\toolcall-probe.txt', DOC_BODY)
assert.equal(provCount(), 1, 'logs 目录下的 .txt 是产物不是交付文档')




await writeTurn(6, 'E:\\proj\\A.md', DOC_BODY, 'dsh-doubt')
await writeTurn(7, 'E:\\proj\\B.md', DOC_BODY, 'dsh-doubt')
await writeTurn(8, 'E:\\proj\\C.md', DOC_BODY, 'dsh-doubt')
await writeTurn(9, 'E:\\proj\\D.md', DOC_BODY, 'dsh-doubt')
assert.equal(provCount(), 5, '注入链上允许 4 次（t1 那次属于上一条链）')
await writeTurn(10, 'E:\\proj\\E.md', DOC_BODY, 'dsh-doubt')
assert.equal(provCount(), 5, 'ping-pong 链上的第 5 次必须被硬顶挡住')

await writeTurn(11, 'E:\\proj\\F.md', DOC_BODY, 'user')
assert.equal(provCount(), 6, '新的 人工轮应重置溯源预算')
provLoop.dispose()

// Terminal review notices are plugin output, not a fresh task for legacy checks.
// Include a deliverable and risky prose to prove the skip precedes provenance,
// probing and Tier C, rather than passing only because the notice is too short.
let skipListener, skipCalls = 0, probeCalls = 0, skippedFactoredCalls = 0, skippedReviewedCalls = 0
const terminalNotice = `[dsh-doubt] 本次尚未完成验证。自动取证轮数已用尽。\n审核意见（待核实）：\n${DOC_BODY}`
const skipAgent = makeAgent('reviewer-failed', docEvents(1, { path: 'E:\\proj\\terminal.md', text: terminalNotice }))
const skipped = installDoubtLoop({ on: (_name, fn) => { skipListener = fn; return () => {} } }, {
  getConfig: () => normalizeConfig({ minAnswerChars: 1, minScore: 0 }), delayMs: 0,
  skipTurn: (agent, turn) => { skipCalls++; assert.equal(agent, skipAgent); assert.equal(turn, 1); return true },
  reviewedTurn: () => { skippedReviewedCalls++; return false },
  probe: { state: async () => { probeCalls++; return { online: true } } },
  factoredHost: () => { skippedFactoredCalls++; throw new Error('terminal review must not start factored children') },
})
skipListener({ agent: skipAgent, status: 'idle' }); await tick()
skipListener({ agent: skipAgent, status: 'idle' }); await tick()
assert.equal(skipCalls, 1, 'terminal notice must be marked handled after the first idle event')
assert.equal(probeCalls, 0); assert.equal(skippedFactoredCalls, 0); assert.equal(skippedReviewedCalls, 0)
assert.equal(skipAgent.followups.length, 0, 'terminal notice must not request provenance or another followup')
skipped.dispose()

// Accepted prose must not trigger a second assertion/Tier C audit, while an
// actual written deliverable still receives its separate provenance requirement.
let reviewedListener, reviewedCalls = 0, reviewedProbeCalls = 0, reviewedFactoredCalls = 0
const reviewedLoop = installDoubtLoop({ on: (_name, fn) => { reviewedListener = fn; return () => {} } }, {
  getConfig: () => normalizeConfig({ minAnswerChars: 1, minScore: 0 }), delayMs: 0,
  reviewedTurn: (_agent, turn) => { reviewedCalls++; assert.equal(turn, 1); return true },
  probe: { state: async () => { reviewedProbeCalls++; return { online: true } } },
  factoredHost: () => { reviewedFactoredCalls++; throw new Error('accepted prose must not start factored children') },
})
const reviewedAgent = makeAgent('reviewed-prose', events(1))
reviewedListener({ agent: reviewedAgent, status: 'idle' }); await tick()
reviewedListener({ agent: reviewedAgent, status: 'idle' }); await tick()
assert.equal(reviewedCalls, 1, 'accepted prose is handled once')
assert.equal(reviewedAgent.followups.length, 0)

const reviewedDocAgent = makeAgent('reviewed-document', docEvents(1, { path: 'E:\\proj\\reviewed.md', text: DOC_BODY }))
reviewedListener({ agent: reviewedDocAgent, status: 'idle' }); await tick()
reviewedListener({ agent: reviewedDocAgent, status: 'idle' }); await tick()
assert.equal(reviewedDocAgent.followups.length, 1, 'accepting prose must retain document provenance requirements')
assert.equal(reviewedDocAgent.followups[0].source.summary, 'provenance')
assert.match(reviewedDocAgent.followups[0].content[0].text, /reviewed\.md/)
assert.equal(reviewedCalls, 1, 'provenance is checked before the accepted-prose skip')
assert.equal(reviewedProbeCalls, 0); assert.equal(reviewedFactoredCalls, 0)
reviewedLoop.dispose()

console.log('loop.test OK（复核循环 + 预算 + 免打扰 + 工具执行 + 交付文档溯源 全部通过）')
