import assert from 'node:assert/strict'
import { extractClaims } from '../lib/claims.js'
import { gatherEvidence, verdictOf } from '../lib/evidence.js'
import { normalizeConfig } from '../lib/config.js'
import { scanAnswer } from '../lib/scanner.js'

const cfg = normalizeConfig({ workspace: process.cwd() })

// ---- 判定规则本身 ----
// 在线：需要 ≥requireSources 个独立来源一致才算 confirmed
assert.equal(verdictOf([{ ok: true }, { ok: true }], cfg, true).verdict, 'confirmed', '在线 2 个来源一致应 confirmed')
assert.equal(verdictOf([{ ok: true }], cfg, true).verdict, 'inconclusive', '在线只有 1 个来源应 inconclusive')
// 离线：一个确定性来源就够
assert.equal(verdictOf([{ ok: true }], cfg, false).verdict, 'confirmed', '离线 1 个确定性来源应 confirmed')
// 全反驳 → refuted；有冲突 → inconclusive；无来源 → unverifiable
assert.equal(verdictOf([{ ok: false }, { ok: false }], cfg, true).verdict, 'refuted')
assert.equal(verdictOf([{ ok: true }, { ok: false }], cfg, true).verdict, 'inconclusive')
assert.equal(verdictOf([], cfg, true).verdict, 'unverifiable')
// 只有弱证据（命中但不是定义位置）→ 中性：既不确认也不反驳
assert.equal(verdictOf([{ ok: false, weak: true }], cfg, false).verdict, 'inconclusive', '弱证据不应 confirmed')
assert.ok(verdictOf([{ ok: false, weak: true }], cfg, false).note?.includes('弱证据'))
// 弱证据 + 强证据 → 按强证据算
assert.equal(verdictOf([{ ok: false, weak: true }, { ok: true }], cfg, false).verdict, 'confirmed')
// 弱证据 + 反驳证据 → 仍算反驳
assert.equal(verdictOf([{ ok: false, weak: true }, { ok: false }], cfg, false).verdict, 'refuted')

// ---- 断言 → 可执行检查的翻译，含安全约束 ----
const claims = extractClaims(scanAnswer([
  '配置文件在 E:\\dsh-doubt\\package.json。',
  '依赖 typescript 5.9.3，包名 `@deepseek-ai/cordis`。',
  '调用 `normalizeConfig(raw)` 即可。',
  '```bash',
  'pnpm install --offline',
  '```',
  '```bash',
  'echo hi && del x',
  '```',
].join('\n'), {}).findings, {})

const byKind = new Map(claims.map((c) => [c.kind, c]))
assert.ok(byKind.has('path'), '应抽出路径断言')
assert.ok(byKind.has('package'), '应抽出包名断言')
assert.ok(byKind.has('command'), '应抽出命令断言')

// 含 && 的命令不得被解析成可执行 → 必须标 unmechanizable
const unsafe = claims.find((c) => c.text.includes('&&'))
assert.ok(unsafe, '应抓到含 && 的命令')
assert.equal(unsafe.checks.length, 0, '含 && 的命令不应生成可执行检查')
assert.ok(unsafe.unmechanizable, '应说明为何无法机械核验')

// 默认不执行回答里的命令：command 类只允许 commandAvailability
const safe = claims.find((c) => c.kind === 'command' && c.checks.length > 0)
assert.ok(safe, '应有一条可机械核验的命令断言')
assert.deepEqual(safe.checks.map((c) => c.kind), ['commandAvailability'], '默认只查程序存在性，不执行')
const withExec = extractClaims(scanAnswer('```bash\npnpm --version\n```', {}).findings, { executeAnswerCommands: true })
assert.ok(withExec.some((c) => c.checks.some((k) => k.kind === 'command')), '显式开启后才生成可执行命令')

// ---- 端到端：离线取证 ----
const ev = await gatherEvidence(claims, cfg, { online: false, probedAt: Date.now(), latencyMs: 0 })
assert.equal(ev.length, claims.length)
const pathEv = ev.find((e) => e.kind === 'path')
assert.equal(pathEv.verdict, 'confirmed', '真实存在的路径应被离线证实')
assert.ok(pathEv.provenance.length >= 1 && pathEv.provenance[0].startsWith('✓'), 'provenance 应带 ✓ 与来源标签')

const bogus = await gatherEvidence(
  extractClaims(scanAnswer('路径 E:\\zz-definitely-missing\\a\\b.yaml 和包 `this-pkg-does-not-exist-xyz` 都在。', {}).findings, {}),
  cfg,
  { online: false, probedAt: Date.now(), latencyMs: 0 },
)
// 文件系统能**正面**说「不存在」→ 证伪成立
const bogusPath = bogus.find((e) => e.kind === 'path')
assert.equal(bogusPath?.verdict, 'refuted', `本机不存在的路径应被证伪：${bogusPath?.verdict}`)
// 本机没装这个包 ≠ 回答错了（可能只是提到它，或说的是别的仓库/机器）→ 不得反驳
const bogusPkg = bogus.find((e) => e.kind === 'package')
assert.equal(bogusPkg?.verdict, 'unverifiable', `离线时「本机没这个包」不得算证伪：${bogusPkg?.verdict} / ${bogusPkg?.note ?? ''}`)

// 只有确属本机的路径才证伪；上下文在讲另一台机器时必须降级为「判不了」。
// 方向性保证：这个守卫只会让断言变沉默，**不会新增任何反驳**。
//
// 变异测试实测过的坑：原来的措辞用的是「把配置写到 …」，而 `写到` 不在 EXISTENCE_RE 里，
// 于是断言在更早的 assertsExistence 闸就被丢掉、mentionsOtherMachine **根本没被执行**——
// 测试是绿的但零覆盖。所以这里必须用**能通过 assertExistence 且命中远程语境**的措辞。
const remoteAnswer = '目标服务器上存在 E:\\zz-definitely-missing\\a\\b.yaml，请先确认后再继续。'
const remoteClaims = extractClaims(scanAnswer(remoteAnswer, {}).findings, { text: remoteAnswer })
const remoteReachable = remoteClaims.filter((c) => c.kind === 'path')
assert.ok(remoteReachable.length > 0, `这个用例必须真的产生 path 断言，否则守卫测不到：${JSON.stringify(remoteClaims)}`)
assert.ok(
  remoteReachable.every((c) => c.unmechanizable?.includes('另一台机器')),
  `目标机器的路径必须由 mentionsOtherMachine 降级（而不是靠别的闸碰巧丢掉）：${JSON.stringify(remoteReachable)}`,
)
const remoteEv = await gatherEvidence(remoteClaims, cfg, { online: false, probedAt: Date.now(), latencyMs: 0 })
const remotePath = remoteEv.find((e) => e.kind === 'path')
assert.notEqual(remotePath?.verdict, 'refuted', `目标机器的路径不得被本机证伪：${remotePath?.verdict} / ${remotePath?.note ?? ''}`)

// 方法调用不是程序名：`.ps1` 里的 `z.Dispose()` 曾被拿去 which → 假证伪
const callEv = await gatherEvidence(
  extractClaims(scanAnswer('脚本里调用 z.Dispose() 释放对象。', {}).findings, {}),
  cfg,
  { online: false, probedAt: Date.now(), latencyMs: 0 },
)
const callClaim = callEv.find((e) => e.kind === 'command')
if (callClaim) assert.notEqual(callClaim.verdict, 'refuted', `方法调用不得被证伪：${callClaim.verdict}`)

console.log(`evidence.test OK（判定规则 + 安全翻译 + 离线取证端到端 + 另一台机器/方法调用 守卫；样例 ${ev.length} 条）`)
