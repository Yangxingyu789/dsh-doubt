/**
 * 断言执行器：把「我觉得是这样」变成「跑出来是这样」。
 *
 * 安全边界：
 * - command 走 argv 数组、**不经过 shell**（Windows 下需要 .cmd 包装时按参数逐个转义）
 * - 程序名命中 denyBinaries 直接拒绝
 * - 每条 check 都有超时与输出上限
 * - expr 在空沙箱 context 里跑，没有 require / process / globalThis
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import vm from 'node:vm'

export type CheckKind = 'command' | 'fileExists' | 'fileMatch' | 'httpStatus' | 'expr' | 'textEquals'

export interface Check {
  kind: CheckKind
  /** 断言原文，回填给模型看 */
  claim?: string
  /** command：程序 + 参数（不经过 shell） */
  argv?: string[]
  /** command：期望退出码，默认 0 */
  expectExit?: number
  /** command / expr：输出需包含的子串 */
  expectMatch?: string
  /** command / expr：输出需匹配的正则 */
  expectRegex?: string
  /** fileExists / fileMatch */
  path?: string
  /** fileMatch：文件内容需匹配的正则 */
  regex?: string
  /** httpStatus */
  url?: string
  /** httpStatus：期望状态码，默认 2xx */
  expectStatus?: number
  /** expr：要求值的 JS 表达式/语句 */
  source?: string
  /** textEquals */
  actual?: string
  expected?: string
  /** 单条超时覆盖 */
  timeoutMs?: number
}

export interface CheckOutcome {
  ok: boolean
  kind: string
  claim?: string
  detail: string
}

export interface RunOptions {
  timeoutMs: number
  denyBinaries: readonly string[]
  cwd?: string
}

const OUTPUT_MAX = 4000

function clip(s: string): string {
  const t = String(s ?? '')
  return t.length > OUTPUT_MAX ? `${t.slice(0, OUTPUT_MAX)}\n…（已截断）` : t
}

function baseName(bin: string): string {
  const cleaned = bin.replace(/"/g, '').trim()
  const parts = cleaned.split(/[\\/]/)
  return (parts[parts.length - 1] ?? cleaned).toLowerCase()
}

function matchExpect(text: string, check: Check): { ok: boolean; why: string } {
  if (check.expectMatch) {
    const ok = text.includes(check.expectMatch)
    return { ok, why: ok ? `输出包含 "${check.expectMatch}"` : `输出不含 "${check.expectMatch}"` }
  }
  if (check.expectRegex) {
    let re: RegExp
    try {
      re = new RegExp(check.expectRegex)
    } catch (e) {
      return { ok: false, why: `expectRegex 非法：${String(e)}` }
    }
    const ok = re.test(text)
    return { ok, why: ok ? `输出匹配 /${check.expectRegex}/` : `输出不匹配 /${check.expectRegex}/` }
  }
  return { ok: true, why: '退出码符合预期' }
}

/** Windows 下把参数按 msvcrt/cmd 规则转义，避免 shell 元字符注入 */
function winQuote(arg: string): string {
  if (arg === '') return '""'
  if (!/[\s"^&|<>()%!]/.test(arg)) return arg
  const escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')
  return `"${escaped}"`
}

async function runCommand(check: Check, opts: RunOptions): Promise<CheckOutcome> {
  const argv = Array.isArray(check.argv) ? check.argv.filter((a) => typeof a === 'string') : []
  if (argv.length === 0) return { ok: false, kind: 'command', claim: check.claim, detail: 'argv 为空：需要 [程序, 参数...]' }
  const bin = argv[0] ?? ''
  const name = baseName(bin)
  if (opts.denyBinaries.includes(name)) {
    return { ok: false, kind: 'command', claim: check.claim, detail: `拒绝执行被禁止的程序：${bin}` }
  }
  const expectExit = Number.isFinite(check.expectExit) ? Number(check.expectExit) : 0
  const timeoutMs = Number.isFinite(check.timeoutMs) ? Number(check.timeoutMs) : opts.timeoutMs

  const isWin = process.platform === 'win32'
  const needsCmd = isWin && /\.(cmd|bat)$/.test(name)

  const child = needsCmd
    ? spawn('cmd.exe', ['/d', '/s', '/c', [bin, ...argv.slice(1)].map(winQuote).join(' ')], {
        cwd: opts.cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : spawn(bin, argv.slice(1), { cwd: opts.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

  let stdout = ''
  let stderr = ''
  child.stdout?.on('data', (d) => { if (stdout.length < OUTPUT_MAX * 2) stdout += String(d) })
  child.stderr?.on('data', (d) => { if (stderr.length < OUTPUT_MAX * 2) stderr += String(d) })

  const settled = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error }>((resolve) => {
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch { /* ignore */ } }, timeoutMs)
    child.once('error', (error) => { clearTimeout(timer); resolve({ code: null, signal: null, error }) })
    child.once('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }) })
  })

  const head = `$ ${argv.join(' ')}`
  if (settled.error) {
    return { ok: false, kind: 'command', claim: check.claim, detail: `${head}\n启动失败：${settled.error.message}` }
  }
  if (settled.signal) {
    return { ok: false, kind: 'command', claim: check.claim, detail: `${head}\n超时 ${timeoutMs}ms 被终止（${settled.signal}）` }
  }
  const code = settled.code ?? -1
  const body = `退出码 ${code}\nstdout: ${clip(stdout.trim()) || '(空)'}\nstderr: ${clip(stderr.trim()) || '(空)'}`
  const exitOk = code === expectExit
  const contentOk = matchExpect(`${stdout}\n${stderr}`, check)
  const ok = exitOk && contentOk.ok
  const why = exitOk ? contentOk.why : `期望退出码 ${expectExit}，实际 ${code}`
  return { ok, kind: 'command', claim: check.claim, detail: `${head}\n判定：${why}\n${body}` }
}

function runFileExists(check: Check): CheckOutcome {
  const p = String(check.path ?? '')
  if (!p) return { ok: false, kind: 'fileExists', claim: check.claim, detail: 'path 为空' }
  if (!existsSync(p)) return { ok: false, kind: 'fileExists', claim: check.claim, detail: `不存在：${p}` }
  const st = statSync(p)
  return { ok: true, kind: 'fileExists', claim: check.claim, detail: `存在：${p}（${st.isDirectory() ? '目录' : `${st.size} 字节`}）` }
}

function runFileMatch(check: Check): CheckOutcome {
  const p = String(check.path ?? '')
  if (!p || !existsSync(p)) return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `文件不存在：${p || '(path 为空)'}` }
  let re: RegExp
  try {
    re = new RegExp(String(check.regex ?? ''))
  } catch (e) {
    return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `regex 非法：${String(e)}` }
  }
  const text = readFileSync(p, 'utf8')
  const m = re.exec(text)
  if (!m) return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `${p} 不匹配 /${check.regex}/` }
  const line = text.slice(0, m.index).split('\n').length
  return { ok: true, kind: 'fileMatch', claim: check.claim, detail: `${p}:${line} 匹配 /${check.regex}/ → ${clip(m[0])}` }
}

async function runHttp(check: Check): Promise<CheckOutcome> {
  const url = String(check.url ?? '')
  if (!/^https?:\/\//i.test(url)) return { ok: false, kind: 'httpStatus', claim: check.claim, detail: `url 非法：${url || '(空)'}` }
  const want = Number.isFinite(check.expectStatus) ? Number(check.expectStatus) : undefined
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10_000) })
    const ok = want === undefined ? res.status >= 200 && res.status < 300 : res.status === want
    return { ok, kind: 'httpStatus', claim: check.claim, detail: `${url} → HTTP ${res.status}（期望 ${want ?? '2xx'}）` }
  } catch (e) {
    return { ok: false, kind: 'httpStatus', claim: check.claim, detail: `${url} 请求失败：${String(e instanceof Error ? e.message : e)}` }
  }
}

function runExpr(check: Check, opts: RunOptions): CheckOutcome {
  const source = String(check.source ?? '')
  if (!source) return { ok: false, kind: 'expr', claim: check.claim, detail: 'source 为空' }
  let value: unknown
  try {
    value = vm.runInNewContext(`(${source})`, Object.create(null), {
      timeout: Number.isFinite(check.timeoutMs) ? Number(check.timeoutMs) : opts.timeoutMs,
    })
  } catch (e) {
    return { ok: false, kind: 'expr', claim: check.claim, detail: `求值失败：${String(e instanceof Error ? e.message : e)}` }
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
  const verdict = matchExpect(text, check)
  return { ok: verdict.ok, kind: 'expr', claim: check.claim, detail: `${source} → ${clip(text)}\n判定：${verdict.why}` }
}

function runTextEquals(check: Check): CheckOutcome {
  const actual = String(check.actual ?? '')
  const expected = String(check.expected ?? '')
  const ok = actual.trim() === expected.trim()
  return { ok, kind: 'textEquals', claim: check.claim, detail: ok ? '一致' : `不一致\nactual:   ${clip(actual)}\nexpected: ${clip(expected)}` }
}

export async function runCheck(check: Check, opts: RunOptions): Promise<CheckOutcome> {
  switch (check.kind) {
    case 'command': return runCommand(check, opts)
    case 'fileExists': return runFileExists(check)
    case 'fileMatch': return runFileMatch(check)
    case 'httpStatus': return runHttp(check)
    case 'expr': return runExpr(check, opts)
    case 'textEquals': return runTextEquals(check)
    default: return { ok: false, kind: String(check?.kind ?? 'unknown'), claim: check?.claim, detail: `未知 check.kind：${String(check?.kind)}` }
  }
}

export async function runChecks(checks: readonly Check[], opts: RunOptions): Promise<CheckOutcome[]> {
  const out: CheckOutcome[] = []
  for (const c of checks) out.push(await runCheck(c, opts))
  return out
}
