/**
 * Tier A：本机确定性 oracle（完全离线可用）。
 *
 * 原则：**机器是裁判，不是模型的记忆**。每个判定都带来源标签，
 * 便于上层要求「多个互相独立的来源一致」才算 confirmed。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 插件自己所在的包根：符号扫描必须排除它，否则插件会拿自己写的代码给自己背书 */
function selfPackageRoot(): string {
  try {
    return walkUp(dirname(fileURLToPath(import.meta.url)), (d) => existsSync(join(d, 'package.json'))) ?? ''
  } catch {
    return ''
  }
}

export interface SourceHit {
  /** 来源标签，例如 node_modules/x/package.json */
  label: string
  /** 该来源给出的值 */
  value: string
  /** 该来源是否支持断言 */
  ok: boolean
  /** 弱证据：命中但不是声明/定义位置，不能单独支撑 confirmed */
  weak?: boolean
}

export interface OracleResult {
  kind: string
  claim: string
  /** 至少一个来源支持 */
  ok: boolean
  /** 没有任何来源可判 */
  noEvidence: boolean
  sources: SourceHit[]
  detail: string
}

function noEvidence(kind: string, claim: string, why: string): OracleResult {
  return { kind, claim, ok: false, noEvidence: true, sources: [], detail: why }
}

/** 从版本断言里猜包名：连接词必须排除，否则会去 node_modules/version 找不到而假证伪 */
const PKG_STOPWORDS = new Set(['version', 'versions', 'ver', 'v', 'to', 'at', 'is', 'in', 'and', 'or', 'the', 'from', 'with', 'requires', 'require', 'using', 'use', 'installed', 'install', 'latest', 'current'])
const PKG_HINT_RE = /^(@?[\w@/.-]+)\s+\d+\.\d+/
function hintName(claim: string): string {
  const raw = PKG_HINT_RE.exec(claim.trim())?.[1] ?? ''
  const bare = raw.replace(/^@?([\w.-]+)\/?/, '$1')
  if (!raw || PKG_STOPWORDS.has(raw.toLowerCase()) || PKG_STOPWORDS.has(bare.toLowerCase())) return ''
  return raw
}

function summarize(kind: string, claim: string, sources: SourceHit[]): OracleResult {
  const supporting = sources.filter((s) => s.ok)
  const detail = sources.map((s) => `${s.ok ? '✓' : '✗'} [${s.label}] ${s.value}`).join('\n')
  return { kind, claim, ok: supporting.length > 0, noEvidence: sources.length === 0, sources, detail }
}

/** 从 start 向上找满足条件的目录 */
function walkUp(start: string, visit: (dir: string) => boolean): string | null {
  let dir = resolve(start)
  for (let i = 0; i < 12; i += 1) {
    if (visit(dir)) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function readJson(path: string): any | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

/** 本机可执行文件查找（PATH + PATHEXT），不执行 */
export function which(bin: string): string | null {
  const cleaned = bin.replace(/"/g, '').trim()
  if (!cleaned) return null
  if (cleaned.includes('/') || cleaned.includes('\\')) {
    const direct = resolve(cleaned)
    if (existsSync(direct) && statSync(direct).isFile()) return direct
  }
  const pathVar = process.env.PATH ?? process.env.Path ?? ''
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';')
    : ['']
  for (const dir of pathVar.split(process.platform === 'win32' ? ';' : ':')) {
    if (!dir) continue
    for (const ext of exts) {
      const cand = join(dir, cleaned + ext.toLowerCase())
      const cand2 = join(dir, cleaned + ext)
      for (const c of [cand, cand2]) {
        try {
          if (existsSync(c) && statSync(c).isFile()) return c
        } catch { /* ignore */ }
      }
    }
  }
  return null
}

/** 命令里的程序是否存在（默认不执行回答里的命令） */
export function commandAvailability(claim: string, argv: readonly string[]): OracleResult {
  const bin = argv[0] ?? ''
  if (!bin) return noEvidence('commandAvailability', claim, '空命令')
  const found = which(bin)
  const sources: SourceHit[] = [{
    label: 'PATH/PATHEXT',
    value: found ? `${bin} → ${found}` : `${bin} 不在 PATH 中`,
    ok: Boolean(found),
  }]
  return summarize('commandAvailability', claim, sources)
}

/** 包是否已安装 + 安装版本 + 声明范围（三个互相独立的本地来源） */
export function packageVersion(claim: string, name: string, cwd: string): OracleResult {
  const bare = name.replace(/^`|`$/g, '').replace(/@[~^]?\d[\w.-]*$/, '')
  const sources: SourceHit[] = []

  const nmDir = walkUp(cwd, (d) => existsSync(join(d, 'node_modules')))
  if (nmDir) {
    const pkgJson = join(nmDir, 'node_modules', bare, 'package.json')
    const meta = readJson(pkgJson)
    if (meta?.version) {
      sources.push({ label: `node_modules/${bare}/package.json`, value: `已安装 ${meta.version}`, ok: true })
    } else {
      // 本机没装 ≠ 回答错了：回答可能只是提到这个包，或说的是另一台机器/另一个仓库
      sources.push({ label: `node_modules/${bare}`, value: `本机（${nmDir}）未安装`, ok: false, weak: true })
    }
  } else {
    sources.push({ label: 'node_modules', value: `从 ${cwd} 向上找不到 node_modules`, ok: false, weak: true })
  }

  const declared = walkUp(cwd, (d) => existsSync(join(d, 'package.json')))
  if (declared) {
    const pkg = readJson(join(declared, 'package.json')) ?? {}
    const fields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const
    let range: string | undefined
    for (const f of fields) range ??= pkg[f]?.[bare]
    if (range) sources.push({ label: join(declared, 'package.json'), value: `声明范围 ${range}`, ok: true })
  }

  if (!sources.some((s) => s.ok)) return noEvidence('packageVersion', claim, `本机没有该包（${bare}）；除非回答断言它装在本机，否则不构成反驳`)
  return summarize('packageVersion', claim, sources)
}

/** 在 node_modules 里找有没有任何包正好是这个版本（用于没定位到包名时） */
function findInstalledByVersion(root: string, version: string): string | null {
  const nmRoot = walkUp(root, (d) => existsSync(join(d, 'node_modules')))
  if (!nmRoot) return null
  const base = join(nmRoot, 'node_modules')
  const check = (dir: string, label: string): string | null => {
    const meta = readJson(join(dir, 'package.json'))
    if (meta?.version === version) return label
    return null
  }
  let entries: string[]
  try {
    entries = readdirSync(base)
  } catch {
    return null
  }
  for (const entry of entries.slice(0, 800)) {
    if (entry.startsWith('.')) continue
    const full = join(base, entry)
    if (entry.startsWith('@')) {
      let scoped: string[]
      try {
        scoped = readdirSync(full)
      } catch {
        continue
      }
      for (const s of scoped.slice(0, 200)) {
        const hit = check(join(full, s), `${entry}/${s}`)
        if (hit) return hit
      }
      continue
    }
    const hit = check(full, entry)
    if (hit) return hit
  }
  return null
}

/** 版本比较：按 [major, minor, patch] 数值比 */
function parseVer(v: string): number[] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function cmp(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
  }
  return 0
}

/**
 * 声明范围是否被该版本满足。返回 undefined 表示无法判断（不得当成反驳）。
 * 覆盖 `*` / `x` / 精确 / `^` / `~` / `>= > < <=` / `||`；其余协议一律中性。
 */
export function rangeSatisfied(range: string, version: string): boolean | undefined {
  const v = parseVer(version)
  if (!v) return undefined
  const r = range.trim()
  if (!r) return undefined
  if (r === '*' || r === 'latest') return true
  if (/^(workspace:|file:|link:|npm:)/.test(r)) return undefined

  for (const part of r.split('||')) {
    const sat = satisfiesPart(part.trim(), v)
    if (sat === true) return true
    if (sat === undefined) return undefined
  }
  return false
}

/** 宽松解析：允许 `4` / `4.1` / `4.x` 这类缺位写法，缺的补 0 */
function parseLoose(v: string): number[] | null {
  const m = /^(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:[-+][\w.]+)?$/.exec(v.trim())
  if (!m) return null
  return [Number(m[1]), m[2] && /^\d+$/.test(m[2]) ? Number(m[2]) : 0, m[3] && /^\d+$/.test(m[3]) ? Number(m[3]) : 0]
}

function satisfiesPart(part: string, v: number[]): boolean | undefined {
  if (!part || part === '*' || part === 'x') return true
  const op = /^(>=|<=|>|<|=)\s*/.exec(part)
  if (op) {
    const target = parseLoose(part.slice(op[0].length))
    if (!target) return undefined
    const c = cmp(v, target)
    switch (op[1]) {
      case '>=': return c >= 0
      case '<=': return c <= 0
      case '>': return c > 0
      case '<': return c < 0
      default: return c === 0
    }
  }
  const caret = /^\^\s*(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(part)
  if (caret) {
    const major = Number(caret[1])
    const minorRaw = caret[2]
    const target = parseLoose(`${major}.${minorRaw && /^\d+$/.test(minorRaw) ? minorRaw : 0}.${caret[3] && /^\d+$/.test(caret[3]) ? caret[3] : 0}`)
    if (!target) return undefined
    if (cmp(v, target) < 0) return false
    // caret 不改动最左边的非零位
    if (major > 0) return v[0] === major
    if (target[1] > 0) return v[0] === 0 && v[1] === target[1]
    return v[0] === 0 && v[1] === target[1] && v[2] === target[2]
  }
  const tilde = /^~\s*(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(part)
  if (tilde) {
    const major = Number(tilde[1])
    const minorRaw = tilde[2]
    if (minorRaw === undefined || minorRaw === 'x' || minorRaw === '*') return v[0] === major
    const minor = Number(minorRaw)
    const patchRaw = tilde[3]
    if (patchRaw === undefined || patchRaw === 'x' || patchRaw === '*') return v[0] === major && v[1] === minor
    const target = parseVer(`${major}.${minor}.${Number(patchRaw)}`)
    if (!target) return undefined
    return v[0] === major && v[1] === minor && cmp(v, target) >= 0
  }
  // `5.x` / `5.9.x` / 精确
  const xr = /^(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(part)
  if (xr) {
    if (Number(xr[1]) !== v[0]) return false
    if (xr[2] === undefined || xr[2] === 'x' || xr[2] === '*') return true
    if (Number(xr[2]) !== v[1]) return false
    if (xr[3] === undefined || xr[3] === 'x' || xr[3] === '*') return true
    return Number(xr[3]) === v[2]
  }
  return undefined
}

/** 版本断言：把断言里的版本号和可比来源比对；**定位不到包名时不猜测、不反驳** */
export function versionClaim(claim: string, cwd: string, name?: string): OracleResult {
  const m = /(v?\d+\.\d+(?:\.\d+)?)/.exec(claim)
  const claimed = m?.[1]?.replace(/^v/, '')
  if (!claimed) return noEvidence('versionClaim', claim, '断言里读不出具体版本号')

  const sources: SourceHit[] = []
  const rootPkg = readJson(join(cwd, 'package.json'))
  const rootName: string = rootPkg?.name ?? ''
  const pkgName = name || hintName(claim)

  if (pkgName) {
    const nmDir = walkUp(cwd, (d) => existsSync(join(d, 'node_modules', pkgName, 'package.json')))
    if (nmDir) {
      const v = readJson(join(nmDir, 'node_modules', pkgName, 'package.json'))?.version
      if (v) sources.push({ label: `node_modules/${pkgName}`, value: `实际 ${v}，断言 ${claimed}`, ok: v === claimed })
    }
    if (rootName && rootName === pkgName && rootPkg?.version) {
      sources.push({ label: '本包 package.json', value: `实际 ${rootPkg.version}，断言 ${claimed}`, ok: rootPkg.version === claimed })
    }
    const declared = walkUp(cwd, (d) => existsSync(join(d, 'package.json')))
    if (declared) {
      const pkg = readJson(join(declared, 'package.json')) ?? {}
      let range: string | undefined
      for (const f of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const) range ??= pkg[f]?.[pkgName]
      if (range) {
        const sat = rangeSatisfied(range, claimed)
        sources.push({
          label: join(declared, 'package.json'),
          value: sat === undefined
            ? `声明范围 ${range}（无法判断是否覆盖 ${claimed}）`
            : `声明范围 ${range}，断言 ${claimed}${sat ? '（满足）' : '（不满足）'}`,
          ok: sat === true,
          weak: sat === undefined,
        })
      }
    }
    if (sources.length === 0) return noEvidence('versionClaim', claim, `本机找不到包 ${pkgName}，无法判断版本 ${claimed}`)
    return summarize('versionClaim', claim, sources)
  }

  // 没定位到包名：只问「本机有没有任何包是这个版本」，找不到就承认无法判断
  const holder = findInstalledByVersion(cwd, claimed)
  if (holder) sources.push({ label: 'node_modules', value: `已安装 ${holder}@${claimed}`, ok: true })
  if (sources.length === 0) {
    return noEvidence('versionClaim', claim, `断言里没定位到包名，本机也没有任何包是 ${claimed}；无法判断（不猜）`)
  }
  return summarize('versionClaim', claim, sources)
}

/** 声明/定义位置的特征：命中才算强证据，仅"出现过"只是弱证据 */
const DECL_PATTERNS = (id: string): RegExp[] => {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return [
    new RegExp(`\\b(function|class|interface|type|enum|namespace|declare)\\s+${esc}\\b`),
    new RegExp(`\\b(const|let|var)\\s+${esc}\\b`),
    // 缩进的成员签名（class/interface/namespace 内部）；行首的 `ID(` 是调用，不是定义
    new RegExp(`^[ \\t]+(export\\s+)?(async\\s+)?${esc}\\s*[(:?<]`, 'm'),
    new RegExp(`\\b${esc}\\s*:\\s*(function|\\()`),
  ]
}

/** 符号/方法名是否真的在依赖或源码里**被定义** */
export function symbolExists(claim: string, cwd: string): OracleResult {
  const sig = claim.replace(/^`|`$/g, '')
  const id = /([A-Za-z_$][\w$]*)\s*\(/.exec(sig)?.[1] ?? sig.split('.').pop() ?? ''
  if (!id || id.length < 3) return noEvidence('symbolExists', claim, '读不出可查找的标识符')

  let roots: string[] = []
  const nm = walkUp(cwd, (d) => existsSync(join(d, 'node_modules')))
  if (nm) roots.push(join(nm, 'node_modules'))
  // 绝不扫插件自己的包：评测里 `agent.followup()` 曾被**我自己生成的 lib/loop.d.ts** 证实——自指证据
  const selfRoot = selfPackageRoot()
  roots.push(cwd)
  roots = roots.filter((r) => !selfRoot || !r.startsWith(selfRoot))

  const strong: string[] = []
  const weak: string[] = []
  const decls = DECL_PATTERNS(id)
  const exts = ['.d.ts', '.ts', '.js', '.mjs', '.cjs']
  const scanDir = (dir: string, depth: number): void => {
    if (strong.length >= 3 || depth > 6) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (strong.length >= 3) return
      if (entry === 'node_modules' || entry.startsWith('.')) continue
      const full = join(dir, entry)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) { scanDir(full, depth + 1); continue }
      if (!exts.some((e) => entry.endsWith(e))) continue
      let text: string
      try {
        text = readFileSync(full, 'utf8')
      } catch {
        continue
      }
      const at = text.indexOf(id)
      if (at < 0) continue
      const line = text.slice(0, at).split('\n').length
      if (decls.some((re) => re.test(text))) {
        if (strong.length < 3) strong.push(`${full}:${line}`)
      } else if (weak.length < 3) {
        weak.push(`${full}:${line}`)
      }
    }
  }
  for (const root of roots) scanDir(root, 0)

  if (strong.length > 0) {
    return summarize('symbolExists', claim, [{ label: roots.join(' , '), value: `找到定义 ${id}：${strong.join(' ')}`, ok: true }])
  }
  if (weak.length > 0) {
    // 中性：只在调用/引用位置出现，既不能确认也不能反驳（定义可能在未扫描的产物里）
    return summarize('symbolExists', claim, [{ label: roots.join(' , '), value: `${id} 只在非定义位置出现（弱证据）：${weak.join(' ')}`, ok: false, weak: true }])
  }
  // 找不到 ≠ 不存在：回答可能在讲另一个仓库/另一门语言的代码（评测实测 3 条假证伪全在这里）
  return noEvidence('symbolExists', claim, `在 ${roots.join(' , ')} 里找不到 ${id}；不能据此断言回答错了（作用域可能不是这里）`)
}
