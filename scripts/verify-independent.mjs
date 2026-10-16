#!/usr/bin/env node
/**
 * Independent self-check for dsh-doubt.
 *
 * Why this exists: during the debugging session that produced these fixes, the *narration*
 * about the project was wrong several times while the code was fine — and once the reverse
 * (a real defect that every green test missed). So "the tests pass" and "the author says so"
 * are both weak evidence. This script therefore only reports things judged by an oracle that
 * is NOT this project:
 *
 *   1. the real DSH CLI        -> does the plugin row actually reach the composed config?
 *   2. the real `semver`       -> does rangeSatisfied agree with the reference implementation?
 *   3. the real `@deepseek-ai/cordis` -> does the plugin register its tool under the host's
 *                                        strict service-injection rule?
 *   4. this machine's own session logs -> does the provenance gate fire once per delivered
 *                                        document, and never on a code-only session?
 *   5. child processes         -> can any crafted `expr` payload kill or hang the host?
 *   6. monotonicity of the silence-only guards -> do they still catch a genuinely local
 *                                        missing path while never inventing refutations?
 *
 * Usage:  node scripts/verify-independent.mjs [--no-cli]
 * Exit:   0 = every item PASS (SKIP does not fail), 1 = at least one FAIL.
 *
 * Items needing the unpacked host app (2, 3) are SKIPPED when it is not present, with the
 * reason printed. Item 1 needs the same unpacked host to run the CLI.
 */
import { readFileSync, existsSync, mkdtempSync, rmSync, mkdirSync, cpSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir, tmpdir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 不要硬编码用户名/临时目录：既不可移植，也会把本机账户名带进公开仓库。
// 解包后的宿主应用（含 semver 与 dsh CLI）默认在系统临时目录下；可用 DSH_ASAR_DIR 覆盖。
const ASAR = process.env.DSH_ASAR_DIR ?? join(tmpdir(), 'dsh-asar', 'dsh')
const CLI = join(ASAR, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const SESSIONS = process.env.DSH_SESSIONS ?? join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')

const rows = []
const record = (name, status, detail) => {
  rows.push({ name, status, detail })
  console.log(`${status.padEnd(5)} ${name}${detail ? `\n        ${detail}` : ''}`)
}
const lib = (p) => import(new URL(`../lib/${p}`, import.meta.url).href)

// ── 1. the real DSH CLI composes the plugin row ───────────────────────────────
if (!existsSync(CLI)) {
  record('DSH CLI inserts the plugin row', 'SKIP', `host app not unpacked at ${ASAR} (set DSH_ASAR_DIR)`)
} else {
  const home = mkdtempSync(join(tmpdir(), 'dsh-selfcheck-'))
  try {
    mkdirSync(join(home, 'profiles', 'test'), { recursive: true })
    cpSync(join(ROOT, 'lib'), join(home, 'profiles', 'test', 'node_modules', 'dsh-doubt', 'lib'), { recursive: true })
    cpSync(join(ROOT, 'package.json'), join(home, 'profiles', 'test', 'node_modules', 'dsh-doubt', 'package.json'))
    cpSync(join(ROOT, 'cordis.patch.yml'), join(home, 'profiles', 'test', 'node_modules', 'dsh-doubt', 'cordis.patch.yml'))
    writeFileSync(join(home, 'profiles', 'test', 'package.json'), JSON.stringify({
      name: 'dsh-profile-test', private: true, dsh: { profile: { bundles: ['dsh-doubt'] } },
    }))
    const run = () => {
      const r = spawnSync(process.execPath, [CLI, '--profile', 'test', '--dump-config'], {
        encoding: 'utf8', timeout: 120000, env: { ...process.env, DSH_HOME: home },
      })
      return `${r.stdout ?? ''}${r.stderr ?? ''}`
    }
    const withInsert = run()
    record('DSH CLI inserts the plugin row', withInsert.includes('- id: dsh-doubt') ? 'PASS' : 'FAIL',
      withInsert.split('\n').filter((l) => /dsh-doubt|not found/.test(l)).slice(0, 2).join(' | ') || '(no dsh-doubt line)')
  } catch (e) {
    record('DSH CLI inserts the plugin row', 'FAIL', String(e).slice(0, 200))
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

// ── 2. semver agreement (reference implementation) ────────────────────────────
{
  const semverPath = join(ASAR, 'node_modules/semver')
  if (!existsSync(semverPath)) {
    record('rangeSatisfied agrees with node-semver', 'SKIP', `semver not found at ${semverPath}`)
  } else {
    const semver = createRequire(join(ASAR, 'x.js'))('semver')
    const { rangeSatisfied } = await lib('local.js')
    const ranges = ['*', '1.2.3', '=1.2', '=4', '^1.2.3', '^1.2', '^1.x', '^0', '^0.0', '^0.0.3', '^0.0.x', '^0.x', '^0.5', '~1.2.3', '~1.2', '~1', '~0', '~0.0', '>=1.2', '>1.2', '<=1.2', '<1.2', '>=4', '>4', '<=4', '<4', '1.x', '1.2.x', '^1.2.3 || ^2.0.0']
    const versions = ['0.0.1', '0.0.3', '0.0.4', '0.1.0', '0.2.9', '0.5.0', '0.6.0', '1.0.0', '1.2.0', '1.2.3', '1.2.9', '1.3.0', '1.9.9', '2.0.0', '4.0.0', '4.5.0', '5.0.0']
    let compared = 0
    const bad = []
    for (const r of ranges) for (const v of versions) {
      const got = rangeSatisfied(r, v)
      if (got === undefined) continue
      compared++
      if (got !== semver.satisfies(v, r)) bad.push(`${r}@${v}: ours=${got} ref=${semver.satisfies(v, r)}`)
    }
    record('rangeSatisfied agrees with node-semver', bad.length === 0 ? 'PASS' : 'FAIL',
      `${compared} pairs compared, ${bad.length} mismatches${bad.length ? ': ' + bad.slice(0, 4).join('; ') : ''}`)
  }
}

// ── 3. real cordis: services only on the injected context ─────────────────────
{
  const cordisPath = join(ROOT, 'node_modules/@deepseek-ai/cordis')
  if (!existsSync(cordisPath)) {
    record('registers under real cordis inject rules', 'SKIP', 'cordis devDependency not installed')
  } else {
    const { Context } = await import(new URL('../node_modules/@deepseek-ai/cordis/lib/index.js', import.meta.url).href)
    const { apply } = await lib('index.js')
    const registered = []
    const sections = []
    const injected = {
      tools: { register: (d) => registered.push(d.name) },
      systemPrompt: { section: (s) => sections.push(s.name) },
    }
    const ctx = new Context()
    // outer context must THROW on service access, exactly like the host does
    Object.defineProperty(ctx, 'tools', { get() { throw new Error('cannot get property "tools" without inject') } })
    Object.defineProperty(ctx, 'systemPrompt', { get() { throw new Error('cannot get property "systemPrompt" without inject') } })
    ctx.inject = (_deps, cb) => cb(injected)
    ctx.on = () => () => {}
    let err = null
    try { apply(ctx, { enabled: true, verifyTool: true, promptSection: true, autoVerify: false }) } catch (e) { err = e }
    const ok = !err && registered.includes('verify_claims') && sections.includes('dsh-doubt:self-check')
    record('registers under real cordis inject rules', ok ? 'PASS' : 'FAIL',
      err ? `threw: ${err.message}` : `tools=[${registered}] sections=[${sections}]`)
  }
}

// ── 4. provenance gate on this machine's own session logs ─────────────────────
if (!existsSync(SESSIONS)) {
  record('provenance gate: once per delivered document', 'SKIP', `no session store at ${SESSIONS}`)
} else {
  const frame = [0x28, 0xb5, 0x2f, 0xfd]
  const decode = (buf) => {
    const starts = []
    for (let i = 0; i + 4 <= buf.length; i++) if (buf[i] === frame[0] && buf[i + 1] === frame[1] && buf[i + 2] === frame[2] && buf[i + 3] === frame[3]) starts.push(i)
    const out = []
    for (let k = 0; k < starts.length; k++) {
      const to = k + 1 < starts.length ? starts[k + 1] : buf.length
      try { out.push(zstdDecompressSync(buf.subarray(starts[k], to)).toString('utf8')) } catch { /* skip */ }
    }
    return out.join('')
  }
  const walk = (dir, acc = []) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e)
      if (statSync(full).isDirectory()) walk(full, acc)
      else if (e.endsWith('.jsonl.zstd')) acc.push(full)
    }
    return acc
  }
  const { installDoubtLoop } = await lib('loop.js')
  const { normalizeConfig } = await lib('config.js')
  const { Context } = await import(new URL('../node_modules/@deepseek-ai/cordis/lib/index.js', import.meta.url).href)
  const cfg = normalizeConfig({})
  let docs = 0, asks = 0, codeTurns = 0, codeAsks = 0
  const files = walk(SESSIONS).map((f) => ({ f, m: statSync(f).mtimeMs })).sort((a, b) => b.m - a.m).slice(0, 4)
  for (const { f } of files) {
    let evs = []
    try { for (const l of decode(readFileSync(f)).split('\n')) if (l.trim()) { try { evs.push(JSON.parse(l)) } catch { /* skip */ } } } catch { continue }
    const ctx = new Context()
    ctx.provide('tools', { register: () => () => {} })
    ctx.provide('systemPrompt', { section: () => () => {} })
    installDoubtLoop(ctx, { getConfig: () => cfg, log: () => {}, delayMs: 0, probe: { state: async () => ({ online: false }) } })
    const got = []
    let view = []
    const agent = { id: 'x', status: 'idle', session: { id: 'x', snapshotEvents: () => view }, followup: (m) => got.push(m) }
    const turns = [...new Set(evs.filter((e) => e.type === 'turn/end').map((e) => Number(e.data?.turn)))].filter(Number.isFinite)
    const delivered = new Set()
    for (const t of turns) {
      const idx = evs.findLastIndex((e) => e.type === 'turn/end' && Number(e.data?.turn) === t)
      if (idx < 0) continue
      for (const e of evs) {
        if (e.type !== 'tool/call' || Number(e.data?.turn) !== t) continue
        if (!['write', 'edit'].includes(String(e.data?.name))) continue
        try {
          const a = JSON.parse(String(e.data?.arguments ?? '{}'))
          if (/\.(md|txt)$/i.test(String(a.file_path ?? a.path ?? ''))) delivered.add(String(a.file_path ?? a.path))
        } catch { /* skip */ }
      }
      view = evs.slice(0, idx + 1)
      ctx.emit('agent/status', { agent, status: 'idle' })
      await new Promise((r) => setTimeout(r, 20))
    }
    const p = got.filter((m) => m.source?.summary === 'provenance').length
    docs += delivered.size
    asks += p
    if (delivered.size === 0) { codeTurns++; codeAsks += p }
    ctx.dispose?.()
  }
  const ok = asks <= docs && codeAsks === 0
  record('provenance gate: once per delivered document', ok ? 'PASS' : 'FAIL',
    `documents written=${docs} asks=${asks} | sessions with no document: asks=${codeAsks} (must be 0)`)
}

// ── 5. expr payloads must not kill or hang the host ───────────────────────────
{
  const libUrl = new URL('../lib/verify.js', import.meta.url).href
  const payloads = [
    "Promise.reject(new Error('x'))",
    "import('node:fs')",
    "(() => { const f = () => Promise.resolve().then(f); f(); return 's' })()",
    'queueMicrotask(() => { throw new Error("b") })',
    'new Array(1e7).fill(0).map((_, i) => i).length',
    '(() => { let s = 0; for (let i = 0; i < 1e7; i++) s += i; return s })()',
    'Object.getPrototypeOf(this).constructor.constructor("return typeof process")()',
  ]
  const bad = []
  for (const src of payloads) {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const { runCheck } = await import(${JSON.stringify(libUrl)})
      const t0 = Date.now()
      const out = await runCheck({ kind: 'expr', source: ${JSON.stringify(src)} }, { timeoutMs: 800, denyBinaries: [] })
      console.log('OK ' + (Date.now() - t0) + ' ' + out.ok)
    `], { encoding: 'utf8', timeout: 9000 })
    if (r.status !== 0 || !/^OK /m.test(r.stdout ?? '')) bad.push(`${JSON.stringify(src).slice(0, 46)} -> status=${r.status} signal=${r.signal}`)
  }
  record('expr payloads cannot kill/hang the host', bad.length === 0 ? 'PASS' : 'FAIL',
    bad.length ? bad.join(' ; ') : `${payloads.length} payloads each returned cleanly in a child process`)
}

// ── 6. silence-only guards stay monotone ──────────────────────────────────────
{
  const { commandAvailability } = await lib('local.js')
  const { scanAnswer } = await lib('scanner.js')
  const { extractClaims } = await lib('claims.js')
  const { gatherEvidence } = await lib('evidence.js')
  const { normalizeConfig } = await lib('config.js')
  const cfg = normalizeConfig({})
  const localText = '本机配置文件在 E:\\dsh-doubt\\nope-9f2b.yaml，我已确认过。'
  const evLocal = await gatherEvidence(extractClaims(scanAnswer(localText).findings, { text: localText }), cfg,
    { online: false, probedAt: Date.now(), latencyMs: 0 }, 'C:/work/dsh-doubt')
  const stillRefutes = evLocal.find((e) => e.kind === 'path')?.verdict === 'refuted'
  const methodCallSilent = commandAvailability('z.Dispose()', ['z.Dispose()']).noEvidence === true
  const remoteText = '登录到目标服务器后，把配置写到 E:\\dsh-doubt\\nope-9f2b.yaml，然后重启。'
  const evRemote = await gatherEvidence(extractClaims(scanAnswer(remoteText).findings, { text: remoteText }), cfg,
    { online: false, probedAt: Date.now(), latencyMs: 0 }, 'C:/work/dsh-doubt')
  // the meaningful assertion: a remote-context path must not end up REFUTED
  const remoteNotRefuted = evRemote.filter((e) => e.kind === 'path').every((e) => e.verdict !== 'refuted')
  const ok = stillRefutes && methodCallSilent && remoteNotRefuted
  record('silence-only guards stay monotone', ok ? 'PASS' : 'FAIL',
    `local missing path still refuted=${stillRefutes} | method call silenced=${methodCallSilent} | remote-context path not refuted=${remoteNotRefuted}`)
}

console.log('')
const failed = rows.filter((r) => r.status === 'FAIL')
console.log(`${rows.filter((r) => r.status === 'PASS').length} PASS, ${failed.length} FAIL, ${rows.filter((r) => r.status === 'SKIP').length} SKIP`)
if (failed.length) { console.log('FAILED: ' + failed.map((f) => f.name).join(' | ')); process.exit(1) }
