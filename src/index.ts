/**
 * dsh-doubt —— 把「你确定吗」变成插件的自动动作。
 *
 * 三件事：
 * 1. verify_claims 工具：模型提交断言 + 可执行检查，插件在本机真跑并回填判定。
 * 2. 系统提示词一段：要求先取证再断言，禁止用「一定/绝对」掩盖没查过。
 * 3. 自动复核循环：turn 结束后扫描回答，发现「可核验但没取证」的断言就自动追加一轮复核。
 */

import type { Context } from '@deepseek-ai/cordis'
import { Config, normalizeConfig, type DoubtConfig } from './config.js'
import { installDoubtLoop } from './loop.js'
import { promptSection } from './prompts.js'
import { buildVerifyTool } from './tool.js'

export const name = 'dsh-doubt'
export { Config }
export { normalizeConfig, DEFAULT_CONFIG } from './config.js'
export type { DoubtConfig } from './config.js'
export { scanAnswer, DETECTOR_KINDS } from './scanner.js'
export { runCheck, runChecks } from './verify.js'

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

  if (!cfg.enabled) {
    log('已禁用（config.enabled = false）')
    return
  }

  if (cfg.verifyTool) {
    ctx.inject(['tools'], () => {
      const tools = (ctx as any).tools
      if (!tools || typeof tools.register !== 'function') return
      const definition = buildVerifyTool(getConfig)
      tools.register(definition)
      log('已注册工具 verify_claims')
    })
  }

  if (cfg.promptSection) {
    ctx.inject(['systemPrompt'], () => {
      const systemPrompt = (ctx as any).systemPrompt
      if (!systemPrompt || typeof systemPrompt.section !== 'function') return
      systemPrompt.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: promptSection(cfg.language === 'en' ? 'en' : 'zh'),
      })
      log(`已注入提示词段 ${SECTION_NAME}（order ${SECTION_ORDER}）`)
    })
  }

  if (cfg.autoRecheck) {
    installDoubtLoop(ctx, { getConfig, log })
    log(`自动复核已开启：maxRounds=${cfg.maxRounds} minScore=${cfg.minScore} minAnswerChars=${cfg.minAnswerChars}`)
  }

  log(`dsh-doubt v0.1.0 已加载（verifyTool=${cfg.verifyTool}, promptSection=${cfg.promptSection}, autoRecheck=${cfg.autoRecheck}）`)
}
