

import type { Check } from './verify.js'
import type { Finding } from './scanner.js'

export interface Claim {
  id: string
  kind: string
  text: string

  checks: Check[]

  unmechanizable?: string
}


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

const NAME_STOPWORDS = new Set(['version', 'versions', 'ver', 'v', 'to', 'at', 'is', 'in', 'and', 'or', 'the', 'from', 'with', 'requires', 'require', 'using', 'use', 'installed', 'install', 'latest', 'current'])


export function packageForVersionClaim(text: string): string | null {
  const head = text.replace(/^["'`]|["'`]$/g, '').trim()
  if (!/^(?:@?[\w@/.-]+)\s+\d/.test(head)) return null
  const name = PKG_NAME_RE.exec(head)?.[1] ?? null
  if (!name || NAME_STOPWORDS.has(name.toLowerCase())) return null
  return name
}


const EXISTENCE_RE = /在|位于|路径|装在|安装|已装|存在|双击|打开|找到|放到|写入|读取|位于|found|located|exists|path at|saved|written|directory|目录/i

function assertsExistence(text: string | undefined, token: string): boolean {
  if (!text) return true
  const at = text.indexOf(token)
  if (at < 0) return false
  return EXISTENCE_RE.test(text.slice(Math.max(0, at - 120), at + token.length + 120))
}


const DELETION_RE = /删除|已删|删干净|移除|清理|回收|卸载|已不存在|不存在了|已清除|无残留|deleted|removed|uninstall|cleaned up|no longer exists/i

function mentionsDeletion(text: string | undefined, token: string): boolean {
  if (!text) return false
  const at = text.indexOf(token)
  if (at < 0) return false
  return DELETION_RE.test(text.slice(Math.max(0, at - 200), at + token.length + 120))
}


const OTHER_MACHINE_RE = /目标\s*(机|机器|服务器|主机|节点)|服务器(上|端)?|远程|远端|另一台|其他机器|新机器|待部署|部署(到|至|在)|登录(到|上)|云端|虚拟机|容器(里|内|中)|镜像(里|内|中)|on the (server|target|remote)|the (target|remote) (host|machine|server)|after you (ssh|log ?in)|on that (machine|box|host)/i

function mentionsOtherMachine(text: string | undefined, token: string): boolean {
  if (!text) return false
  const at = text.indexOf(token)
  if (at < 0) return false
  return OTHER_MACHINE_RE.test(text.slice(Math.max(0, at - 220), at + token.length + 220))
}


const NPM_CONTEXT_RE = /\b(npm|npx|pnpm|yarn|package\.json|node_modules|package-lock|pnpm-lock|lockfile|registry)\b|包名|npm 包/i

const NEGATED_PACKAGE_RE = /未发布|没有发布|未上架|不上架|不在\s*npm|未提交到\s*npm|不是\s*npm|非\s*npm|无此包|不存在于\s*npm|not\s+published|isn'?t\s+published|is\s+not\s+published|not\s+on\s+npm|no\s+such\s+package/i

function assertsNpmPackage(text: string | undefined, token: string): boolean {
  const src = text ?? token
  const at = src.indexOf(token)
  if (at < 0) return false
  const window = src.slice(Math.max(0, at - 100), at + token.length + 100)
  if (NEGATED_PACKAGE_RE.test(window)) return false
  return NPM_CONTEXT_RE.test(window)
}


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

        if (/[*?\[]/.test(f.snippet)) {
          push(f.kind, f.snippet, [], '含通配符的路径不是字面路径，existsSync 判不了')
          break
        }

        if (mentionsDeletion(opts.text, f.snippet)) {
          push(f.kind, f.snippet, [], '上下文里这条路径是被删除/移除的对象，不是存在性断言')
          break
        }


        if (process.platform === 'win32' && /^~?\//.test(f.snippet)) {
          push(f.kind, f.snippet, [], 'Windows 上的 POSIX 风格路径：可能是 API 端点或另一台机器的路径，本机无法核验')
          break
        }
        if (!assertsExistence(opts.text, f.snippet)) {
          push(f.kind, f.snippet, [], '上下文没有把它当作存在性断言（可能只是被引用的示例），fs 判了也不算证据')
          break
        }


        if (mentionsOtherMachine(opts.text, f.snippet)) {
          push(f.kind, f.snippet, [], '上下文在讲另一台机器（目标服务器/远程主机）的目录，本机文件系统判不了')
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
