/**
 * 打分：把人工独立核实的真值（eval/out/labels.json）和插件判定对齐。
 *
 * 真值字段：
 *   truth: "false" | "true" | "unknown"     —— 该断言在现实中是否成立（用独立手段核实，见 method）
 *   extraction_ok: true | false             —— 抽取出的片段是否忠实代表回答里的断言
 *   asserted: true | false                  —— 回答是否**断言**了这件事（还是只是提到/别处的事）
 *   method: 我用的独立核实手段
 *
 * 关键指标不是「准确率」，而是两类危险错误的速率：
 *   假证伪（插件说错，其实对）—— 会把正确回答改坏
 *   假证实（插件说对，其实错）—— 给幻觉背书
 */

import { readFileSync } from 'node:fs'

const { rows } = JSON.parse(readFileSync('eval/out/claims.json', 'utf8'))
const labels = JSON.parse(readFileSync('eval/out/labels.json', 'utf8'))
const byId = new Map(rows.map((r) => [r.id, r]))

const pct = (a, b) => (b === 0 ? '—' : `${((100 * a) / b).toFixed(1)}%`)

let extractionOk = 0
let assertedCount = 0
const cells = []

for (const l of labels) {
  const r = byId.get(l.id)
  if (!r) { console.error(`找不到 id=${l.id}`); continue }
  if (l.extraction_ok) extractionOk += 1
  if (l.asserted) assertedCount += 1
  cells.push({
    id: l.id,
    kind: r.kind,
    verdict: r.offline.verdict,
    onlineVerdict: r.online?.verdict ?? r.offline.verdict,
    truth: l.truth,
    asserted: l.asserted,
    extraction_ok: l.extraction_ok,
    snippet: (r.snippet ?? '').slice(0, 60),
  })
}

function report(field, label) {
  const refuted = cells.filter((c) => c[field] === 'refuted')
  const confirmed = cells.filter((c) => c[field] === 'confirmed')
  const incon = cells.filter((c) => c[field] === 'inconclusive' || c[field] === 'unverifiable')
  // 一次「证伪」只有在下面三条同时成立时才算有用：
  //   抽取忠实（指代物对）、回答确实断言了这件事、断言在现实中真的错
  const validRef = refuted.filter((c) => c.extraction_ok && c.asserted && c.truth === 'false')
  const badExtraction = refuted.filter((c) => !c.extraction_ok)
  const notAsserted = refuted.filter((c) => c.extraction_ok && !c.asserted)
  const actuallyTrue = refuted.filter((c) => c.extraction_ok && c.asserted && c.truth === 'true')
  const falseConf = confirmed.filter((c) => c.truth === 'false')
  const actuallyFalse = cells.filter((c) => c.truth === 'false')
  const flaggedFalse = actuallyFalse.filter((c) => c[field] === 'refuted')

  console.log(`\n=== ${label} ===`)
  console.log(`判「证伪」共 ${refuted.length} 条`)
  console.log(`   有效证伪（抽取对 + 是断言 + 真的错）：${validRef.length} → 有效率 ${pct(validRef.length, refuted.length)}`)
  console.log(`   无效：抽取就错了（指代物不对）${badExtraction.length}｜回答根本没断言这事 ${notAsserted.length}｜**其实是对的（假证伪）** ${actuallyTrue.length}`)
  console.log(`判「证实」共 ${confirmed.length} 条，其中其实是错的（假证实）：${falseConf.length} → ${pct(falseConf.length, confirmed.length)}`)
  console.log(`判「无法核验/冲突」${incon.length} 条`)
  console.log(`真值为「错」的断言 ${actuallyFalse.length} 条，被抓到 ${flaggedFalse.length} → 召回 ${pct(flaggedFalse.length, actuallyFalse.length)}`)
  if (actuallyTrue.length > 0) {
    console.log('假证伪明细（回答是对的，插件说它错）：')
    for (const c of actuallyTrue) console.log(`  #${c.id} [${c.kind}] ${JSON.stringify(c.snippet)}`)
  }
  if (badExtraction.length > 0) {
    console.log('抽取错误导致的无效证伪（指代物根本不是那回事）：')
    for (const c of badExtraction) console.log(`  #${c.id} [${c.kind}] ${JSON.stringify(c.snippet)}`)
  }
  if (falseConf.length > 0) {
    console.log('假证实明细：')
    for (const c of falseConf) console.log(`  #${c.id} [${c.kind}] ${JSON.stringify(c.snippet)}`)
  }
}

console.log(`标注 ${labels.length} 条`)
console.log(`抽取忠实度（extraction_ok）：${extractionOk}/${labels.length} = ${pct(extractionOk, labels.length)}`)
console.log(`其中属于「回答确实断言了这件事」：${assertedCount}/${labels.length} = ${pct(assertedCount, labels.length)}`)
report('verdict', '离线（Tier A）')
report('onlineVerdict', '联网（Tier A+B）')
