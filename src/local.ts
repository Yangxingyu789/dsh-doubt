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

/**
 * 这个候选路径是否落在**插件自己这个包**里。
 *
 * 必须按 `package.json` 的 `name` 判定，不能按路径。实测过的失效场景：
 * 插件从已安装副本加载（`C:\...\.dsh\plugins\dsh-doubt`），会话工作目录是仓库
 * （`C:\work\dsh-doubt`）—— 两个路径、**同一个包**，路径前缀比较必然漏掉，于是
 * `symbolExists('normalizeConfig()', 'C:/work/dsh-doubt')` 会引用 `src/config.ts`
 * 把插件自己的 API「证实」给自己看。这正是 README 声称已修、实际没修住的自指证据。
 */
const SELF_PACKAGE_NAME = (() => {
  try {
    const pkg = readJson(join(selfPackageRoot(), 'package.json'))
    return typeof pkg?.name === 'string' ? (pkg.name as string) : null
  } catch {
    return null
  }
})()

const selfDirCache = new Map<string, boolean>()

/** 从该路径向上找最近的 package.json，看它是不是本插件自己的包 */
function insideSelfPackage(p: string): boolean {
  if (!SELF_PACKAGE_NAME) return false
  let dir = p
  for (let i = 0; i < 8; i += 1) {
    const cached = selfDirCache.get(dir)
    if (cached !== undefined) return cached
    const pkg = readJson(join(dir, 'package.json'))
    if (pkg) {
      const hit = pkg.name === SELF_PACKAGE_NAME
      selfDirCache.set(dir, hit)
      return hit
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return false
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
    try {
      if (existsSync(direct) && statSync(direct).isFile()) return direct
    } catch { /* ignore */ }
  }
  const pathVar = process.env.PATH ?? process.env.Path ?? ''
  const isWin = process.platform === 'win32'
  const exts = isWin ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : ['']

  // 必须**先试原名**：调用方常常已经写全了扩展名（`npm.cmd`、`npx.cmd`、`tsc.cmd`）。
  // 只往后拼 PATHEXT 的话只会试 `npm.cmd.EXE` 之类，于是把**就在 PATH 上**的 npm.cmd
  // 判成「不存在」→ 直接输出假证伪（实测 commandAvailability('npm.cmd') = refuted）。
  const names: string[] = []
  const seenName = new Set<string>()
  const add = (n: string): void => {
    const k = isWin ? n.toLowerCase() : n
    if (seenName.has(k)) return
    seenName.add(k)
    names.push(n)
  }
  add(cleaned)
  for (const ext of exts) {
    add(cleaned + ext.toLowerCase())
    add(cleaned + ext)
  }

  for (const dir of pathVar.split(isWin ? ';' : ':')) {
    if (!dir) continue
    for (const name of names) {
      const cand = join(dir, name)
      try {
        if (existsSync(cand) && statSync(cand).isFile()) return cand
      } catch { /* ignore */ }
    }
  }
  return null
}

/**
 * 不在 PATH 里不等于「这条命令是错的」。评测实测的三类无效反驳：
 *   PowerShell cmdlet / 别名（`Copy-Item`、`irm`）本来就不在 PATH；
 *   POSIX 专用工具（`df`、`free`、`lscpu`）讲的是另一台 Linux；
 *   通配符不是字面路径。
 */
const PS_CMDLET_RE = /^(Get|Set|New|Remove|Copy|Move|Rename|Test|Add|Out|Select|Where|ForEach|Measure|Write|Invoke|Start|Stop|Restart|Wait|Import|Export|ConvertFrom|ConvertTo|Format|Clear|Read|Install|Update|Push|Pop|Use)-[A-Z]\w+$/
const PS_ALIASES = new Set(['irm', 'iwr', 'ise', 'ips', 'gcm', 'gci', 'gps', 'ps', 'sls', 'cat', 'cp', 'ls', 'mv', 'rm', 'echo', 'cd', 'cls', 'clear', 'write', 'select', 'where', 'foreach', 'measure', 'sort', 'group'])
const POSIX_ONLY = new Set(['df', 'free', 'lscpu', 'lsblk', 'top', 'htop', 'grep', 'awk', 'sed', 'du', 'ls', 'cp', 'mv', 'rm', 'nvidia-smi', 'journalctl', 'systemctl', 'apt', 'apt-get', 'yum', 'dnf', 'pacman', 'apk', 'zypper', 'brew', 'launchctl', 'ssh', 'scp', 'rsync', 'python3', 'pip3', 'bash', 'sh', 'zsh', 'vllm', 'cuda', 'tr', 'cut', 'sort', 'uniq', 'head', 'tail', 'wc', 'xargs', 'chmod', 'chown', 'ln', 'touch', 'find', 'which', 'sudo', 'service', 'systemd'])

/**
 * Device/vendor CLIs run on ANOTHER machine (the NPU/GPU server), by definition.
 * Measured: the only `refuted` verdict on a real 46k-char deployment manual was
 * `npu-smi info` -> "npu-smi not on PATH". Asserting the answer is wrong because
 * this Windows workstation lacks the Ascend tool is a pure false refutation.
 */
const REMOTE_DEVICE_TOOLS = new Set(['npu-smi', 'nvidia-smi', 'rocm-smi', 'hccn_tool', 'ibstat', 'ibv_devinfo', 'mlxconfig', 'ascend-dmi', 'dcmi', 'ipmitool', 'racadm'])

function notApplicableHere(bin: string): string | null {
  // 末尾的点要先剥掉：`echo.` 是批处理里「输出空行」的写法，不是叫 echo. 的程序
  const bare = bin.replace(/\.(exe|cmd|bat)$/i, '').replace(/\.+$/, '')
  if (REMOTE_DEVICE_TOOLS.has(bare.toLowerCase())) return 'Device/vendor CLI: it belongs to another machine (the NPU/GPU server), so missing it here proves nothing'
  if (PS_CMDLET_RE.test(bare)) return 'PowerShell cmdlet 不在 PATH 里是正常的'
  if (PS_ALIASES.has(bare.toLowerCase()) && process.platform === 'win32') return 'PowerShell 别名不在 PATH 里是正常的'
  if (process.platform === 'win32' && POSIX_ONLY.has(bare.toLowerCase())) return 'POSIX 工具：这条命令大概是在讲另一台机器（Linux）'
  return null
}

/**
 * `z.Dispose()` / `foo.Bar(x)` 这类是**脚本内部的方法调用**，不是可执行程序。
 * 实测：`.ps1` 代码块里的 `z.Dispose()` 被拆成 argv[0] 拿去 `which`，判「不在 PATH 中」→ refuted。
 * 这里的判定只往「沉默」方向走：命中即 noEvidence，绝不新增反驳。
 * 注意不匹配盘符路径（`C:\…(x86)…` 以 `C:` 开头，冒号不在字符类里），避免误伤真实程序路径。
 */
const METHOD_CALL_RE = /^[A-Za-z_$][\w$.]*\s*[({]/

/** 命令里的程序是否存在（默认不执行回答里的命令） */
export function commandAvailability(claim: string, argv: readonly string[]): OracleResult {
  const bin = argv[0] ?? ''
  if (!bin) return noEvidence('commandAvailability', claim, '空命令')
  if (METHOD_CALL_RE.test(bin)) {
    return noEvidence('commandAvailability', claim, `${bin} 是方法/函数调用，不是可执行程序名；本机无法据此核验`)
  }
  const na = notApplicableHere(bin)
  if (na) return noEvidence('commandAvailability', claim, `${bin} 不在 PATH 中，但${na}；不能据此断言回答错了`)
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
    // 弱证据：**声明了依赖 ≠ 装上了**。实测「`left-pad` 已装在 node_modules」这条断言，
    // 在本机根本没装的情况下被 package.json 的声明范围「证实」——典型的假证实。
    if (range) sources.push({ label: join(declared, 'package.json'), value: `声明范围 ${range}（声明不等于已安装）`, ok: true, weak: true })
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
  // 预发布版本一律判不了：node-semver 的规则是「预发布版本只有在范围的比较子里
  // 出现同一个 [major,minor,patch] 时才可能满足」，我们这套简单比较器没实现它。
  // 独立验证者实测：21/48 个预发布格子与 semver 不一致，且错的方向**偏宽松**
  // （`^1.2.3` vs `1.2.3-beta.1` 我们判 true，semver 判 false）——那会变成假证实。
  // 所以这里直接中性化，宁可判不了。
  if (version.includes('-')) return undefined
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

/**
 * 宽松解析：允许 `4` / `4.1` / `4.x` 这类缺位写法，缺的补 0。
 * `width` = 明确写了几个数字位，比较运算符要用它决定上界（见 satisfiesPart）。
 */
function parseLooseWide(v: string): { nums: number[]; width: number } | null {
  const m = /^(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:[-+][\w.]+)?$/.exec(v.trim())
  if (!m) return null
  const isNum = (s: string | undefined): boolean => s !== undefined && /^\d+$/.test(s)
  const nums = [Number(m[1]), isNum(m[2]) ? Number(m[2]) : 0, isNum(m[3]) ? Number(m[3]) : 0]
  const width = isNum(m[3]) ? 3 : isNum(m[2]) ? 2 : 1
  return { nums, width }
}

function satisfiesPart(part: string, v: number[]): boolean | undefined {
  if (!part || part === '*' || part === 'x') return true
  const op = /^(>=|<=|>|<|=)\s*/.exec(part)
  if (op) {
    const parsed = parseLooseWide(part.slice(op[0].length))
    if (!parsed) return undefined
    const { nums: t, width } = parsed
    const c = cmp(v, t)
    // 部分版本号在 node-semver 里有**上界**语义，直接拿补 0 后的三元组比会判错：
    //   `<=1.2` 是 `<1.3.0`（1.2.9 满足）、`<=4` 是 `<5.0.0`、`>1.2` 是 `>=1.3.0`。
    // 实测 `^0` / `<=1.2` / `<=4` 这一批曾与 node-semver 结论相反 → 满足的声明被判「不满足」→ 假证伪。
    const upper = (): number[] => (width === 2 ? [t[0], t[1] + 1, 0] : [t[0] + 1, 0, 0])
    switch (op[1]) {
      case '>=': return c >= 0
      case '>': return width >= 3 ? c > 0 : cmp(v, upper()) >= 0
      case '<': return c < 0
      case '<=': return width >= 3 ? c <= 0 : cmp(v, upper()) < 0
      default: return width >= 3 ? c === 0 : cmp(v.slice(0, width), t.slice(0, width)) === 0
    }
  }
  const caret = /^\^\s*(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?/.exec(part)
  if (caret) {
    const spec = [caret[1], caret[2], caret[3]].filter((x) => x !== undefined).join('.')
    const parsed = parseLooseWide(spec)
    if (!parsed) return undefined
    const { nums: t, width } = parsed
    if (cmp(v, t) < 0) return false
    // caret 允许改动**最左边的非零位**：
    //   ^1.2.3 → <2.0.0    ^0.5 → <0.6.0    ^0.0.3 → <0.0.4
    //   ^0 / ^0.x → <1.0.0                ^0.0 / ^0.0.x → <0.1.0
    if (t[0] > 0) return v[0] === t[0]
    if (width === 1) return v[0] === 0
    if (t[1] > 0) return v[0] === 0 && v[1] === t[1]
    if (width === 2) return v[0] === 0 && v[1] === 0
    return v[0] === 0 && v[1] === 0 && v[2] === t[2]
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

  // 没定位到包名：只问「本机有没有任何包是这个版本」，找不到就承认无法判断。
  // 找到了也只能算**弱证据**：「本机碰巧有个包版本号相同」跟断言说的东西大概率无关
  // （实测：断言「Linux 内核 5.9.3」被本机的 typescript@5.9.3「证实」——假证实）。
  const holder = findInstalledByVersion(cwd, claimed)
  if (holder) sources.push({ label: 'node_modules', value: `本机恰好有 ${holder}@${claimed}，但与断言指代物未必相同`, ok: true, weak: true })
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
      // 自指证据：插件自己的包（仓库 / 已安装副本 / 它们的 junction）一律不算证据
      if (insideSelfPackage(full)) continue
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
