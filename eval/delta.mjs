/**
 * 修复前后对照：同一批真值标注，看每条断言的判定怎么变。
 * 按 session#turn#kind#snippet 匹配，不靠会漂移的行号 id。
 */

import { readFileSync } from 'node:fs'

const v1 = JSON.parse(readFileSync('eval/out/claims-v1.json', 'utf8'))
const v2 = JSON.parse(readFileSync('eval/out/claims.json', 'utf8'))
const labels = JSON.parse(readFileSync('eval/out/labels.json', 'utf8'))

const key = (r) => `${r.session}#${r.turn}#${r.kind}#${r.snippet ?? r.claim ?? ''}`
const idx2 = new Map(v2.rows.map((r) => [key(r), r]))
const byId1 = new Map(v1.rows.map((r) => [r.id, r]))

const trans = new Map()
const detail = []
for (const l of labels) {
  const old = byId1.get(l.id)
  if (!old) continue
  const now = idx2.get(key(old))
  const to = now ? now.offline.verdict : '已过滤（不再抽取）'
  const k = `${old.offline.verdict} → ${to}`
  trans.set(k, (trans.get(k) ?? 0) + 1)
  detail.push({ id: l.id, kind: old.kind, truth: l.truth, extraction_ok: l.extraction_ok, asserted: l.asserted, from: old.offline.verdict, to, valid: now ? null : 'filtered' })
}

console.log('=== 判定迁移（同一批 44 条标注）===')
for (const [k, n] of [...trans.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(3)}  ${k}`)

// 关键安全指标重算
const stillRefuted = detail.filter((d) => d.to === 'refuted')
const validNow = stillRefuted.filter((d) => d.extraction_ok && d.asserted && d.truth === 'false')
const invalidNow = stillRefuted.filter((d) => !(d.extraction_ok && d.asserted && d.truth === 'false'))
console.log(`\n修复后仍判「证伪」：${stillRefuted.length} 条（修复前 13 条）`)
console.log(`   其中有效 ${validNow.length}｜无效 ${invalidNow.length}`)
for (const d of invalidNow) console.log(`   仍无效：#${d.id} [${d.kind}] truth=${d.truth} extraction_ok=${d.extraction_ok} asserted=${d.asserted}`)

const filteredBad = detail.filter((d) => d.to === '已过滤（不再抽取）' && !d.extraction_ok).length
const filteredAll = detail.filter((d) => d.to === '已过滤（不再抽取）').length
console.log(`\n被过滤掉的断言：${filteredAll} 条，其中抽取本来就错的 ${filteredBad} 条`)

const confNow = detail.filter((d) => d.to === 'confirmed')
const falseConf = confNow.filter((d) => d.truth === 'false')
console.log(`判「证实」：${confNow.length} 条，假证实 ${falseConf.length}`)

// 全量口径
const dist = v2.rows.reduce((m, r) => ((m[r.offline.verdict] = (m[r.offline.verdict] ?? 0) + 1), m), {})
const dist1 = v1.rows.reduce((m, r) => ((m[r.offline.verdict] = (m[r.offline.verdict] ?? 0) + 1), m), {})
console.log(`\n=== 全量语料（152 条真实回答）===`)
console.log(`断言数：${v1.rows.length} → ${v2.rows.length}`)
console.log(`判定分布：${JSON.stringify(dist1)} → ${JSON.stringify(dist)}`)
const inj1 = v1.perAnswer.filter((p) => p.wouldInject).length
const inj2 = v2.perAnswer.filter((p) => p.wouldInject).length
const silent2 = v2.perAnswer.filter((p) => p.claims === 0 || p.allConfirmed).length
console.log(`会插话的回答：${inj1}/152 → ${inj2}/152（沉默 ${silent2}）`)
