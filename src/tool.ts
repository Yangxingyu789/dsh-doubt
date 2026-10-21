

import type { DoubtConfig } from './config.js'
import { agentWorkspace, sessionCwd } from './scanner.js'
import { runCheck, type Check, type CheckOutcome } from './verify.js'


const agentWorkspaceCache = new WeakMap<object, { cwd: string; source: string } | null>()
function resolveWorkspace(exec: { agent?: unknown } | undefined, fallback: string): { cwd: string; source: string } {
  const agent = exec?.agent
  if (agent && typeof agent === 'object') {
    const cached = agentWorkspaceCache.get(agent as object)
    if (cached !== undefined) return cached ?? { cwd: fallback, source: 'cfg.workspace' }
    let found: { cwd: string; source: string } | null = null
    const header = agentWorkspace(agent)
    if (header) found = { cwd: header, source: 'exec.agent.session.header.cwd' }
    if (!found) {
      try {
        const session = (agent as { session?: { snapshotEvents?: () => unknown[]; events?: unknown[] } }).session
        const events = session?.snapshotEvents?.() ?? session?.events ?? []
        const scanned = sessionCwd(events)
        if (scanned) found = { cwd: scanned, source: 'session event scan' }
      } catch {
        found = null
      }
    }
    agentWorkspaceCache.set(agent as object, found)
    return found ?? { cwd: fallback, source: 'cfg.workspace' }
  }
  return { cwd: fallback, source: 'cfg.workspace' }
}


export interface PlainToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: {
    schema: Record<string, unknown>
    render: (args: any, value: any) => Array<{ type: 'text'; text: string }>
  }
  execute: (args: any, exec: { signal?: AbortSignal }) => Promise<unknown>
}

const CHECK_KINDS = ['command', 'fileExists', 'fileMatch', 'httpStatus', 'expr', 'textEquals'] as const

const PARAMETERS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    checks: {
      type: 'array',
      minItems: 1,
      maxItems: 12,
      description: '要核验的断言列表。每条给出一个可执行的检查，插件会在本机真实运行并回填结果。',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: [...CHECK_KINDS], description: '核验手段' },
          claim: { type: 'string', description: '被核验的断言原文（会原样回填，便于你对照）' },
          argv: {
            type: 'array',
            items: { type: 'string' },
            description: 'command：程序与参数数组，例如 ["git","--version"]。不经过 shell，无管道/重定向。',
          },
          expectExit: { type: 'integer', description: 'command：期望退出码，默认 0' },
          expectMatch: { type: 'string', description: 'command/expr：输出需包含的子串' },
          expectRegex: { type: 'string', description: 'command/expr：输出需匹配的正则' },
          path: { type: 'string', description: 'fileExists/fileMatch：文件路径' },
          regex: { type: 'string', description: 'fileMatch：文件内容需匹配的正则' },
          url: { type: 'string', description: 'httpStatus：要请求的 URL' },
          expectStatus: { type: 'integer', description: 'httpStatus：期望状态码，默认 2xx' },
          source: { type: 'string', description: 'expr：在空沙箱里求值的 JS 表达式（无 require/process）' },
          signature: { type: 'string', description: 'symbolExists：要查找的符号签名，例如 `z.Dispose()` 或 `foo.Bar(x)`。**与 claim 分开写**——claim 用来描述这条断言；挤在一起会把整句话当符号名搜。' },
          cwd: { type: 'string', description: '本机 oracle（packageVersion / versionClaim / symbolExists）与相对路径的查找起点。默认自动取当前会话的工作目录；只有要查别的仓库时才需要显式给。' },
          actual: { type: 'string', description: 'textEquals：实际文本' },
          expected: { type: 'string', description: 'textEquals：期望文本' },
        },
        required: ['kind'],
      },
    },
  },
  required: ['checks'],
} as const

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string', description: '一行总结：通过/失败条数' },


    workspace: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: { type: 'string', description: '本机 oracle 的查找起点' },
        source: { type: 'string', description: '起点来源：显式 cwd / exec.agent.session.header.cwd / 事件扫描 / cfg.workspace' },
      },
      required: ['cwd', 'source'],
    },
    failed: { type: 'integer', description: '失败的条数' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          kind: { type: 'string' },
          claim: { type: 'string' },
          detail: { type: 'string', description: '实测输出与判定理由' },
        },
        required: ['ok', 'kind', 'detail'],
      },
    },
  },
  required: ['summary', 'results'],
} as const

function summarize(results: readonly CheckOutcome[]): string {
  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  if (failed === 0) return `全部通过：${passed}/${results.length}。可以引用上面的实测输出作为证据。`
  return `失败 ${failed} 条 / 通过 ${passed} 条。失败的那几条结论必须修正或标注为未验证。`
}

export function buildVerifyTool(getConfig: () => DoubtConfig): PlainToolDefinition {
  return {
    name: 'verify_claims',
    description:
      '在本机真实执行一组检查来核验你自己（或用户）的断言，返回每条的实测输出与判定。'
      + '给出命令、路径、版本号、包名、API 签名或具体数字之前先用它取证；不要凭记忆描述执行结果。'
      + 'kind 可选：command（argv，不经 shell）/ fileExists / fileMatch / httpStatus / expr / textEquals。',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args: any, exec: { signal?: AbortSignal; agent?: unknown }) {
      const cfg = getConfig()



      const explicit = typeof args?.cwd === 'string' && args.cwd.trim() ? args.cwd.trim() : null
      const resolved = explicit ? { cwd: explicit, source: 'explicit args.cwd' } : resolveWorkspace(exec, cfg.workspace)
      const rawChecks = Array.isArray(args?.checks) ? args.checks : []
      const checks = rawChecks.slice(0, 12) as Check[]
      const results: CheckOutcome[] = []
      for (const check of checks) {
        if (exec?.signal?.aborted) {
          results.push({ ok: false, kind: String(check?.kind ?? 'unknown'), claim: check?.claim, detail: '已取消（调用方中止）' })
          continue
        }
        results.push(await runCheck(check, {
          timeoutMs: cfg.timeoutMs,
          denyBinaries: cfg.denyBinaries,
          cwd: resolved.cwd,
        }))
      }
      const failed = results.filter((r) => !r.ok).length
      return {
        summary: `${summarize(results)}（本机 oracle 的查找起点：${resolved.cwd} —— 来源 ${resolved.source}）`,
        workspace: resolved,
        failed,
        results,
      }
    },
  }
}
