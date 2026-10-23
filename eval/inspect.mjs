/** Summarize where refuted verdicts cluster and print samples. */

import { readFileSync } from 'node:fs'

const { rows } = JSON.parse(readFileSync('eval/out/claims.json', 'utf8'))
const by = (r, f) => (r[f] ?? {})

const table = {}
for (const r of rows) {
  table[r.kind] ??= { total: 0, refuted: 0, confirmed: 0, unverifiable: 0, inconclusive: 0 }
  table[r.kind].total += 1
  table[r.kind][by(r, 'offline').verdict] = (table[r.kind][by(r, 'offline').verdict] ?? 0) + 1
}
console.log('kind'.padEnd(12), 'total'.padStart(6), 'refuted'.padStart(8), 'confirmed'.padStart(10), 'unverifiable'.padStart(13), 'conflict'.padStart(9), 'refuted%'.padStart(9))
for (const [k, v] of Object.entries(table).sort((a, b) => b[1].total - a[1].total)) {
  console.log(k.padEnd(12), String(v.total).padStart(6), String(v.refuted ?? 0).padStart(8), String(v.confirmed ?? 0).padStart(10), String(v.unverifiable ?? 0).padStart(13), String(v.inconclusive ?? 0).padStart(9), `${(100 * (v.refuted ?? 0) / v.total).toFixed(0)}%`.padStart(9))
}

// Sample refuted assertions and print their evidence chains.
const seen = {}
const sample = []
for (const r of rows) {
  if (by(r, 'offline').verdict !== 'refuted') continue
  seen[r.kind] = (seen[r.kind] ?? 0) + 1
  if (seen[r.kind] <= 4) sample.push(r)
}
console.log(`\n=== refuted samples (${sample.length}) ===`)
for (const r of sample) {
  console.log(`#${r.id} [${r.kind}] ${JSON.stringify(r.claim).slice(0, 90)}`)
  for (const p of by(r, 'offline').provenance.slice(0, 3)) console.log('    ' + p.slice(0, 150))
}
