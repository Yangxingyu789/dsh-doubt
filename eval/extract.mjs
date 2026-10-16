/**
 * 对真实回答跑插件的取证管线，产出可核对的断言清单。
 * 离线一遍、联网一遍，便于比较 Tier B 的增益。
 *
 * 用法：node eval/extract.mjs [--corpus eval/out/corpus.json] [--out eval/out/claims.json] [--online]
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { extractClaims } from '../lib/claims.js'
import { normalizeConfig } from '../lib/config.js'
import { gatherEvidence } from '../lib/evidence.js'
import { NetProbe } from '../lib/network.js'
import { scanAnswer } from '../lib/scanner.js'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}

const CORPUS = arg('corpus', 'eval/out/corpus.json')
const OUT = arg('out', 'eval/out/claims.json')
const cfg = normalizeConfig({ workspace: process.cwd(), requireSources: 2 })

const { answers } = JSON.parse(readFileSync(CORPUS, 'utf8'))
const offline = { online: false, probedAt: Date.now(), latencyMs: 0 }
const net = await new NetProbe({ urls: cfg.probeUrls, timeoutMs: cfg.onlineTimeoutMs }).state()

const rows = []
const perAnswer = []
let id = 0

for (const a of answers) {
  const scan = scanAnswer(a.text)
  const claims = extractClaims(scan.findings, { text: a.text })
  const evOff = await gatherEvidence(claims, cfg, offline)
  const evOn = net.online ? await gatherEvidence(claims, cfg, net) : null

  for (let i = 0; i < claims.length; i += 1) {
    const c = claims[i]
    const off = evOff[i]
    const on = evOn?.[i]
    rows.push({
      id: id++,
      session: a.session,
      turn: a.turn,
      kind: c.kind,
      snippet: c.text,
      claim: c.text,
      checkKinds: c.checks.map((k) => k.kind),
      offline: { verdict: off.verdict, agreeing: off.agreeing, contradicting: off.contradicting, provenance: off.provenance, note: off.note ?? null },
      online: on ? { verdict: on.verdict, agreeing: on.agreeing, contradicting: on.contradicting, provenance: on.provenance, note: on.note ?? null } : null,
      answerChars: a.chars,
      tools: a.tools,
    })
  }

  const verdicts = evOff.map((e) => e.verdict)
  const hard = evOff.filter((e) => e.verdict === 'refuted' || (e.verdict === 'inconclusive' && e.contradicting > 0))
  perAnswer.push({
    session: a.session,
    turn: a.turn,
    chars: a.chars,
    tools: a.tools,
    findings: scan.findings.length,
    claims: claims.length,
    judgeable: evOff.filter((e) => e.verdict !== 'unverifiable').length,
    hard: hard.length,
    verdicts,
    // 与 loop.ts 的插话闸门保持一致：只有正面反驳才说话
    wouldInject: hard.length > 0,
    allConfirmed: verdicts.length > 0 && verdicts.every((v) => v === 'confirmed'),
  })
}

mkdirSync(join('eval', 'out'), { recursive: true })
writeFileSync(OUT, JSON.stringify({ net, rows, perAnswer }, null, 1), 'utf8')

const count = (arr, key) => arr.reduce((m, x) => ((m[x[key]] = (m[x[key]] ?? 0) + 1), m), {})
console.log(`回答 ${answers.length} 条 → 断言 ${rows.length} 条`)
console.log('按类型：', JSON.stringify(count(rows, 'kind')))
const vc = (get) => rows.reduce((m, r) => ((m[get(r)] = (m[get(r)] ?? 0) + 1), m), {})
console.log('离线：', JSON.stringify(vc((r) => r.offline.verdict)))
console.log('联网：', JSON.stringify(vc((r) => r.online?.verdict ?? 'n/a')))
const inj = perAnswer.filter((p) => p.wouldInject).length
const allOk = perAnswer.filter((p) => p.allConfirmed).length
const silent = perAnswer.filter((p) => p.claims === 0).length
console.log(`\n免打扰分布：会说话 ${inj}｜全部核实通过（沉默）${allOk}｜没抽出断言（沉默）${silent}`)
console.log(`可判定率（非 unverifiable）：${rows.filter((r) => r.offline.verdict !== 'unverifiable').length}/${rows.length}`)
console.log(`联网后变为可判定：${rows.filter((r) => r.offline.verdict === 'unverifiable' && r.online && r.online.verdict !== 'unverifiable').length}`)
console.log(`联网后判定改变：${rows.filter((r) => r.online && r.online.verdict !== r.offline.verdict).length}`)
console.log(`→ ${OUT}`)
