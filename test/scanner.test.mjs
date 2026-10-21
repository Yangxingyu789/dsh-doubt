import assert from 'node:assert/strict'
import { scanAnswer, extractTurn, lastTurn, collectText, turnHadVerification, DETECTOR_KINDS } from '../lib/scanner.js'

const sloppy = [
  '直接把项目跑起来就行：',
  '```bash',
  'pnpm install --offline',
  'pnpm run build',
  '```',
  '配置文件在 E:\\dsh-doubt\\package.json，版本是 v0.1.0。',
  '这个包依赖 `@deepseek-ai/cordis`，调用 `ctx.tools.register()` 就能注册工具。',
  '整个流程大概 30 秒 就能跑通，保证一次成功，绝对没问题。',
].join('\n')

const a = scanAnswer(sloppy)
assert.ok(a.score >= 6, `风险分应 >= 6，实际 ${a.score}`)
const kinds = new Set(a.findings.map((f) => f.kind))
for (const expected of ['command', 'path', 'version', 'symbol', 'package', 'number', 'absolute']) {
  assert.ok(kinds.has(expected), `应检出 ${expected}，实际：${[...kinds].join(',')}`)
}


const clean = '这个问题我需要先确认你的运行环境，能贴一下报错原文吗？'
const b = scanAnswer(clean)
assert.ok(b.score <= 1, `干净回答分数应 <= 1，实际 ${b.score}`)


const off = scanAnswer(sloppy, { detectors: { command: false, path: false, version: false, symbol: false, package: false, number: false, absolute: false } })
assert.equal(off.score, 0, '关掉全部检测器后应为 0')


const many = Array.from({ length: 20 }, (_, i) => `\`pkg${i}\``).join(' ')
const capped = scanAnswer(many, { capPerKind: 3 })
assert.equal(capped.findings.filter((f) => f.kind === 'package').length, 3, 'package 应最多计 3 条')


const reversal = scanAnswer('抱歉，我之前说错了，正确做法是换个参数。')
assert.ok(reversal.findings.some((f) => f.kind === 'reversal'), '应检出改口')


const punct = scanAnswer('配置在 E:\\a\\b.json。日志在 /var/log/app.log，还有 E:\\c\\d.txt、')
const paths = punct.findings.filter((f) => f.kind === 'path').map((f) => f.snippet)
assert.ok(paths.includes('E:\\a\\b.json'), `应剥掉尾部句号，实际：${JSON.stringify(paths)}`)
assert.ok(paths.includes('/var/log/app.log'), `应剥掉尾部逗号，实际：${JSON.stringify(paths)}`)
assert.ok(paths.includes('E:\\c\\d.txt'), `应剥掉尾部顿号，实际：${JSON.stringify(paths)}`)


const bare = scanAnswer('参考 arXiv 2402.06380 这篇论文')
assert.ok(bare.findings.some((f) => f.kind === 'version' && f.snippet === '2402.06380'), `应抓到裸编号，实际：${JSON.stringify(bare.findings.map((f) => f.snippet))}`)

const named = scanAnswer('依赖 cordis 4.0.4 和 typescript 9.9.9')
const verSnips = named.findings.filter((f) => f.kind === 'version').map((f) => f.snippet)
assert.ok(verSnips.some((s) => s.includes('cordis') && s.includes('4.0.4')), `版本断言应带包名，实际：${JSON.stringify(verSnips)}`)


const events = [
  { type: 'turn/end', data: { turn: 3 } },
  { type: 'user/message', data: { turn: 3, source: { kind: 'user' } } },
  { type: 'assistant/message', data: { turn: 3, message: { content: [{ type: 'text', text: '跑 `npm test` 就行' }] } } },
  { type: 'tool/call', data: { turn: 3, name: 'bash' } },
  { type: 'assistant/message', data: { turn: 2, message: { content: [{ type: 'text', text: '别的轮' }] } } },
]
assert.equal(lastTurn(events), 3)
const extract = extractTurn(events, 3)
assert.ok(extract.text.includes('npm test'), '应拿到本轮 assistant 文本')
assert.ok(!extract.text.includes('别的轮'), '不应混入其他轮')
assert.deepEqual(extract.toolNames, ['bash'])
assert.ok(turnHadVerification(extract.toolNames, ['bash']))
assert.ok(!turnHadVerification(['write'], ['bash']))
assert.equal(collectText({ content: '字符串内容' }), '字符串内容')

assert.ok(DETECTOR_KINDS.length >= 9, '检测器数量应 >= 9')
console.log(`scanner.test OK（sloppy score=${a.score}, clean score=${b.score}）`)
