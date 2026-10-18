#!/usr/bin/env node
/**
 * dsh-doubt doctor —— 一条命令回答「插件是否真的装上、是否真的在生效」。
 *
 * 灵感来自 dsh 生态里 dsh-verdict 的 `verdict doctor`（只做静态可判定的事，
 * 剩下的交给真实运行）与 Aegis 的「proof before done」：
 * 不把「文件已复制」当结论，而是分开核验：
 *
 *   A. 安装一致性（静态）：仓库 / live 安装目录 / profile 链接 的版本与 lib hash；
 *   B. 装载声明（静态）：profile package.json、cordis.patch.yml、组合后的 cordis.yml；
 *   C. 运行证据（读本机落盘 session）：
 *      - system/message 是否含插件注入的提示词段（0.6.x 的「危险变更闸门」）；
 *      - 最终回答里 dsh-doubt 审核横幅的出现次数（审核真的跑过的痕迹）；
 *      - verify_claims / doubt_review 工具在真实会话里的调用次数。
 *
 * 退出码：A/B 有 FAIL → 1；C 只报告不判失败（它依赖本机是否有会话历史）。
 * 无安装时打印 SKIP 并以 0 退出（CI 友好）。
 *
 *   node scripts/doctor.mjs [--profile desktop] [--json]
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zstdDecompressSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name)
  return at >= 0 && process.argv[at + 1] ? process.argv[at + 1] : fallback
}
const asJson = process.argv.includes('--json')
const profile = arg('--profile', 'desktop')
const home = process.env.DSH_HOME || join(homedir(), '.dsh')
const installed = join(home, 'plugins', 'dsh-doubt')
const profileDir = join(home, 'profiles', profile)
const repoPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

const checks = []
const add = (id, ok, detail, level = 'fail') => checks.push({ id, ok, detail, level })
const sha = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
const rel = (base) => {
  const out = []
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name)
      const stat = statSync(abs)
      if (stat.isDirectory()) walk(abs, `${prefix}${name}/`)
      else out.push({ rel: `${prefix}${name}`, abs, size: stat.size })
    }
  }
  walk(base, '')
  return out
}

// ── A. 安装一致性 ────────────────────────────────────────────────────────────
if (!existsSync(installed)) {
  console.log(`SKIP doctor: plugin is not installed at ${installed}`)
  process.exit(0)
}
const installedPkg = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
add('installed-version', installedPkg.version === repoPkg.version, `repo=${repoPkg.version} installed=${installedPkg.version}`)
add('manifest-version', JSON.parse(readFileSync(join(installed, 'dsh-plugin.json'), 'utf8')).version === installedPkg.version,
  `dsh-plugin.json version vs package.json version`)
const repoLib = rel(join(root, 'lib'))
const instLib = rel(join(installed, 'lib'))
const missing = []
const differing = []
for (const entry of repoLib) {
  const target = join(installed, 'lib', entry.rel)
  if (!existsSync(target)) { missing.push(entry.rel); continue }
  if (sha(entry.abs) !== sha(target)) differing.push(entry.rel)
}
add('lib-identical', missing.length === 0 && differing.length === 0,
  `repo-lib-files=${repoLib.length} missing=${missing.length} differing=${differing.length}${missing.length ? ` (${missing.slice(0, 3).join(', ')})` : ''}${differing.length ? ` (${differing.slice(0, 3).join(', ')})` : ''}`)
const linkFile = join(profileDir, 'node_modules', 'dsh-doubt', 'lib', 'completion.js')
if (existsSync(linkFile)) {
  add('profile-link', sha(linkFile) === sha(join(root, 'lib', 'completion.js')), 'profile node_modules link hash vs repo')
} else {
  add('profile-link', false, `missing ${linkFile}`)
}

// ── B. 装载声明 ──────────────────────────────────────────────────────────────
const profilePkgPath = join(profileDir, 'package.json')
if (existsSync(profilePkgPath)) {
  const profilePkg = JSON.parse(readFileSync(profilePkgPath, 'utf8'))
  const dep = profilePkg.dependencies?.['dsh-doubt']
  const bundle = profilePkg.dsh?.profile?.bundles ?? []
  add('profile-dependency', typeof dep === 'string', `dependencies["dsh-doubt"]=${JSON.stringify(dep)}`)
  add('profile-bundle', bundle.includes('dsh-doubt'), `dsh.profile.bundles includes dsh-doubt (${bundle.length} entries)`)
} else {
  add('profile-dependency', false, `missing ${profilePkgPath}`)
  add('profile-bundle', false, `missing ${profilePkgPath}`)
}
const patchPath = join(installed, 'cordis.patch.yml')
if (existsSync(patchPath)) {
  const patch = readFileSync(patchPath, 'utf8')
  add('patch-is-array', /^\s*-\s+insert:/m.test(patch), 'installed cordis.patch.yml starts with a top-level `- insert:` list')
  for (const key of ['guardLiveMutation', 'guardPreExecute', 'reviewReasoningEffort', 'reviewNotice', 'segmentedReview']) {
    add(`patch-${key}`, new RegExp(`^\\s*${key}:`, 'm').test(patch), `installed patch declares ${key}`)
  }
  add('preflight-module', existsSync(join(installed, 'lib', 'preflight.js')), 'installed lib contains preflight.js (pre-execute gate module)')
} else {
  add('patch-is-array', false, `missing ${patchPath}`)
}
const composedPath = join(profileDir, 'cordis.yml')
if (existsSync(composedPath)) {
  const composed = readFileSync(composedPath, 'utf8')
  add('composed-config', /^- id: dsh-doubt$/m.test(composed), 'composed cordis.yml contains `- id: dsh-doubt`')
} else {
  add('composed-config', false, `missing ${composedPath} (host has not composed this profile yet)`)
}
add('node-engine', /^(\^22\.19|>=24)/.test(repoPkg.engines?.node ?? ''), `package.json engines.node=${JSON.stringify(repoPkg.engines?.node)}`)

// ── C. 运行证据（本机落盘 session；只报告） ──────────────────────────────────
const runtime = { session: null, systemMessages: 0, guardSection: false, answers: 0, answersWithBanner: 0, lastBannerFlags: [], verifyClaimsCalls: 0, doubtReviewCalls: 0 }
try {
  const sessionsRoot = join(home, 'sessions')
  const newest = () => {
    let best
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const abs = join(dir, name)
        let stat
        try { stat = statSync(abs) } catch { continue }
        if (stat.isDirectory()) walk(abs)
        else if (name === 'session.v4.jsonl.zstd' && (!best || stat.mtimeMs > best.mtimeMs)) best = { file: abs, mtimeMs: stat.mtimeMs }
      }
    }
    if (existsSync(sessionsRoot)) walk(sessionsRoot)
    return best
  }
  const found = newest()
  if (found) {
    runtime.session = found.file
    const buf = readFileSync(found.file)
    const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
    const offsets = []
    let cursor = 0
    while (true) {
      const at = buf.indexOf(magic, cursor)
      if (at < 0) break
      offsets.push(at)
      cursor = at + 1
    }
    const lines = []
    for (let i = 0; i < offsets.length; i++) {
      const from = offsets[i]
      const to = i + 1 < offsets.length ? offsets[i + 1] : buf.length
      try { lines.push(zstdDecompressSync(buf.subarray(from, to)).toString('utf8')) } catch { /* skip corrupt frame */ }
    }
    const events = lines.join('\n').split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
    const textOf = (message) => (message?.content ?? []).filter((block) => block?.type === 'text').map((block) => block.text).join('')
    for (const event of events) {
      if (event.type === 'system/message') {
        runtime.systemMessages++
        const text = JSON.stringify(event.data ?? '')
        if (text.includes('危险变更闸门（dsh-doubt）') || text.includes('Live-mutation guard (dsh-doubt)')) runtime.guardSection = true
      }
      if (event.type === 'tool/call') {
        if (event.data?.name === 'verify_claims') runtime.verifyClaimsCalls++
        if (event.data?.name === 'doubt_review') runtime.doubtReviewCalls++
      }
      if (event.type === 'assistant/message') {
        const text = textOf(event.data?.message)
        if (!text.trim()) continue
        runtime.answers++
        const banner = text.includes('以上草稿**未经完整审核**')
        if (banner) runtime.answersWithBanner++
        runtime.lastBannerFlags.push(banner ? 'banner' : 'clean')
      }
    }
  }
} catch (error) {
  runtime.error = String(error?.message ?? error)
}

// ── 输出 ─────────────────────────────────────────────────────────────────────
const failed = checks.filter((c) => !c.ok && c.level === 'fail')
const summary = {
  ok: failed.length === 0,
  repoHead: existsSync(join(root, '.git')) ? null : undefined,
  checks: Object.fromEntries(checks.map((c) => [c.id, { ok: c.ok, detail: c.detail }])),
  runtime,
}
if (asJson) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  const label = (c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.id}: ${c.detail}`
  for (const check of checks) console.log(label(check))
  if (runtime.session) {
    console.log(`INFO  runtime.session: ${runtime.session}`)
    console.log(`INFO  system messages=${runtime.systemMessages} guardPromptInjected=${runtime.guardSection}`)
    console.log(`INFO  answers=${runtime.answers} answersWithReviewBanner=${runtime.answersWithBanner} last=${runtime.lastBannerFlags.slice(-6).join(',')}`)
    console.log(`INFO  live tool calls: verify_claims=${runtime.verifyClaimsCalls} doubt_review=${runtime.doubtReviewCalls}`)
  } else {
    console.log(`INFO  runtime: no session store found under ${join(home, 'sessions')}`)
  }
  console.log(summary.ok ? `\ndoctor OK：静态安装/装载声明 ${checks.length} 项全部一致` : `\ndoctor FAIL：${failed.length} 项不一致`)
}
process.exit(summary.ok ? 0 : 1)
