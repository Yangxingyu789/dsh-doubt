import { Config, normalizeConfig } from './config.js';
import { installDoubtLoop } from './loop.js';
import { NetProbe } from './network.js';
import { promptSection } from './prompts.js';
import { buildVerifyTool } from './tool.js';
import { createCompletionGuard } from './completion.js';
import { createPreflightGuard } from './preflight.js';
export const name = 'dsh-doubt';
export const version = '0.1.6';
export { Config };
export { normalizeConfig, DEFAULT_CONFIG } from './config.js';
export { scanAnswer, DETECTOR_KINDS } from './scanner.js';
export { runCheck, runChecks } from './verify.js';
export { extractClaims, splitCommand } from './claims.js';
export { gatherEvidence, verdictOf } from './evidence.js';
export { commandAvailability, packageVersion, rangeSatisfied, symbolExists, versionClaim, which } from './local.js';
export { factoredCheck, normalizeAnswer } from './factored.js';
export { NetProbe } from './network.js';
export { assessLiveMutation, detectLiveMutations, rollbackDisclosed, confirmationSeen, healthChecked } from './guard.js';
const SECTION_ORDER = 3260;
const SECTION_NAME = 'dsh-doubt:self-check';
export function apply(ctx, config) {
    const cfg = normalizeConfig(config);
    const rawLogger = typeof ctx.logger === 'function' ? ctx.logger('dsh-doubt') : null;
    const log = (...args) => {
        if (rawLogger && typeof rawLogger.info === 'function') {
            try {
                rawLogger.info(...args);
                return;
            }
            catch { /* fall through */ }
        }
        console.log('[dsh-doubt]', ...args);
    };
    const getConfig = () => cfg;
    const probe = new NetProbe({ urls: cfg.probeUrls, timeoutMs: cfg.onlineTimeoutMs });
    if (!cfg.enabled) {
        log('已禁用（config.enabled = false）');
        return;
    }
    if (cfg.guardPreExecute) {
        const preflight = createPreflightGuard(getConfig, {
            approval: () => {
                try {
                    return ctx.get?.('approval') ?? ctx.approval;
                }
                catch {
                    return undefined;
                }
            },
        });
        const registerPreflight = () => ctx.on?.('tools/pre-execute', preflight, { prepend: true });
        if (typeof ctx.effect === 'function')
            ctx.effect(registerPreflight);
        else
            registerPreflight();
        log('已启用执行前危险变更闸门（tools/pre-execute）：live 变更需权限审批；无审批通道/never 策略时拒绝');
    }
    if (cfg.verifyTool) {
        ctx.inject(['tools'], (toolsCtx) => {
            const tools = toolsCtx?.tools;
            if (!tools || typeof tools.register !== 'function')
                return;
            tools.register(buildVerifyTool(getConfig));
            log('已注册工具 verify_claims');
        });
    }
    if (cfg.promptSection) {
        ctx.inject(['systemPrompt'], (promptCtx) => {
            const systemPrompt = promptCtx?.systemPrompt;
            if (!systemPrompt || typeof systemPrompt.section !== 'function')
                return;
            systemPrompt.section({
                name: SECTION_NAME,
                order: SECTION_ORDER,
                text: promptSection(cfg.language === 'en' ? 'en' : 'zh', {
                    requireSources: cfg.requireSources,
                    guardLiveMutation: cfg.guardLiveMutation,
                }),
            });
            log(`已注入提示词段 ${SECTION_NAME}（order ${SECTION_ORDER}）`);
        });
    }
    if (cfg.autoVerify) {
        let completionGuard;
        if (cfg.requireOperationEvidence) {
            ctx.inject(['llm', 'tools'], (guardCtx) => {
                const services = guardCtx;
                const guard = createCompletionGuard(getConfig, log);
                completionGuard = guard;
                services.tools.register(guard.reviewTool);
                const installed = guard.install(guardCtx, services.llm);
                services.effect(() => () => installed.dispose());
                log('已注册最终输出审核（llm/stream）：证据审核未通过时继续取证，原草稿不显示');
            });
        }
        let subagentCtx = null;
        ctx.inject(['subagents'], (c) => { subagentCtx = c; });
        installDoubtLoop(ctx, {
            getConfig,
            log,
            probe,
            skipTurn: (agent, turn) => completionGuard?.failedTurn(agent, turn) ?? false,
            reviewedTurn: (agent, turn) => completionGuard?.reviewedTurn(agent, turn) ?? false,
            factoredHost: (agent) => {
                const subagents = subagentCtx?.subagents;
                if (!subagents || typeof subagents.start !== 'function')
                    return null;
                return { subagents, parent: agent };
            },
        });
        const tier = cfg.factored ? 'A+B+C' : 'A+B';
        log(`自动取证已开启（Tier ${tier}）：requireSources=${cfg.requireSources} maxRounds=${cfg.maxRounds} minScore=${cfg.minScore} executeAnswerCommands=${cfg.executeAnswerCommands} requireOperationEvidence=${cfg.requireOperationEvidence} operationMaxRounds=${cfg.operationMaxRounds}`);
    }
    log(`dsh-doubt v${version} 已加载（verifyTool=${cfg.verifyTool}, promptSection=${cfg.promptSection}, autoVerify=${cfg.autoVerify}, factored=${cfg.factored}, guardLiveMutation=${cfg.guardLiveMutation}）`);
}
//# sourceMappingURL=index.js.map