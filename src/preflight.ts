/**
 * 执行前危险变更闸门（tools/pre-execute waterfall）。
 *
 * 与 guardLiveMutation 的区别：那个是**回答生成后**扫描已发生的工具调用（只能披露/要求补查），
 * 这个在工具真正执行**之前**介入。宿主 `@deepseek-ai/dsh-tools` 的 `prepareExecution`
 * 会先跑 `tools/pre-execute` waterfall，再按 decision 执行：
 *   - { kind: 'allow' } → 正常执行
 *   - { kind: 'ask', reason, displayReason } → 走宿主 approval seam（权限审批注入）
 *   - { kind: 'deny', reason } → 工具体不执行，模型收到 Error: <reason>
 *
 * 策略：识别到 live 危险变更时，有审批通道且策略不是 never → ask（弹出权限审批）；
 * 无审批通道或策略 never → deny（并说明如何取得用户确认）。普通仓库操作不受影响。
 */
import type { DoubtConfig } from './config.js'
import { classifyToolCall, type LiveMutationFinding } from './guard.js'

export interface PreflightDecision {
  kind: 'allow' | 'ask' | 'deny' | 'cancel'
  reason?: string
  displayReason?: { en: string; zh: string }
}

export interface PreflightHost {
  /** ctx.get('approval') 封装的宿主审批服务；缺失时返回 undefined。 */
  approval: () => any
}

const describe = (finding: LiveMutationFinding): string =>
  `dsh-doubt 危险变更闸门：识别到 ${finding.kind} 类操作（${finding.rule}，目标 ${finding.target}）。`
  + '该操作会改动正在运行的宿主/系统，执行前必须由用户确认：先说明影响面、给出备份位置与可直接执行的回滚命令，再征得用户明确同意（宿主批准提示或用户消息中的明确确认）。'

export function createPreflightGuard(getConfig: () => DoubtConfig, host: PreflightHost) {
  return async function preflight(exec: any, next: () => Promise<any>): Promise<any> {
    const cfg = getConfig()
    if (!cfg.guardPreExecute) return next()
    // 让下游 guard / 审批先表态；已有明确决定时保持原样。
    const downstream = await next()
    try {
      if (downstream && downstream.kind !== undefined && downstream.kind !== 'allow') return downstream
      if (!exec || typeof exec.name !== 'string') return downstream
      const args = exec.arguments ?? exec.args ?? {}
      const finding = classifyToolCall(exec.name, args, cfg)
      if (!finding) return downstream
      const reason = describe(finding)
      let approval: any
      try { approval = host.approval() } catch { approval = undefined }
      let policy: unknown
      try { policy = approval?.overrideOf?.(exec.agent?.session) } catch { policy = undefined }
      if (!exec.agent || !approval || policy === 'never') {
        return {
          kind: 'deny',
          reason: `${reason}\n当前没有可用于该操作的权限审批通道（approval 缺失或策略为 never），因此已拒绝执行。请改为：向用户说明影响面并等待用户明确确认；若用户同意，请其把审批策略切换为允许询问后重试。`,
        }
      }
      return {
        kind: 'ask',
        reason,
        displayReason: {
          en: `dsh-doubt: this call mutates the running host (${finding.kind}: ${finding.rule}). Approve only if you expect it.`,
          zh: `dsh-doubt：该操作会改动运行中的宿主（${finding.kind}: ${finding.rule}），确认要执行吗？`,
        },
      }
    } catch {
      // 分类失败不应阻止普通工具；只有识别成功才介入。
      return downstream
    }
  }
}
