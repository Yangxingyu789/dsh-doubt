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
import { readFileSync, statSync } from 'node:fs'
import vm from 'node:vm'
import { commandAvailability, packageVersion, symbolExists, versionClaim, type OracleResult } from './local.js'

export type CheckKind =
  | 'command' | 'fileExists' | 'fileMatch' | 'httpStatus' | 'expr' | 'textEquals'
  /** 本机确定性 oracle（不执行任意命令，只查存在性/版本/符号） */
  | 'commandAvailability' | 'packageVersion' | 'versionClaim' | 'symbolExists'

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
  /**
   * symbolExists：要查找的符号签名。
   * 必须与 `claim` 分开写——否则「描述这条断言」和「要查的符号」会挤在同一个字段里，
   * 实测活体调用时 `claim` 的整句话被当成符号名去搜，必然搜不到。
   */
  signature?: string
  /** textEquals */
  actual?: string
  expected?: string
  /** packageVersion / versionClaim：包名 */
  name?: string
  /** 本机 oracle 的查找起点，默认 process.cwd() */
  cwd?: string
  /** 禁止联网来源：语境不足以确认这是 npm 包/版本时置 true */
  noRegistry?: boolean
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

/** Windows 可执行扩展名。denyBinaries 里写的是不带扩展名的名字（rm / del / format），
 *  所以比对前必须剥掉扩展名，否则 `reg.exe`、`schtasks.exe`、`format.com` 全部绕过黑名单
 *  —— 实测这三条都能真的执行（`C:\Windows\System32\*` 里确实存在这些文件），
 *  连把 where.exe 复制成 del.exe 都能跑起来。 */
const WIN_EXEC_EXTS = ['.exe', '.com', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.msc', '.scr', '.pif']
function denyName(bin: string): string {
  const base = baseName(bin)
  for (const ext of WIN_EXEC_EXTS) {
    if (base.length > ext.length && base.endsWith(ext)) return base.slice(0, -ext.length)
  }
  return base
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
  if (opts.denyBinaries.includes(denyName(bin))) {
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

  const settled = await new Promise<{ code: number | null; signal: NodeJS.Signals | null; error?: Error; forced?: boolean }>((resolve) => {
    let done = false
    let hardTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (v: { code: number | null; signal: NodeJS.Signals | null; error?: Error; forced?: boolean }): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      if (hardTimer) clearTimeout(hardTimer)
      resolve(v)
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      // Windows 上 SIGKILL 只作用于直接子进程。`npm.cmd` 这类包装会留下 cmd.exe 的孙进程，
      // 它们继承着 stdout 管道 → 'close' 永远不来 → runCheck 永不返回（实测只能靠外部 kill）。
      // 所以整棵树都要杀，并且给一个硬期限，到点就如实按「超时」结算，绝不无限等。
      if (process.platform === 'win32' && child.pid) {
        try {
          spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
        } catch { /* ignore */ }
      }
      hardTimer = setTimeout(() => finish({ code: null, signal: 'SIGKILL' as NodeJS.Signals, forced: true }), 2000)
    }, timeoutMs)
    child.once('error', (error) => finish({ code: null, signal: null, error }))
    child.once('close', (code, signal) => finish({ code, signal }))
  })

  const head = `$ ${argv.join(' ')}`
  if (settled.error) {
    return { ok: false, kind: 'command', claim: check.claim, detail: `${head}\n启动失败：${settled.error.message}` }
  }
  if (settled.signal) {
    const extra = settled.forced ? '；进程树未在 2s 内退出，已放弃等待（输出可能不完整）' : ''
    return { ok: false, kind: 'command', claim: check.claim, detail: `${head}\n超时 ${timeoutMs}ms 被终止（${settled.signal}）${extra}` }
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
  // 与 evidence.ts 的本机 oracle 保持同一判定：existsSync 会把「没权限 stat」也当成不存在。
  // `C:\pagefile.sys` 实测 Test-Path 为真而 existsSync 为假 —— 直接回「不存在」就是在
  // 说假话，而这正是这个工具存在的意义。只有 ENOENT/ENOTDIR 才算不存在。
  try {
    const st = statSync(p)
    return { ok: true, kind: 'fileExists', claim: check.claim, detail: `存在：${p}（${st.isDirectory() ? '目录' : `${st.size} 字节`}）` }
  } catch (e) {
    const code = (e as { code?: string })?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { ok: false, kind: 'fileExists', claim: check.claim, detail: `不存在：${p}` }
    }
    return { ok: false, kind: 'fileExists', claim: check.claim, detail: `无法判定 ${p}：stat 失败 ${code ?? String(e)}（不是「不存在」，别据此下结论）` }
  }
}

/** 单文件读取上限：模型可以指定任意路径，无上限的 readFileSync 会把宿主内存打爆 */
const FILE_MATCH_MAX_BYTES = 32 * 1024 * 1024
/** 正则求值的独立预算：灾难性回溯要把事件循环卡住，必须有个硬上限 */
const REGEX_BUDGET_MS = 3000

function runFileMatch(check: Check): CheckOutcome {
  const p = String(check.path ?? '')
  if (!p) return { ok: false, kind: 'fileMatch', claim: check.claim, detail: 'path 为空' }
  const pattern = String(check.regex ?? '')
  // 空正则 / `^` 之类对任何文件都匹配 → 返回 ok:true 等于什么都没断言（实测空 regex 也是 ok:true）
  if (!pattern) return { ok: false, kind: 'fileMatch', claim: check.claim, detail: 'regex 为空：没有断言任何内容，不算通过' }
  let text: string
  try {
    const st = statSync(p)
    if (!st.isFile()) return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `不是普通文件：${p}` }
    if (st.size > FILE_MATCH_MAX_BYTES) {
      return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `${p} 有 ${st.size} 字节，超过 ${FILE_MATCH_MAX_BYTES} 字节上限，未读取` }
    }
    text = readFileSync(p, 'utf8')
  } catch (e) {
    const code = (e as { code?: string })?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `文件不存在：${p}` }
    return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `无法判定 ${p}：读取失败 ${code ?? String(e)}（不是「不存在」）` }
  }
  // 正则放在 vm 里跑并给一个 timeout：`(a+)+$` 这类灾难性回溯实测能让 re.exec 跑 90 秒，
  // 期间整个事件循环停摆（timeoutMs 对原生 re.exec 完全无效）。
  // 实测 vm 的 timeout **能**中断正则回溯（约等于预算值返回，不挂死）。
  let m: { index: number; text: string } | null
  try {
    m = vm.runInNewContext(
      'const re = new RegExp(P); const r = re.exec(H); r ? { index: r.index, text: r[0] } : null',
      { P: pattern, H: text },
      { timeout: Math.min(REGEX_BUDGET_MS, 3000) },
    ) as { index: number; text: string } | null
  } catch (e) {
    const msg = String(e instanceof Error ? e.message : e)
    if (/timed out/i.test(msg)) {
      return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `/${pattern}/ 在 ${p} 上超过 ${REGEX_BUDGET_MS}ms 预算（疑似灾难性回溯），未得出结论` }
    }
    return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `regex 非法：${msg}` }
  }
  if (!m) return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `${p} 不匹配 /${pattern}/` }
  const line = text.slice(0, m.index).split('\n').length
  return { ok: true, kind: 'fileMatch', claim: check.claim, detail: `${p}:${line} 匹配 /${pattern}/ → ${clip(m.text)}` }
}

async function runHttp(check: Check, opts: RunOptions): Promise<CheckOutcome> {
  const url = String(check.url ?? '')
  if (!/^https?:\/\//i.test(url)) return { ok: false, kind: 'httpStatus', claim: check.claim, detail: `url 非法：${url || '(空)'}` }
  const want = Number.isFinite(check.expectStatus) ? Number(check.expectStatus) : undefined
  try {
    const budget = Number.isFinite(check.timeoutMs) ? Number(check.timeoutMs) : opts.timeoutMs
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(budget) })
    const ok = want === undefined ? res.status >= 200 && res.status < 300 : res.status === want
    return { ok, kind: 'httpStatus', claim: check.claim, detail: `${url} → HTTP ${res.status}（期望 ${want ?? '2xx'}）` }
  } catch (e) {
    return { ok: false, kind: 'httpStatus', claim: check.claim, detail: `${url} 请求失败：${String(e instanceof Error ? e.message : e)}` }
  }
}

/**
 * `expr` 的求值器在**子进程**里跑，而且**所有**对求值结果的操作都在 vm 内部完成。
 *
 * 为什么必须这样（独立验证者实测证伪了上一版修法）：
 *  - 上一版在 vm 返回之后，由**宿主**去读 `value.then` 和 `JSON.stringify(value)`。
 *    这两次读取都在 vm 的 timeout **之外**，于是
 *    `({ get then() { for (;;) {} } })`、`({ toJSON() { for (;;) {} } })` 会把宿主**挂死**。
 *  - 表达式里**丢掉**的 rejection 仍会按 Node 默认策略打死进程，而且是在 runCheck
 *    已经返回 ok:true 之后 —— `(() => { Promise.reject(new Error('x')); return 'looks-fine' })()`
 *    配合 expectMatch 会「先报通过、再把宿主干掉」。
 *  - timeout 只能约束 vm 内部，所以正确做法是：把取值/判 thenable/序列化全部放进 vm；
 *    再让子进程承受崩溃与死循环，宿主只拿一个纯字符串回来。
 */
const EXPR_RUNNER = String.raw`
import vm from 'node:vm'
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => { input += d })
process.stdin.on('end', () => {
  let out
  try {
    const req = JSON.parse(input)
    const program = '(function(){ var v = (' + req.source + ');'
      + ' if (v !== null && (typeof v === "object" || typeof v === "function") && typeof v.then === "function") return "\\u0000PROMISE";'
      + ' if (typeof v === "string") return v;'
      + ' try { var s = JSON.stringify(v); return s === undefined ? String(v) : s } catch (e) { return String(v) } })()'
    const text = vm.runInNewContext(program, Object.create(null), { timeout: req.timeoutMs, microtaskMode: 'afterEvaluate' })
    out = { ok: true, text: String(text) }
  } catch (e) {
    out = { ok: false, error: String(e && e.message ? e.message : e) }
  }
  try { process.stdout.write(JSON.stringify(out)) } catch { /* ignore */ }
  // 表达式里丢掉的 rejection 会打死这个子进程；结果已经写完，直接退出即可，
  // 让宿主拿到确定性的答案而不是「结果 + 崩溃」。
  process.exit(0)
})
`

function runExprChild(source: string, timeoutMs: number): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(process.execPath, ['--input-type=module', '-e', EXPR_RUNNER], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    } catch (e) {
      resolve({ ok: false, error: `无法启动求值子进程：${String(e)}` })
      return
    }
    let out = ''
    let done = false
    let hardTimer: ReturnType<typeof setTimeout> | undefined
    const finish = (v: { ok: true; text: string } | { ok: false; error: string }): void => {
      if (done) return
      done = true
      if (hardTimer) clearTimeout(hardTimer)
      try { child.kill('SIGKILL') } catch { /* ignore */ }
      resolve(v)
    }
    try { child.stdin?.end(JSON.stringify({ source, timeoutMs })) } catch { /* ignore */ }
    child.stdout?.on('data', (d) => { if (out.length < 200_000) out += String(d) })
    hardTimer = setTimeout(() => finish({ ok: false, error: `expr 子进程超过 ${timeoutMs + 2000}ms 未返回，已终止（载荷疑似死循环）` }), timeoutMs + 2000)
    child.once('error', (e) => finish({ ok: false, error: `求值子进程启动失败：${e.message}` }))
    child.once('close', (code) => {
      if (done) return
      if (code !== 0) { finish({ ok: false, error: `求值子进程异常退出（code ${code}）` }); return }
      try {
        const parsed = JSON.parse(out || '{}') as { ok?: boolean; text?: unknown; error?: unknown }
        if (parsed.ok) finish({ ok: true, text: String(parsed.text ?? '') })
        else finish({ ok: false, error: `求值失败：${String(parsed.error ?? '未知错误')}` })
      } catch {
        finish({ ok: false, error: '求值子进程输出无法解析' })
      }
    })
  })
}

async function runExpr(check: Check, opts: RunOptions): Promise<CheckOutcome> {
  const source = String(check.source ?? '')
  if (!source) return { ok: false, kind: 'expr', claim: check.claim, detail: 'source 为空' }
  const want = Number.isFinite(check.timeoutMs) ? Number(check.timeoutMs) : opts.timeoutMs
  const budget = Math.min(Math.max(want, 50), 10_000)
  const res = await runExprChild(source, budget)
  if (!res.ok) {
    return { ok: false, kind: 'expr', claim: check.claim, detail: `${source} ${res.error}` }
  }
  if (res.text === '\u0000PROMISE') {
    return {
      ok: false,
      kind: 'expr',
      claim: check.claim,
      detail: `${source} 返回了 Promise：expr 只做同步求值，异步结果无法核验（已丢弃，未等待）`,
    }
  }
  const text = res.text
  // expr 没有「退出码」这个概念，所以必须显式给出期望，否则等于什么都没断言。
  // 实测 `{ kind:'expr', source:'1 === 2' }` 曾返回 ok:true（假成功），
  // 模型可以靠一串空检查凑出「全部通过」的伪证据。
  if (!check.expectMatch && !check.expectRegex) {
    return { ok: false, kind: 'expr', claim: check.claim, detail: `${source} → ${clip(text)}\n没有给出 expectMatch / expectRegex：expr 无法自行判定，不算通过` }
  }
  const verdict = matchExpect(text, check)
  return { ok: verdict.ok, kind: 'expr', claim: check.claim, detail: `${source} → ${clip(text)}\n判定：${verdict.why}` }
}

function runTextEquals(check: Check): CheckOutcome {
  const actual = String(check.actual ?? '')
  const expected = String(check.expected ?? '')
  // 两边都空时必须判失败：`{kind:'textEquals'}` 曾返回 ok:true「一致」——又是空检查假成功
  if (actual.trim() === '' && expected.trim() === '') {
    return { ok: false, kind: 'textEquals', claim: check.claim, detail: 'actual 与 expected 都为空：没有断言任何内容，不算通过' }
  }
  const ok = actual.trim() === expected.trim()
  return { ok, kind: 'textEquals', claim: check.claim, detail: ok ? '一致' : `不一致\nactual:   ${clip(actual)}\nexpected: ${clip(expected)}` }
}

/** 本机 oracle 结果 → 统一判定（detail 里带来源标签） */
function oracleOutcome(r: OracleResult): CheckOutcome {
  if (r.noEvidence) {
    return { ok: false, kind: r.kind, claim: r.claim, detail: r.detail || '本机没有可比的来源' }
  }
  // 只有弱证据（命中但不是定义/安装位置）时不得报「通过」：
  // 「package.json 声明了依赖」曾被当成「包已安装」的证据，工具回 ok:true。
  const strong = r.sources.filter((s) => s.ok && !s.weak).length
  if (strong === 0) {
    return { ok: false, kind: r.kind, claim: r.claim, detail: `${r.detail}\n（只有弱证据，不能算通过）` }
  }
  return { ok: r.ok, kind: r.kind, claim: r.claim, detail: r.detail }
}

export async function runCheck(check: Check, opts: RunOptions): Promise<CheckOutcome> {
  const cwd = String(check.cwd ?? opts.cwd ?? process.cwd())
  switch (check.kind) {
    case 'command': return runCommand(check, opts)
    case 'fileExists': return runFileExists(check)
    case 'fileMatch': return runFileMatch(check)
    case 'httpStatus': return runHttp(check, opts)
    case 'expr': return runExpr(check, opts)
    case 'textEquals': return runTextEquals(check)
    case 'commandAvailability': return oracleOutcome(commandAvailability(String(check.claim ?? check.argv?.join(' ') ?? ''), check.argv ?? []))
    case 'packageVersion': return oracleOutcome(packageVersion(String(check.claim ?? check.name ?? ''), String(check.name ?? ''), cwd))
    case 'versionClaim': return oracleOutcome(versionClaim(String(check.claim ?? check.expected ?? ''), cwd, check.name))
    case 'symbolExists': return oracleOutcome(symbolExists(String(check.signature ?? check.claim ?? check.source ?? ''), cwd))
    default: return { ok: false, kind: String(check?.kind ?? 'unknown'), claim: check?.claim, detail: `未知 check.kind：${String(check?.kind)}` }
  }
}

export async function runChecks(checks: readonly Check[], opts: RunOptions): Promise<CheckOutcome[]> {
  const out: CheckOutcome[] = []
  for (const c of checks) out.push(await runCheck(c, opts))
  return out
}
