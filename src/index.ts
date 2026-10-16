/**
 * dsh-doubt —— 把「你确定吗」变成插件的自动取证动作。
 *
 * 四件事：
 * 1. verify_claims 工具：模型提交断言 + 可执行检查，插件在本机真跑并回填判定。
 * 2. 系统提示词段：分层取证策略 + 硬性禁令（禁止凭记忆写编号/路径/API 名）。
 * 3. 自动取证循环：turn 结束后插件**自己**跑 Tier A/B，把实测证据注入，而不是要求模型「再检查一遍」。
 * 4. Tier C：离线且无判据时，用无草稿上下文的独立重推导 + 多数投票（不是「你确定吗」）。
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config, normalizeConfig, type DoubtConfig } from './config.js'
import { installDoubtLoop } from './loop.js'
import { NetProbe } from './network.js'
import { promptSection } from './prompts.js'
import { buildVerifyTool } from './tool.js'

export const name = 'dsh-doubt'
export const version = '0.3.0'
export { Config }
export { normalizeConfig, DEFAULT_CONFIG } from './config.js'
export type { DoubtConfig } from './config.js'
export { scanAnswer, DETECTOR_KINDS } from './scanner.js'
export { runCheck, runChecks } from './verify.js'
export { extractClaims, splitCommand } from './claims.js'
export { gatherEvidence, verdictOf } from './evidence.js'
export { commandAvailability, packageVersion, rangeSatisfied, symbolExists, versionClaim, which } from './local.js'
export { factoredCheck, normalizeAnswer } from './factored.js'
export { NetProbe } from './network.js'

/** 系统提示词段位置：紧跟 dsh-ops 的 repository-tooling（3250-3252）之后 */
const SECTION_ORDER = 3260
const SECTION_NAME = 'dsh-doubt:self-check'

export function apply(ctx: Context, config: unknown): void {
  const cfg: DoubtConfig = normalizeConfig(config)

  const rawLogger = typeof (ctx as any).logger === 'function' ? (ctx as any).logger('dsh-doubt') : null
  const log = (...args: unknown[]): void => {
    if (rawLogger && typeof rawLogger.info === 'function') {
      try {
        rawLogger.info(...args)
        return
      } catch { /* fall through */ }
    }
    console.log('[dsh-doubt]', ...args)
  }

  const getConfig = (): DoubtConfig => cfg
  const probe = new NetProbe({ urls: cfg.probeUrls, timeoutMs: cfg.onlineTimeoutMs })

  if (!cfg.enabled) {
    log('已禁用（config.enabled = false）')
    return
  }

  if (cfg.verifyTool) {
    // 回调的**第一个参数**才是「已经 inject 过的上下文」——必须在它上面取 `tools`。
    // 闭包捕获外层 ctx 会踩到 cordis 的服务访问规则（reflect.ts: `cannot get property
    // "tools" without inject`）：服务只落在**声明了 inject 的那个 fiber** 的 store 里，
    // 外层 ctx 的 fiber 没声明，向上也找不到提供方（`dsh-tools` 是兄弟 fiber，不是祖先）。
    // 实测症状：宿主只在 stderr 打一行 `dsh-doubt (dsh-doubt): Error: cannot get property
    // "tools" without inject`，界面上完全看不出来 —— 工具与提示词段都没注册。
    ctx.inject(['tools'], (toolsCtx: Context) => {
      const tools = (toolsCtx as unknown as { tools?: { register?: (d: unknown) => unknown } })?.tools
      if (!tools || typeof tools.register !== 'function') return
      tools.register(buildVerifyTool(getConfig))
      log('已注册工具 verify_claims')
    })
  }

  if (cfg.promptSection) {
    ctx.inject(['systemPrompt'], (promptCtx: Context) => {
      const systemPrompt = (promptCtx as unknown as { systemPrompt?: { section?: (s: unknown) => unknown } })?.systemPrompt
      if (!systemPrompt || typeof systemPrompt.section !== 'function') return
      systemPrompt.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: promptSection(cfg.language === 'en' ? 'en' : 'zh', { requireSources: cfg.requireSources }),
      })
      log(`已注入提示词段 ${SECTION_NAME}（order ${SECTION_ORDER}）`)
    })
  }

  if (cfg.autoVerify) {
    // Tier C 在**运行期**才用 ctx.subagents，同样不能捕获外层 ctx，否则每次评估都会抛。
    // 这里把注入后的上下文存下来，服务不存在时回调不会触发 → 如实降级为「无子代理能力」。
    let subagentCtx: Context | null = null
    ctx.inject(['subagents'], (c: Context) => { subagentCtx = c })

    installDoubtLoop(ctx, {
      getConfig,
      log,
      probe,
      factoredHost: (agent) => {
        const subagents = (subagentCtx as unknown as { subagents?: { start?: unknown } } | null)?.subagents
        if (!subagents || typeof subagents.start !== 'function') return null
        return { subagents, parent: agent }
      },
    })
    const tier = cfg.factored ? 'A+B+C' : 'A+B'
    log(`自动取证已开启（Tier ${tier}）：requireSources=${cfg.requireSources} maxRounds=${cfg.maxRounds} minScore=${cfg.minScore} executeAnswerCommands=${cfg.executeAnswerCommands}`)
  }

  log(`dsh-doubt v${version} 已加载（verifyTool=${cfg.verifyTool}, promptSection=${cfg.promptSection}, autoVerify=${cfg.autoVerify}, factored=${cfg.factored}）`)
}
