/**
 * 分层抽样，带上下文：为「真值标注」准备材料。
 * 判定一条断言到底是真是假，必须看它在原回答里说的是什么话——所以打印上下文。
 *
 * 用法：node eval/sample.mjs [--per 6]
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}
const PER = Number(arg('per', 6))

const { rows } = JSON.parse(readFileSync('eval/out/claims.json', 'utf8'))
const { answers } = JSON.parse(readFileSync('eval/out/corpus.json', 'utf8'))
const textOf = new Map(answers.map((a) => [`${a.session}#${a.turn}`, a.text]))

function contextOf(row, radius = 160) {
  const text = textOf.get(`${row.session}#${row.turn}`) ?? ''
  const at = text.indexOf(row.snippet ?? '')
  if (at < 0) return text.slice(0, radius * 2).replace(/\s+/g, ' ')
  const from = Math.max(0, at - radius)
  const to = Math.min(text.length, at + (row.snippet ?? '').length + radius)
  return (from > 0 ? '…' : '') + text.slice(from, to).replace(/\s+/g, ' ') + (to < text.length ? '…' : '')
}

// 确定性分层：按类型 × 判定，等距取样（可复现，不用随机数）
const buckets = new Map()
for (const r of rows) {
  const key = `${r.kind}|${r.offline.verdict}`
  if (!buckets.has(key)) buckets.set(key, [])
  buckets.get(key).push(r)
}

const picked = []
for (const [key, list] of [...buckets.entries()].sort()) {
  if (list.length === 0) continue
  const step = Math.max(1, Math.floor(list.length / PER))
  for (let i = 0; i < list.length && picked.filter((p) => `${p.kind}|${p.offline.verdict}` === key).length < PER; i += step) {
    picked.push(list[i])
  }
}

const out = picked.map((r) => ({
  id: r.id,
  kind: r.kind,
  verdict: r.offline.verdict,
  onlineVerdict: r.online?.verdict ?? null,
  snippet: r.snippet ?? r.text ?? '',
  provenance: r.offline.provenance,
  context: contextOf(r),
  tools: r.tools,
}))

mkdirSync(join('eval', 'out'), { recursive: true })
writeFileSync('eval/out/sample.json', JSON.stringify(out, null, 1), 'utf8')
console.log(`抽样 ${out.length} 条（来自 ${buckets.size} 个 类型×判定 桶）→ eval/out/sample.json\n`)
for (const s of out) {
  console.log(`#${s.id} [${s.kind}→${s.verdict}${s.onlineVerdict && s.onlineVerdict !== s.verdict ? '/' + s.onlineVerdict : ''}] ${JSON.stringify(s.snippet).slice(0, 70)}`)
  console.log(`   上下文: ${s.context.slice(0, 150)}`)
  console.log(`   证据: ${(s.provenance[0] ?? '').slice(0, 110)}`)
}
