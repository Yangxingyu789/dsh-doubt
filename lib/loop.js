import { randomUUID } from 'node:crypto';
import { extractClaims } from './claims.js';
import { gatherEvidence } from './evidence.js';
import { factoredCheck } from './factored.js';
import { buildEvidenceText, buildProvenanceText, buildRecheckText, detectLanguage } from './prompts.js';
import { agentWorkspace, extractTurn, lastTurn, scanAnswer, sessionCwd, writtenDeliverables } from './scanner.js';
const SESSION_CAP = 200;
const SESSION_EVICT = 50;
const PROVENANCE_MIN_CHARS = 1200;
const PROVENANCE_MAX_ASKS = 4;
const docKey = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
const PROVENANCE_SECTION_RE = /(^|\n)[ \t]*#{1,6}[ \t]*[^\n]{0,40}(溯源|出处|逐步骤|参考文献|来源总表|来源表|来源清单|引用清单|未验证项|依据表)/;
export const SOURCE_KIND = 'dsh-doubt';
function sessionEvents(agent) {
    const session = agent.session;
    if (!session)
        return [];
    try {
        if (typeof session.snapshotEvents === 'function')
            return session.snapshotEvents() ?? [];
    }
    catch { /* ignore */ }
    try {
        if (Array.isArray(session.events))
            return session.events;
    }
    catch { /* ignore */ }
    return [];
}
function inboxBusy(agent) {
    try {
        const inbox = agent.inbox;
        if (!inbox)
            return false;
        if (typeof inbox.hasPending === 'function' && inbox.hasPending())
            return true;
        if (typeof inbox.size === 'number' && inbox.size > 0)
            return true;
        if (typeof inbox.length === 'number' && inbox.length > 0)
            return true;
    }
    catch { /* ignore */ }
    return false;
}
function turnEntrySource(events, turn) {
    const kindOf = (i) => {
        const ev = events[i];
        const kind = ev.data?.source?.kind;
        return typeof kind === 'string' ? kind : '';
    };
    let start = -1;
    let end = -1;
    for (let i = 0; i < events.length; i += 1) {
        const ev = events[i];
        if (ev?.type === 'turn/end' && Number(ev.data?.turn) === turn) {
            end = i;
            break;
        }
        if (start < 0 && ev?.type === 'turn/start' && Number(ev.data?.turn) === turn)
            start = i;
    }
    if (end < 0)
        return '';
    if (start >= 0) {
        for (let i = start; i <= end; i += 1) {
            if (events[i]?.type === 'user/message')
                return kindOf(i);
        }
        return '';
    }
    for (let i = end; i >= 0; i -= 1) {
        if (events[i]?.type === 'user/message')
            return kindOf(i);
    }
    return '';
}
function makeMessage(text, summary = 'evidence') {
    return {
        id: `${SOURCE_KIND}-${randomUUID()}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: SOURCE_KIND, form: 'notice', summary },
    };
}
export function toQuestion(claim) {
    switch (claim.kind) {
        case 'package':
            return `npm 包 \`${claim.text}\` 是否存在于 npm registry？只回答 yes 或 no。`;
        case 'path':
            return `文件路径 \`${claim.text}\` 是否存在？只回答 yes 或 no。`;
        case 'command':
            return `程序 \`${claim.text.split(/\s+/)[0]}\` 是否可在本机 PATH 中找到？只回答 yes 或 no。`;
        case 'version':
            return `版本号 \`${claim.text}\` 是否与本机实际安装版本一致？回答 yes/no，若否给出实际版本。`;
        case 'symbol':
            return `标识符 \`${claim.text}\` 是否真实存在于相关依赖或源码中？只回答 yes 或 no。`;
        default:
            return null;
    }
}
export function installDoubtLoop(ctx, options) {
    const log = options.log ?? (() => { });
    const delayMs = Number.isFinite(options.delayMs) ? Number(options.delayMs) : 150;
    const slots = new Map();
    const timers = new Set();
    const evaluating = new Set();
    let disposed = false;
    function slot(sessionId) {
        if (!sessionId)
            return null;
        let cur = slots.get(sessionId);
        if (!cur) {
            if (slots.size >= SESSION_CAP) {
                let i = 0;
                for (const key of slots.keys()) {
                    if (i >= SESSION_EVICT)
                        break;
                    slots.delete(key);
                    i += 1;
                }
            }
            cur = { rounds: 0, handledTurn: 0, askedDocs: new Set(), provAsks: 0 };
            slots.set(sessionId, cur);
        }
        return cur;
    }
    async function evaluate(agent) {
        const id = String(agent.id ?? agent.session?.id ?? '');
        if (disposed || evaluating.has(id))
            return;
        evaluating.add(id);
        try {
            await evaluateTurn(agent);
        }
        finally {
            evaluating.delete(id);
        }
    }
    async function evaluateTurn(agent) {
        const cfg = options.getConfig();
        if (!cfg.enabled || !cfg.autoVerify)
            return;
        if (agent.status === 'running' || inboxBusy(agent))
            return;
        const sessionId = String(agent.id ?? agent.session?.id ?? '');
        const entry = slot(sessionId);
        if (!entry)
            return;
        const events = [...sessionEvents(agent)];
        const turn = lastTurn(events);
        if (turn <= 0 || entry.handledTurn === turn)
            return;
        if (options.skipTurn?.(agent, turn)) {
            entry.handledTurn = turn;
            return;
        }
        const end = events.findLast((e) => e?.type === 'turn/end' && Number(e.data?.turn) === turn);
        // DSH records reason as { kind: 'completed' }; older fixtures used a string.
        const endReason = typeof end?.data?.reason === 'string' ? end.data.reason : end?.data?.reason?.kind;
        if (endReason && endReason !== 'completed')
            return;
        const entrySource = turnEntrySource(events, turn);
        if (entrySource !== SOURCE_KIND) {
            entry.rounds = 0;
            entry.provAsks = 0;
        }
        const extract = extractTurn(events, turn);
        if (extract.text.length < cfg.minAnswerChars)
            return;
        const scan = scanAnswer(extract.text, { detectors: cfg.detectors });
        //
        //
        //
        if (cfg.requireProvenance && entry.provAsks < PROVENANCE_MAX_ASKS && extract.text.length >= PROVENANCE_MIN_CHARS) {
            const written = writtenDeliverables(events, turn);
            if (written.length > 0) {
                const fresh = written.filter((p) => !entry.askedDocs.has(docKey(p)));
                for (const p of written)
                    entry.askedDocs.add(docKey(p));
                if (fresh.length > 0 && scan.score >= cfg.minScore) {
                    const hasProvenance = PROVENANCE_SECTION_RE.test(extract.text);
                    if (!hasProvenance && typeof agent.followup === 'function') {
                        agent.followup(makeMessage(buildProvenanceText({ files: fresh, score: scan.score, findings: scan.findings }, detectLanguage(extract.text, cfg.language)), 'provenance'));
                        entry.handledTurn = turn;
                        entry.provAsks += 1;
                        log(`dsh-doubt：turn ${turn} 写了交付文档但正文没有出处标注（风险分 ${scan.score}），已要求逐步骤溯源表（第 ${entry.provAsks} 次）：${fresh.join(' / ')}`);
                        return;
                    }
                }
            }
        }
        // Completion review already checked this prose against evidence. Keep the
        // independent deliverable requirement above, but do not audit it again via
        // legacy claims or create factored children after the answer was accepted.
        if (options.reviewedTurn?.(agent, turn)) {
            entry.handledTurn = turn;
            return;
        }
        if (entry.rounds >= cfg.maxRounds)
            return;
        if (scan.score < cfg.minScore)
            return;
        const claims = extractClaims(scan.findings, { executeAnswerCommands: cfg.executeAnswerCommands, text: extract.text });
        if (claims.length === 0)
            return;
        const net = options.probe
            ? await options.probe.state()
            : { online: false };
        const workspace = agentWorkspace(agent) ?? sessionCwd(events) ?? undefined;
        const evidence = await gatherEvidence(claims, cfg, { online: net.online, probedAt: Date.now(), latencyMs: 0 }, workspace);
        const actionable = evidence.filter((e) => e.verdict !== 'confirmed');
        const factored = {};
        if (cfg.factored) {
            const need = actionable.filter((e) => e.verdict === 'unverifiable' || e.verdict === 'inconclusive');
            const host = options.factoredHost?.(agent) ?? null;
            for (const e of need.slice(0, 3)) {
                const claim = claims.find((c) => c.id === e.claimId);
                const q = claim ? toQuestion(claim) : null;
                if (!q)
                    continue;
                factored[e.claimId] = await factoredCheck(q, {
                    provider: cfg.factoredProvider,
                    votes: cfg.factoredVotes,
                    timeoutMs: cfg.timeoutMs,
                }, host);
            }
        }
        const mechanical = evidence.filter((e) => e.verdict !== 'unverifiable');
        const hard = evidence.filter((e) => e.verdict === 'refuted' || (e.verdict === 'inconclusive' && e.contradicting > 0));
        const disagreed = Object.values(factored).some((f) => f.available && f.majority === null);
        if (hard.length === 0 && !disagreed) {
            const ok = evidence.filter((e) => e.verdict === 'confirmed').length;
            const unk = evidence.filter((e) => e.verdict === 'unverifiable').length;
            log(`dsh-doubt：turn ${turn} ${evidence.length} 条断言（证实 ${ok}／无法核验 ${unk}），没有正面反驳，不打扰`);
            entry.handledTurn = turn;
            return;
        }
        const lang = detectLanguage(extract.text, cfg.language);
        let text;
        if (mechanical.length === 0 && Object.keys(factored).every((k) => !factored[k].available)) {
            text = buildRecheckText(claims, scan.score, lang, cfg.maxFindings);
        }
        else {
            text = buildEvidenceText({
                evidence: hard.concat(mechanical.filter((e) => e.verdict === 'inconclusive' && e.contradicting === 0)),
                factored: Object.keys(factored).length > 0 ? factored : undefined,
                strictLabeling: cfg.strictLabeling,
                requireSources: cfg.requireSources,
                online: net.online,
            }, lang);
        }
        if (disposed || agent.status === 'running' || inboxBusy(agent)
            || sessionEvents(agent).length !== events.length || !options.getConfig().enabled
            || typeof agent.followup !== 'function')
            return;
        try {
            agent.followup(makeMessage(text));
            entry.handledTurn = turn;
            entry.rounds += 1;
            const counts = actionable.reduce((acc, e) => {
                acc[e.verdict] = (acc[e.verdict] ?? 0) + 1;
                return acc;
            }, {});
            log(`dsh-doubt：turn ${turn} 风险分 ${scan.score}，已注入实测证据（${Object.entries(counts).map(([k, v]) => `${k}×${v}`).join(' ')}），第 ${entry.rounds} 轮`);
        }
        catch (e) {
            log('dsh-doubt：followup 失败', e);
        }
    }
    function listen(name, handler) {
        if (typeof ctx?.on !== 'function')
            return null;
        try {
            const off = ctx.on(name, handler, { global: true });
            return typeof off === 'function' ? off : null;
        }
        catch {
            try {
                const off = ctx.on(name, handler);
                return typeof off === 'function' ? off : null;
            }
            catch {
                return null;
            }
        }
    }
    const offStatus = listen('agent/status', (payload) => {
        const agent = payload?.agent;
        if (!agent || payload?.status !== 'idle')
            return;
        const timer = setTimeout(() => {
            timers.delete(timer);
            evaluate(agent).catch((e) => log('dsh-doubt：取证评估异常', e));
        }, delayMs);
        timers.add(timer);
    });
    return {
        dispose() {
            disposed = true;
            for (const timer of timers)
                clearTimeout(timer);
            timers.clear();
            slots.clear();
            try {
                offStatus?.();
            }
            catch { /* ignore */ }
        },
    };
}
//# sourceMappingURL=loop.js.map