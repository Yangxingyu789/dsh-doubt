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

/**
 * 宿主真实落盘形状（本机会话日志实测，勿再简化）：
 *   - `turn/end` / `turn/start` / `assistant/message` / `tool/call` 都带 data.turn
 *   - `user/message` 只有 {content,id,role,source}，**没有 turn 字段**（337/337 条实测）
 *   - 入口 user/message 出现在本轮的 turn/start 之后
 * 旧 fixture 给 user/message 补了一个 turn，于是「按 turn 匹配入口消息」永远失败、
 * maxRounds 完全不生效这件事被测试掩盖了。改回真实形状才能守住这个回归。
 *
 * 真实顺序（本机 192 个 turn 实测）：入口消息在 turn/start 之后，而自动注入的上下文
 * （runtime-context / skill-catalog / tool-jobs / 各种提醒）落在**更后面**。实测到的模式
 * 就有 `user>runtime-context>skill-catalog`、`user>tool-jobs`。所以 `aux` 不是装饰：
 * 取「窗口里最后一条 user/message」会被这些辅助注入顶掉，取**第一条**才对。
 */
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

// 1) 未取证的回答 → 追加一轮复核
const a1 = makeAgent('s1', events(1))
listeners.forEach(([, h]) => h({ agent: a1, status: 'idle' }))
await tick()
assert.equal(a1.followups.length, 1, '应追加 1 轮复核')
assert.equal(a1.followups[0].source.kind, 'dsh-doubt')
assert.ok(a1.followups[0].content[0].text.includes('取证结果'), '注入文本应是插件的实测取证结果')
assert.ok(a1.followups[0].content[0].text.includes('已证伪'), '不存在的路径应被实测证伪')
assert.ok(a1.followups[0].content[0].text.includes('无法核验'), '含 && 的命令应标为无法机械核验')

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

// 8) 入口消息之后还有辅助注入（runtime-context / skill-catalog / tool-jobs 等）时，
//    预算必须仍然累计。这正是「取窗口第一条」与「取最后一条」的分水岭：
//    用最后一条会被 aux 顶掉 → 预算被错误归零 → maxRounds 失效。
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

// 8) apply() 注册工具与提示词段。
//    `inject` 必须把「注入后的上下文」交给回调 —— 真实 cordis 就是这样，
//    而服务只落在声明了 inject 的那个 fiber 上。旧的假 ctx 写成 `cb()`（不传上下文），
//    于是「回调里闭包捕获外层 ctx」这个真实存在的错误完全测不出来。
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
apply(fakeCtx, { maxRounds: 1 })
assert.deepEqual(registered.map((t) => t.name), ['verify_claims'], '应注册 verify_claims')
assert.equal(sections[0].name, 'dsh-doubt:self-check')
assert.ok(sections[0].order > 3000 && sections[0].order < 5000)

// 8b) 真实 cordis 的服务访问规则：**没 inject 的上下文**取 ctx.tools 会直接抛错。
//     宿主实测：`dsh-doubt (dsh-doubt): Error: cannot get property "tools" without inject`
//     —— 工具与提示词段一个都没注册，而界面上完全看不出来。
//     这里把外层 ctx 的服务做成会抛的 getter，强制 apply 只能用注入后的上下文。
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
try { apply(strictCtx, { maxRounds: 1 }) } catch (e) { strictErr = e }
assert.equal(strictErr, null, 'apply 不得在未 inject 的外层 ctx 上取服务：' + (strictErr && strictErr.message))
assert.deepEqual(strictRegistered, ['verify_claims'], '必须用注入后的上下文注册工具')
assert.equal(strictSections[0], 'dsh-doubt:self-check', '必须用注入后的上下文注入提示词段')

// 9) 工具能真的执行
const tool = buildVerifyTool(() => cfg)
const out = await tool.execute({ checks: [{ kind: 'expr', source: '6*7', expectMatch: '42' }, { kind: 'fileExists', path: 'E:\\不存在-aa' }] }, { signal: undefined })
assert.equal(out.results.length, 2)
assert.equal(out.results[0].ok, true)
assert.equal(out.results[1].ok, false)
assert.ok(out.summary.includes('失败 1 条'))

// ---- 10) 交付文档溯源闸：与「只有正面反驳才说话」并列的独立触发类 ----
//
// 依据来自实测：一份 46k 字的部署手册上机械判定只覆盖 21 条断言、其中 20 条判不了，
// 而同一个模型被问「所有流程是否都有据可依」后能自己产出 42 项溯源表。
// 所以这里测的不是「判得对」，而是「该不该要一次溯源」——以及**别问第二次**。
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
    // 注意：真实宿主写入的 arguments 是 **JSON 字符串**，不是对象
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

// 独立预算：链式累计，人工新消息会重置（设计意图是「一次人工回合同一份/同一串交付最多问 4 次」），
// 目的是不让模型「被要求溯源 → 又写一份新文档 → 又被要求」无限 ping-pong。
// 注意 t5 是 user 轮 → 到 t6 时预算已归零，所以 t6..t9 构成一条新链（1,2,3,4），t10 才会被挡住。
await writeTurn(6, 'E:\\proj\\A.md', DOC_BODY, 'dsh-doubt')
await writeTurn(7, 'E:\\proj\\B.md', DOC_BODY, 'dsh-doubt')
await writeTurn(8, 'E:\\proj\\C.md', DOC_BODY, 'dsh-doubt')
await writeTurn(9, 'E:\\proj\\D.md', DOC_BODY, 'dsh-doubt')
assert.equal(provCount(), 5, '注入链上允许 4 次（t1 那次属于上一条链）')
await writeTurn(10, 'E:\\proj\\E.md', DOC_BODY, 'dsh-doubt')
assert.equal(provCount(), 5, 'ping-pong 链上的第 5 次必须被硬顶挡住')
// 人工新消息应当重置预算（否则长会话里后面的文档永远拿不到溯源要求）
await writeTurn(11, 'E:\\proj\\F.md', DOC_BODY, 'user')
assert.equal(provCount(), 6, '新的 人工轮应重置溯源预算')
provLoop.dispose()

console.log('loop.test OK（复核循环 + 预算 + 免打扰 + 工具执行 + 交付文档溯源 全部通过）')
