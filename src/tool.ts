/**
 * verify_claims 工具：让模型把「我认为是这样」交给插件真实执行。
 *
 * 用**裸 JSON Schema** 注册（不 import dsh-tools），
 * 这样插件运行时不需要解析到宿主内部包，第三方插件更安全。
 */

import type { DoubtConfig } from './config.js'
import { runCheck, type Check, type CheckOutcome } from './verify.js'

/** ctx.tools.register 接受的最小定义形状 */
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
    async execute(args: any, exec: { signal?: AbortSignal }) {
      const cfg = getConfig()
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
        }))
      }
      return { summary: summarize(results), results }
    },
  }
}
