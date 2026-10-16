/**
 * 把扫描器命中的「可疑断言」翻译成**可机械执行的检查**。
 *
 * 严格约束（默认保守）：
 * - 回答里出现的命令，默认**不执行**，只验证「这个程序存在吗、版本多少」；
 *   要真执行需显式开 executeAnswerCommands。
 * - 带管道/重定向/&& 的命令无法安全解析 → 标 unverifiable，不猜。
 */

import type { Check } from './verify.js'
import type { Finding } from './scanner.js'

export interface Claim {
  id: string
  kind: string
  text: string
  /** 可执行检查；为空表示本机无法机械核验 */
  checks: Check[]
  /** 无法机械核验的原因 */
  unmechanizable?: string
}

/** 保守的命令行切分：只处理引号，不处理管道/重定向 */
export function splitCommand(cmd: string): string[] | null {
  const raw = cmd.trim()
  if (!raw) return null
  if (/[|]|&&|\|\||;|>|\$\(|`|\bfor\b|\bwhile\b/i.test(raw)) return null
  const out: string[] = []
  let cur = ''
  let quote: '"' | "'" | null = null
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]
    if (quote) {
      if (ch === quote) quote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") { quote = ch; continue }
    if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = '' }
      continue
    }
    cur += ch
  }
  if (quote) return null
  if (cur) out.push(cur)
  return out.length > 0 ? out : null
}

const PKG_NAME_RE = /^((?:@[\w.-]+\/)?[A-Za-z][\w.-]{1,60})\b/
/** 版本断言里常见的连接词，不能当成包名（否则 node_modules/version 找不到 → 假证伪） */
const NAME_STOPWORDS = new Set(['version', 'versions', 'ver', 'v', 'to', 'at', 'is', 'in', 'and', 'or', 'the', 'from', 'with', 'requires', 'require', 'using', 'use', 'installed', 'install', 'latest', 'current'])

/** 从版本断言文本里尽量定位它说的是哪个包 */
export function packageForVersionClaim(text: string): string | null {
  const head = text.replace(/^["'`]|["'`]$/g, '').trim()
  if (!/^(?:@?[\w@/.-]+)\s+\d/.test(head)) return null
  const name = PKG_NAME_RE.exec(head)?.[1] ?? null
  if (!name || NAME_STOPWORDS.has(name.toLowerCase())) return null
  return name
}

/** 回答是否真的在断言「这是个 npm 包」——只是提到一个名词，不构成可反驳的存在断言 */
const NPM_CONTEXT_RE = /\b(npm|npx|pnpm|yarn|package|dependency|dependencies|install|registry|node_modules|add)\b|包|依赖|安装|装一个|lock/i

function assertsNpmPackage(text: string | undefined, token: string): boolean {
  const src = text ?? token
  const at = src.indexOf(token)
  if (at < 0) return false
  const window = src.slice(Math.max(0, at - 100), at + token.length + 100)
  return NPM_CONTEXT_RE.test(window)
}

/**
 * 生成断言列表。cwd 用于本机查找 node_modules / package.json。
 * `text` 是原回答全文：用来判断某个名词是不是**真的被断言**为 npm 包。
 */
export function extractClaims(findings: readonly Finding[], opts: { executeAnswerCommands?: boolean; text?: string } = {}): Claim[] {
  const claims: Claim[] = []
  let n = 0
  const seen = new Set<string>()

  const push = (kind: string, text: string, checks: Check[], unmechanizable?: string): void => {
    const key = `${kind}\u0000${text}`
    if (seen.has(key)) return
    seen.add(key)
    claims.push({ id: `c${++n}`, kind, text, checks, unmechanizable })
  }

  for (const f of findings) {
    switch (f.kind) {
      case 'command': {
        const argv = splitCommand(f.snippet)
        if (!argv) {
          push(f.kind, f.snippet, [], '命令含管道/重定向/控制流，无法安全解析')
          break
        }
        const bin = argv[0] ?? ''
        const checks: Check[] = [{ kind: 'commandAvailability', argv, claim: f.snippet }]
        if (opts.executeAnswerCommands) checks.push({ kind: 'command', argv, claim: f.snippet })
        push(f.kind, f.snippet, checks, bin ? undefined : '空命令')
        break
      }
      case 'path': {
        // Windows 上 `/v1/chat/completions` 这类 POSIX 绝对路径多半是 API 端点或别机路径，
        // 去本机文件系统找必然「不存在」→ 假证伪。判不了就别判。
        if (process.platform === 'win32' && /^~?\//.test(f.snippet)) {
          push(f.kind, f.snippet, [], 'Windows 上的 POSIX 风格路径：可能是 API 端点或另一台机器的路径，本机无法核验')
          break
        }
        push(f.kind, f.snippet, [{ kind: 'fileExists', path: f.snippet, claim: f.snippet }])
        break
      }
      case 'package':
        if (!assertsNpmPackage(opts.text, f.snippet)) {
          push(f.kind, f.snippet, [], '回答只是提到这个名词，没断言它是可安装的包；registry 查不到不构成反驳')
          break
        }
        push(f.kind, f.snippet, [{ kind: 'packageVersion', name: f.snippet, claim: f.snippet }])
        break
      case 'version': {
        const pkg = packageForVersionClaim(f.snippet)
        const checks: Check[] = [{ kind: 'versionClaim', claim: f.snippet, name: pkg ?? undefined }]
        push(f.kind, f.snippet, checks)
        break
      }
      case 'symbol':
        push(f.kind, f.snippet, [{ kind: 'symbolExists', claim: f.snippet, source: f.snippet }])
        break
      default:
        push(f.kind, f.snippet, [], '该断言需要语义/事实判断，本机无机械判据')
    }
  }
  return claims
}
