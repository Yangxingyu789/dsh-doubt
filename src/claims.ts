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

/**
 * 回答是否**断言了这条路径存在**。没有这类措辞时，路径多半只是被引用的示例
 * （评测实测：我自己讲 bug 时写的 `E:\a\b.json。日志在` 被当成存在性断言去 fs 查）。
 */
const EXISTENCE_RE = /在|位于|路径|装在|安装|已装|存在|双击|打开|找到|放到|写入|读取|位于|found|located|exists|path at|saved|written|directory|目录/i

function assertsExistence(text: string | undefined, token: string): boolean {
  if (!text) return true
  const at = text.indexOf(token)
  if (at < 0) return false
  return EXISTENCE_RE.test(text.slice(Math.max(0, at - 120), at + token.length + 120))
}

/** 上下文里这条路径是不是「被删掉的东西」——那样「不存在」就是对的，不是反驳 */
const DELETION_RE = /删除|已删|删干净|移除|清理|回收|卸载|已不存在|不存在了|已清除|无残留|deleted|removed|uninstall|cleaned up|no longer exists/i

function mentionsDeletion(text: string | undefined, token: string): boolean {
  if (!text) return false
  const at = text.indexOf(token)
  if (at < 0) return false
  return DELETION_RE.test(text.slice(Math.max(0, at - 200), at + token.length + 120))
}

/**
 * 回答是否真的在断言「这是个 **npm** 包」。
 * 两轮评测的教训：
 *   1) 裸字 `包` 会命中「包括/包含/打包」→ 139 条配置键被送去 registry 查；
 *   2) 泛化的 `安装/依赖` 会把 Python / Rust / C 工具也当 npm 包——`torchvision`、
 *      `ripgrep 15.2.0`、`jq 1.8.2` 都被 npm 上恰好同名的无关包「反驳」过。
 * 所以只认明确的 npm 语境。
 */
const NPM_CONTEXT_RE = /\b(npm|npx|pnpm|yarn|package\.json|node_modules|package-lock|pnpm-lock|lockfile|registry)\b|包名|npm 包/i

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
        // 通配符不是字面路径（评测实测 `E:\1009\logs\eval\result-*.json` 被 fs 判「不存在」）
        if (/[*?\[]/.test(f.snippet)) {
          push(f.kind, f.snippet, [], '含通配符的路径不是字面路径，existsSync 判不了')
          break
        }
        // 回答说的是「已删除/移除」时，不存在恰恰是对的
        if (mentionsDeletion(opts.text, f.snippet)) {
          push(f.kind, f.snippet, [], '上下文里这条路径是被删除/移除的对象，不是存在性断言')
          break
        }
        // Windows 上 `/v1/chat/completions` 这类 POSIX 绝对路径多半是 API 端点或别机路径，
        // 去本机文件系统找必然「不存在」→ 假证伪。判不了就别判。
        if (process.platform === 'win32' && /^~?\//.test(f.snippet)) {
          push(f.kind, f.snippet, [], 'Windows 上的 POSIX 风格路径：可能是 API 端点或另一台机器的路径，本机无法核验')
          break
        }
        if (!assertsExistence(opts.text, f.snippet)) {
          push(f.kind, f.snippet, [], '上下文没有把它当作存在性断言（可能只是被引用的示例），fs 判了也不算证据')
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
        // 没定位到 npm 语境时不去 registry：真实语料里 `Hub 2.2.0` 这类曾被拿去查 npm 的 `hub` 包，
        // 得到「最新版本 0.0.1，2.2.0 不存在」这种毫不相干的反驳
        const checks: Check[] = [{ kind: 'versionClaim', claim: f.snippet, name: pkg ?? undefined, noRegistry: !assertsNpmPackage(opts.text, f.snippet) }]
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
