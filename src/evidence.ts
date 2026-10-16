/**
 * 取证编排：Tier A 本机 oracle（离线） + Tier B 多来源交叉（在线）。
 *
 * 判定规则（严格约束）：
 *   confirmed     在线需 ≥ requireSources 个互相独立的来源一致；离线需至少一个确定性来源支持
 *   refuted       至少一个来源明确反驳，且没有任何来源支持
 *   inconclusive  来源之间互相冲突，或在线时一致来源数不足
 *   unverifiable  本机与网络都拿不出判据 —— 必须如实标注，不许猜
 */

import { statSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { packageForVersionClaim, type Claim } from './claims.js'
import type { DoubtConfig } from './config.js'
import { commandAvailability, packageVersion, symbolExists, versionClaim, type OracleResult } from './local.js'
import type { NetState } from './network.js'

export type Verdict = 'confirmed' | 'refuted' | 'inconclusive' | 'unverifiable'

export interface Evidence {
  claimId: string
  kind: string
  claim: string
  verdict: Verdict
  agreeing: number
  contradicting: number
  provenance: string[]
  note?: string
}

interface RawSource {
  label: string
  value: string
  ok: boolean
  weak?: boolean
}

async function onlineSources(claim: Claim, cfg: DoubtConfig, net: NetState): Promise<RawSource[]> {
  if (!net.online) return []
  // claims.ts 是唯一闸门：checks 为空表示「这条根本不该被机械核验」，联网也不许自行开判
  if (!claim.checks?.length) return []
  // 语境不足以确认这是 npm 包/版本 → 不去 registry，避免拿毫不相干的包来「反驳」
  if (claim.checks.every((c) => c.noRegistry)) return []
  const out: RawSource[] = []
  const pkgName = (() => {
    if (claim.kind === 'package') return claim.text.replace(/^`|`$/g, '').replace(/@[~^]?\d[\w.-]*$/, '')
    if (claim.kind === 'version') {
      // 必须复用 claims.ts 里那套**锚定**的解析。这里曾自带一个非锚定的小写正则，
      // 匹配会从第二个字符开始：`Express 4.18.2` → `xpress`、`Vite 5.4.0` → `ite`，
      // 于是拿一个不存在的包去 registry 查，把**正确**的版本断言判成 refuted（假证伪）。
      return packageForVersionClaim(claim.text)?.toLowerCase() ?? null
    }
    return null
  })()

  if (pkgName && (claim.kind === 'package' || claim.kind === 'version')) {
    for (const base of cfg.registryUrls) {
      try {
        const url = `${base.replace(/\/$/, '')}/${pkgName.replace('/', '%2F')}`
        const res = await fetch(url, { signal: AbortSignal.timeout(cfg.onlineTimeoutMs) })
        if (res.status === 404) {
          out.push({
            label: `registry ${base}`,
            value: `${pkgName} 在 registry 里不存在`,
            // package 断言：查无此包就是反驳。
            // version 断言：包名是从自然语言里猜出来的，404 更可能是名字猜错了
            // （实测 `lodash v4.17` 曾拿 `v4.17` 当包名查 → 404 → 反而被算成「证实」）。
            ok: false,
            weak: claim.kind === 'version',
          })
          continue
        }
        if (!res.ok) { out.push({ label: `registry ${base}`, value: `HTTP ${res.status}`, ok: false, weak: true }); continue }
        const doc: any = await res.json()
        const latest: string | undefined = doc?.['dist-tags']?.latest
        const wanted = /(v?\d+\.\d+(?:\.\d+)?)/.exec(claim.text)?.[1]?.replace(/^v/, '')
        if (wanted) {
          const known = Object.keys(doc?.versions ?? {})
          const exists = known.includes(wanted)
          out.push({ label: `registry ${base}`, value: `最新版本 ${latest ?? '?'}；${wanted} ${exists ? '存在' : '不存在'}`, ok: exists })
        } else {
          out.push({ label: `registry ${base}`, value: `${pkgName} 最新版本 ${latest ?? '?'}`, ok: Boolean(latest) })
        }
      } catch (e) {
        // 请求失败是**中性**，不是反驳：网络抖动不得造成假证伪
        out.push({ label: `registry ${base}`, value: `请求失败：${String(e instanceof Error ? e.message : e)}`, ok: false, weak: true })
      }
    }
  }
  return out
}

function localOracle(claim: Claim, cfg: DoubtConfig, workspace?: string): OracleResult {
  // workspace 优先：它来自会话事件里的 `cwd`（宿主权威值）。cfg.workspace 只是兜底，
  // 因为它在插件加载时等于宿主进程的 cwd —— 那是 profile 目录，不是用户的项目。
  const cwd = workspace || cfg.workspace
  // claims.ts 是「这条断言本机能不能判」的唯一闸门：checks 为空就必须照实说无法核验，
  // 绝不能在这里另起一套判定绕过它（评测实测：POSIX 路径守卫曾被这里绕过）
  if (!claim.checks || claim.checks.length === 0) {
    return {
      kind: claim.kind,
      claim: claim.text,
      ok: false,
      noEvidence: true,
      sources: [],
      detail: claim.unmechanizable ?? '该断言本机无法机械核验',
    }
  }
  switch (claim.kind) {
    case 'command': {
      const check = claim.checks.find((c) => c.kind === 'commandAvailability')
      const argv = (check?.argv as string[] | undefined) ?? []
      return commandAvailability(claim.text, argv)
    }
    case 'path': {
      const check = claim.checks[0]
      const raw = String(check?.path ?? claim.text)
      // 相对路径要相对 cfg.workspace 解析，而不是宿主进程的 cwd。
      // 实测 `./marker.ts` 明明在 cfg.workspace 里存在，却按 process.cwd() 去找 → 假证伪。
      const p = isAbsolute(raw) ? raw : resolve(cwd, raw)
      // 盘符不存在 → 这条路径大概在另一台机器/另一块盘上，不是本机事实。
      // 纠正一条早先写错的注释：这台机器其实有 C:/D:/E:/F:/G:（`Test-Path 'D:\'` 为真），
      // 所以这一条守卫**不会**拦住 `D:\…`。真正拦下远程语境的是 claims.ts 的 mentionsOtherMachine。
      // 这里只处理「盘符确实不存在」这一种情况。
      const drive = /^([A-Za-z]):[\\/]/.exec(p)
      if (drive && process.platform === 'win32') {
        const root = `${drive[1].toUpperCase()}:\\`
        let driveExists = true
        try { statSync(root) } catch { driveExists = false }
        if (!driveExists) {
          return {
            kind: 'fileExists',
            claim: claim.text,
            ok: false,
            noEvidence: true,
            sources: [],
            detail: `本机没有 ${drive[1].toUpperCase()}: 盘符，这条路径大概在另一台机器上（不构成反驳）`,
          }
        }
      }
      // existsSync 把「没权限 stat」也当成不存在：`C:\pagefile.sys` 实测 Test-Path 为真、
      // Node existsSync 为假 → 假证伪。只有 ENOENT 才算「不存在」，其余是判不了。
      try {
        const st = statSync(p)
        return {
          kind: 'fileExists',
          claim: claim.text,
          ok: true,
          noEvidence: false,
          sources: [{ label: 'fs', value: `存在：${p}（${st.isDirectory() ? '目录' : `${st.size} 字节`}）`, ok: true }],
          detail: `存在：${p}`,
        }
      } catch (e) {
        const code = (e as { code?: string })?.code
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          return { kind: 'fileExists', claim: claim.text, ok: false, noEvidence: false, sources: [{ label: 'fs', value: `不存在：${p}`, ok: false }], detail: `不存在：${p}` }
        }
        return { kind: 'fileExists', claim: claim.text, ok: false, noEvidence: true, sources: [], detail: `无法 stat ${p}：${code ?? String(e)}（不是「不存在」）` }
      }
    }
    case 'package':
      return packageVersion(claim.text, claim.text.replace(/^`|`$/g, ''), cwd)
    case 'version': {
      const check = claim.checks[0]
      return versionClaim(claim.text, cwd, check?.name as string | undefined)
    }
    case 'symbol':
      return symbolExists(claim.text, cwd)
    default:
      return { kind: claim.kind, claim: claim.text, ok: false, noEvidence: true, sources: [], detail: '该断言类型没有本机 oracle' }
  }
}

export function verdictOf(sources: readonly RawSource[], cfg: DoubtConfig, online: boolean): { verdict: Verdict; agreeing: number; contradicting: number; note?: string } {
  const support = sources.filter((s) => s.ok && !s.weak).length
  const neutral = sources.filter((s) => s.weak).length
  const contradicting = sources.filter((s) => !s.ok && !s.weak).length
  if (sources.length === 0) return { verdict: 'unverifiable', agreeing: 0, contradicting: 0 }
  if (support === 0 && neutral > 0 && contradicting === 0) {
    return { verdict: 'inconclusive', agreeing: 0, contradicting, note: `只有 ${neutral} 条弱证据（命中但不是定义位置），不足以确认也不足以反驳` }
  }
  if (support === 0) return { verdict: 'refuted', agreeing: 0, contradicting }
  if (contradicting > 0) return { verdict: 'inconclusive', agreeing: support, contradicting, note: '来源之间互相冲突' }
  const need = online ? Math.max(1, cfg.requireSources) : 1
  if (support < need) {
    return { verdict: 'inconclusive', agreeing: support, contradicting, note: `在线需 ${need} 个独立来源一致，当前只有 ${support} 个` }
  }
  return { verdict: 'confirmed', agreeing: support, contradicting }
}

export async function gatherEvidence(claims: readonly Claim[], cfg: DoubtConfig, net: NetState, workspace?: string): Promise<Evidence[]> {
  const out: Evidence[] = []
  for (const claim of claims) {
    const local = localOracle(claim, cfg, workspace)
    const remote = await onlineSources(claim, cfg, net)
    const sources: RawSource[] = [...local.sources, ...remote]
    const v = verdictOf(sources, cfg, net.online)
    out.push({
      claimId: claim.id,
      kind: claim.kind,
      claim: claim.text,
      verdict: v.verdict,
      agreeing: v.agreeing,
      contradicting: v.contradicting,
      provenance: sources.map((s) => `${s.ok ? '✓' : '✗'} [${s.label}] ${s.value}`),
      note: v.note ?? (local.noEvidence && remote.length === 0 ? '本机与网络都无判据' : undefined),
    })
  }
  return out
}
