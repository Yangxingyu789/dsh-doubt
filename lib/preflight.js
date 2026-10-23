import { classifyToolCall } from './guard.js';
const describe = (finding) => `dsh-doubt 危险变更闸门：识别到 ${finding.kind} 类操作（${finding.rule}，目标 ${finding.target}）。`
    + '该操作会改动正在运行的宿主/系统，执行前必须由用户确认：先说明影响面、给出备份位置与可直接执行的回滚命令，再征得用户明确同意（宿主批准提示或用户消息中的明确确认）。';
export function createPreflightGuard(getConfig, host) {
    return async function preflight(exec, next) {
        const cfg = getConfig();
        if (!cfg.guardPreExecute)
            return next();
        const downstream = await next();
        try {
            if (downstream && downstream.kind !== undefined && downstream.kind !== 'allow')
                return downstream;
            if (!exec || typeof exec.name !== 'string')
                return downstream;
            const args = exec.arguments ?? exec.args ?? {};
            const finding = classifyToolCall(exec.name, args, cfg);
            if (!finding)
                return downstream;
            const reason = describe(finding);
            let approval;
            try {
                approval = host.approval();
            }
            catch {
                approval = undefined;
            }
            let policy;
            try {
                policy = approval?.overrideOf?.(exec.agent?.session);
            }
            catch {
                policy = undefined;
            }
            if (!exec.agent || !approval || policy === 'never') {
                return {
                    kind: 'deny',
                    reason: `${reason}\n当前没有可用于该操作的权限审批通道（approval 缺失或策略为 never），因此已拒绝执行。请改为：向用户说明影响面并等待用户明确确认；若用户同意，请其把审批策略切换为允许询问后重试。`,
                };
            }
            return {
                kind: 'ask',
                reason,
                displayReason: {
                    en: `dsh-doubt: this call mutates the running host (${finding.kind}: ${finding.rule}). Approve only if you expect it.`,
                    zh: `dsh-doubt：该操作会改动运行中的宿主（${finding.kind}: ${finding.rule}），确认要执行吗？`,
                },
            };
        }
        catch {
            return downstream;
        }
    };
}
//# sourceMappingURL=preflight.js.map