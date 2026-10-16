/**
 * 语料抽取：把宿主真实会话记录里的「模型回答」取出来，作为评测输入。
 * 不编题目、不自己答——用这台机器上真实发生过的会话。
 *
 * 用法：node eval/corpus.mjs [--sessions <dir>] [--out eval/out/corpus.json] [--min-chars 240]
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** 宿主按帧追加写入：一个 .jsonl.zstd 里有多个 zstd 帧，必须逐帧解 */
const FRAME_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

function decompressAll(buf, diag) {
  const starts = []
  for (let i = 0; i + 4 <= buf.length; i += 1) {
    if (buf[i] === FRAME_MAGIC[0] && buf[i + 1] === FRAME_MAGIC[1] && buf[i + 2] === FRAME_MAGIC[2] && buf[i + 3] === FRAME_MAGIC[3]) starts.push(i)
  }
  diag.framesDetected += starts.length
  const chunks = []
  for (let k = 0; k < starts.length; k += 1) {
    const from = starts[k]
    const to = k + 1 < starts.length ? starts[k + 1] : buf.length
    try {
      chunks.push(zstdDecompressSync(buf.subarray(from, to)).toString('utf8'))
      diag.framesDecoded += 1
    } catch {
      diag.framesFailed += 1
    }
  }
  return chunks.join('')
}

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : fallback
}

// 不要硬编码用户名：既不可移植，也会把本机账户名带进公开仓库。
const SESSIONS = arg('sessions', process.env.DSH_SESSIONS ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions'))
const OUT = arg('out', 'eval/out/corpus.json')
const MIN_CHARS = Number(arg('min-chars', 240))

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (entry.endsWith('.jsonl.zstd')) out.push(full)
  }
  return out
}

function collectText(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const b of content) {
    if (b && typeof b === 'object' && b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.join('\n')
}

const files = existsSync(SESSIONS) ? walk(SESSIONS) : []
const answers = []
const stats = { files: files.length, framesDetected: 0, framesDecoded: 0, framesFailed: 0, events: 0, parseErrors: 0, turns: 0, kept: 0, skippedShort: 0, skippedInjected: 0, skippedToolTurn: 0 }

for (const file of files) {
  let text
  try {
    text = decompressAll(readFileSync(file), stats)
  } catch (e) {
    stats.parseErrors += 1
    continue
  }
  const session = file.split(/[\\/]/).slice(-2)[0]
  /** turn -> { texts: string[], tools: string[], entrySource: string } */
  const turns = new Map()
  const turnOf = (n) => {
    let t = turns.get(n)
    if (!t) { t = { texts: [], tools: [], entrySource: '' }; turns.set(n, t) }
    return t
  }
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let ev
    try {
      ev = JSON.parse(line)
    } catch {
      stats.parseErrors += 1
      continue
    }
    stats.events += 1
    const turn = Number(ev?.data?.turn)
    if (!Number.isFinite(turn)) continue
    const t = turnOf(turn)
    if (ev.type === 'assistant/message') {
      const s = collectText(ev.data?.message?.content ?? ev.data?.content)
      if (s) t.texts.push(s)
    } else if (ev.type === 'tool/call') {
      if (typeof ev.data?.name === 'string') t.tools.push(ev.data.name)
    } else if (ev.type === 'user/message') {
      const kind = ev.data?.source?.kind
      t.entrySource = typeof kind === 'string' ? kind : 'user'
    }
  }
  for (const [turn, t] of turns) {
    stats.turns += 1
    const text2 = t.texts.join('\n\n').trim()
    if (t.entrySource && t.entrySource !== 'user') { stats.skippedInjected += 1; continue }
    if (text2.length < MIN_CHARS) { stats.skippedShort += 1; continue }
    stats.kept += 1
    answers.push({ session, turn, text: text2, tools: [...new Set(t.tools)], chars: text2.length })
  }
}

// 保留全部真人轮回答，带工具标记：
// 「无取证轮」只是插件的免打扰闸条件，评测要同时看全量与闸内子集。
mkdirSync(join(OUT.split(/[\\/]/).slice(0, -1).join('/')), { recursive: true })
writeFileSync(OUT, JSON.stringify({ stats, answers }, null, 1), 'utf8')
const noTool = answers.filter((a) => a.tools.length === 0)
stats.skippedToolTurn = answers.length - noTool.length
console.log(JSON.stringify(stats, null, 1))
console.log(`写出 ${answers.length} 条真人轮回答（其中无工具调用 ${noTool.length} 条 = ${(100 * noTool.length / answers.length).toFixed(1)}%）→ ${OUT}`)
const med = answers.map((a) => a.chars).sort((x, y) => x - y)[Math.floor(answers.length / 2)] ?? 0
console.log(`字符数：中位 ${med}，总计 ${answers.reduce((s, a) => s + a.chars, 0)}`)
