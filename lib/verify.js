import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import vm from 'node:vm';
import { commandAvailability, packageVersion, symbolExists, versionClaim } from './local.js';
const OUTPUT_MAX = 4000;
function clip(s) {
    const t = String(s ?? '');
    return t.length > OUTPUT_MAX ? `${t.slice(0, OUTPUT_MAX)}\n…（已截断）` : t;
}
function baseName(bin) {
    const cleaned = bin.replace(/"/g, '').trim();
    const parts = cleaned.split(/[\\/]/);
    return (parts[parts.length - 1] ?? cleaned).toLowerCase();
}
const WIN_EXEC_EXTS = ['.exe', '.com', '.bat', '.cmd', '.ps1', '.vbs', '.js', '.msc', '.scr', '.pif'];
function denyName(bin) {
    const base = baseName(bin);
    for (const ext of WIN_EXEC_EXTS) {
        if (base.length > ext.length && base.endsWith(ext))
            return base.slice(0, -ext.length);
    }
    return base;
}
function matchExpect(text, check) {
    if (check.expectMatch) {
        const ok = text.includes(check.expectMatch);
        return { ok, why: ok ? `输出包含 "${check.expectMatch}"` : `输出不含 "${check.expectMatch}"` };
    }
    if (check.expectRegex) {
        let re;
        try {
            re = new RegExp(check.expectRegex);
        }
        catch (e) {
            return { ok: false, why: `expectRegex 非法：${String(e)}` };
        }
        const ok = re.test(text);
        return { ok, why: ok ? `输出匹配 /${check.expectRegex}/` : `输出不匹配 /${check.expectRegex}/` };
    }
    return { ok: true, why: '退出码符合预期' };
}
function winQuote(arg) {
    if (arg === '')
        return '""';
    if (!/[\s"^&|<>()%!]/.test(arg))
        return arg;
    const escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1');
    return `"${escaped}"`;
}
async function runCommand(check, opts) {
    const argv = Array.isArray(check.argv) ? check.argv.filter((a) => typeof a === 'string') : [];
    if (argv.length === 0)
        return { ok: false, kind: 'command', claim: check.claim, detail: 'argv 为空：需要 [程序, 参数...]' };
    const bin = argv[0] ?? '';
    const name = baseName(bin);
    if (opts.denyBinaries.includes(denyName(bin))) {
        return { ok: false, kind: 'command', claim: check.claim, detail: `拒绝执行被禁止的程序：${bin}` };
    }
    const expectExit = Number.isFinite(check.expectExit) ? Number(check.expectExit) : 0;
    const timeoutMs = Number.isFinite(check.timeoutMs) ? Number(check.timeoutMs) : opts.timeoutMs;
    const isWin = process.platform === 'win32';
    const needsCmd = isWin && /\.(cmd|bat)$/.test(name);
    const child = needsCmd
        ? spawn('cmd.exe', ['/d', '/s', '/c', [bin, ...argv.slice(1)].map(winQuote).join(' ')], {
            cwd: opts.cwd,
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        : spawn(bin, argv.slice(1), { cwd: opts.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { if (stdout.length < OUTPUT_MAX * 2)
        stdout += String(d); });
    child.stderr?.on('data', (d) => { if (stderr.length < OUTPUT_MAX * 2)
        stderr += String(d); });
    const settled = await new Promise((resolve) => {
        let done = false;
        let hardTimer;
        const finish = (v) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            if (hardTimer)
                clearTimeout(hardTimer);
            resolve(v);
        };
        const timer = setTimeout(() => {
            try {
                child.kill('SIGKILL');
            }
            catch { /* ignore */ }
            if (process.platform === 'win32' && child.pid) {
                try {
                    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
                }
                catch { /* ignore */ }
            }
            hardTimer = setTimeout(() => finish({ code: null, signal: 'SIGKILL', forced: true }), 2000);
        }, timeoutMs);
        child.once('error', (error) => finish({ code: null, signal: null, error }));
        child.once('close', (code, signal) => finish({ code, signal }));
    });
    const head = `$ ${argv.join(' ')}`;
    if (settled.error) {
        return { ok: false, kind: 'command', claim: check.claim, detail: `${head}\n启动失败：${settled.error.message}` };
    }
    if (settled.signal) {
        const extra = settled.forced ? '；进程树未在 2s 内退出，已放弃等待（输出可能不完整）' : '';
        return { ok: false, kind: 'command', claim: check.claim, detail: `${head}\n超时 ${timeoutMs}ms 被终止（${settled.signal}）${extra}` };
    }
    const code = settled.code ?? -1;
    const body = `退出码 ${code}\nstdout: ${clip(stdout.trim()) || '(空)'}\nstderr: ${clip(stderr.trim()) || '(空)'}`;
    const exitOk = code === expectExit;
    const contentOk = matchExpect(`${stdout}\n${stderr}`, check);
    const ok = exitOk && contentOk.ok;
    const why = exitOk ? contentOk.why : `期望退出码 ${expectExit}，实际 ${code}`;
    return { ok, kind: 'command', claim: check.claim, detail: `${head}\n判定：${why}\n${body}` };
}
function runFileExists(check) {
    const p = String(check.path ?? '');
    if (!p)
        return { ok: false, kind: 'fileExists', claim: check.claim, detail: 'path 为空' };
    try {
        const st = statSync(p);
        return { ok: true, kind: 'fileExists', claim: check.claim, detail: `存在：${p}（${st.isDirectory() ? '目录' : `${st.size} 字节`}）` };
    }
    catch (e) {
        const code = e?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            return { ok: false, kind: 'fileExists', claim: check.claim, detail: `不存在：${p}` };
        }
        return { ok: false, kind: 'fileExists', claim: check.claim, detail: `无法判定 ${p}：stat 失败 ${code ?? String(e)}（不是「不存在」，别据此下结论）` };
    }
}
const FILE_MATCH_MAX_BYTES = 32 * 1024 * 1024;
const REGEX_BUDGET_MS = 3000;
function runFileMatch(check) {
    const p = String(check.path ?? '');
    if (!p)
        return { ok: false, kind: 'fileMatch', claim: check.claim, detail: 'path 为空' };
    const pattern = String(check.regex ?? '');
    if (!pattern)
        return { ok: false, kind: 'fileMatch', claim: check.claim, detail: 'regex 为空：没有断言任何内容，不算通过' };
    let text;
    try {
        const st = statSync(p);
        if (!st.isFile())
            return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `不是普通文件：${p}` };
        if (st.size > FILE_MATCH_MAX_BYTES) {
            return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `${p} 有 ${st.size} 字节，超过 ${FILE_MATCH_MAX_BYTES} 字节上限，未读取` };
        }
        text = readFileSync(p, 'utf8');
    }
    catch (e) {
        const code = e?.code;
        if (code === 'ENOENT' || code === 'ENOTDIR')
            return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `文件不存在：${p}` };
        return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `无法判定 ${p}：读取失败 ${code ?? String(e)}（不是「不存在」）` };
    }
    let m;
    try {
        m = vm.runInNewContext('const re = new RegExp(P); const r = re.exec(H); r ? { index: r.index, text: r[0] } : null', { P: pattern, H: text }, { timeout: Math.min(REGEX_BUDGET_MS, 3000) });
    }
    catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        if (/timed out/i.test(msg)) {
            return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `/${pattern}/ 在 ${p} 上超过 ${REGEX_BUDGET_MS}ms 预算（疑似灾难性回溯），未得出结论` };
        }
        return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `regex 非法：${msg}` };
    }
    if (!m)
        return { ok: false, kind: 'fileMatch', claim: check.claim, detail: `${p} 不匹配 /${pattern}/` };
    const line = text.slice(0, m.index).split('\n').length;
    return { ok: true, kind: 'fileMatch', claim: check.claim, detail: `${p}:${line} 匹配 /${pattern}/ → ${clip(m.text)}` };
}
async function runHttp(check, opts) {
    const url = String(check.url ?? '');
    if (!/^https?:\/\//i.test(url))
        return { ok: false, kind: 'httpStatus', claim: check.claim, detail: `url 非法：${url || '(空)'}` };
    const want = Number.isFinite(check.expectStatus) ? Number(check.expectStatus) : undefined;
    try {
        const budget = Number.isFinite(check.timeoutMs) ? Number(check.timeoutMs) : opts.timeoutMs;
        const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(budget) });
        const ok = want === undefined ? res.status >= 200 && res.status < 300 : res.status === want;
        return { ok, kind: 'httpStatus', claim: check.claim, detail: `${url} → HTTP ${res.status}（期望 ${want ?? '2xx'}）` };
    }
    catch (e) {
        return { ok: false, kind: 'httpStatus', claim: check.claim, detail: `${url} 请求失败：${String(e instanceof Error ? e.message : e)}` };
    }
}
const EXPR_RUNNER = String.raw `
import vm from 'node:vm'
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (d) => { input += d })
process.stdin.on('end', () => {
  let out
  try {
    const req = JSON.parse(input)
    const program = '(function(){ var v = (' + req.source + ');'
      + ' if (v !== null && (typeof v === "object" || typeof v === "function") && typeof v.then === "function") return "\\u0000PROMISE";'
      + ' if (typeof v === "string") return v;'
      + ' try { var s = JSON.stringify(v); return s === undefined ? String(v) : s } catch (e) { return String(v) } })()'
    const text = vm.runInNewContext(program, Object.create(null), { timeout: req.timeoutMs, microtaskMode: 'afterEvaluate' })
    out = { ok: true, text: String(text) }
  } catch (e) {
    out = { ok: false, error: String(e && e.message ? e.message : e) }
  }
  try { process.stdout.write(JSON.stringify(out)) } catch { /* ignore */ }
  process.exit(0)
})
`;
function runExprChild(source, timeoutMs) {
    return new Promise((resolve) => {
        let child;
        try {
            child = spawn(process.execPath, ['--input-type=module', '-e', EXPR_RUNNER], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
        }
        catch (e) {
            resolve({ ok: false, error: `无法启动求值子进程：${String(e)}` });
            return;
        }
        let out = '';
        let done = false;
        let hardTimer;
        const finish = (v) => {
            if (done)
                return;
            done = true;
            if (hardTimer)
                clearTimeout(hardTimer);
            try {
                child.kill('SIGKILL');
            }
            catch { /* ignore */ }
            resolve(v);
        };
        try {
            child.stdin?.end(JSON.stringify({ source, timeoutMs }));
        }
        catch { /* ignore */ }
        child.stdout?.on('data', (d) => { if (out.length < 200_000)
            out += String(d); });
        hardTimer = setTimeout(() => finish({ ok: false, error: `expr 子进程超过 ${timeoutMs + 2000}ms 未返回，已终止（载荷疑似死循环）` }), timeoutMs + 2000);
        child.once('error', (e) => finish({ ok: false, error: `求值子进程启动失败：${e.message}` }));
        child.once('close', (code) => {
            if (done)
                return;
            if (code !== 0) {
                finish({ ok: false, error: `求值子进程异常退出（code ${code}）` });
                return;
            }
            try {
                const parsed = JSON.parse(out || '{}');
                if (parsed.ok)
                    finish({ ok: true, text: String(parsed.text ?? '') });
                else
                    finish({ ok: false, error: `求值失败：${String(parsed.error ?? '未知错误')}` });
            }
            catch {
                finish({ ok: false, error: '求值子进程输出无法解析' });
            }
        });
    });
}
async function runExpr(check, opts) {
    const source = String(check.source ?? '');
    if (!source)
        return { ok: false, kind: 'expr', claim: check.claim, detail: 'source 为空' };
    const want = Number.isFinite(check.timeoutMs) ? Number(check.timeoutMs) : opts.timeoutMs;
    const budget = Math.min(Math.max(want, 50), 10_000);
    const res = await runExprChild(source, budget);
    if (!res.ok) {
        return { ok: false, kind: 'expr', claim: check.claim, detail: `${source} ${res.error}` };
    }
    if (res.text === '\u0000PROMISE') {
        return {
            ok: false,
            kind: 'expr',
            claim: check.claim,
            detail: `${source} 返回了 Promise：expr 只做同步求值，异步结果无法核验（已丢弃，未等待）`,
        };
    }
    const text = res.text;
    if (!check.expectMatch && !check.expectRegex) {
        return { ok: false, kind: 'expr', claim: check.claim, detail: `${source} → ${clip(text)}\n没有给出 expectMatch / expectRegex：expr 无法自行判定，不算通过` };
    }
    const verdict = matchExpect(text, check);
    return { ok: verdict.ok, kind: 'expr', claim: check.claim, detail: `${source} → ${clip(text)}\n判定：${verdict.why}` };
}
function runTextEquals(check) {
    const actual = String(check.actual ?? '');
    const expected = String(check.expected ?? '');
    if (actual.trim() === '' && expected.trim() === '') {
        return { ok: false, kind: 'textEquals', claim: check.claim, detail: 'actual 与 expected 都为空：没有断言任何内容，不算通过' };
    }
    const ok = actual.trim() === expected.trim();
    return { ok, kind: 'textEquals', claim: check.claim, detail: ok ? '一致' : `不一致\nactual:   ${clip(actual)}\nexpected: ${clip(expected)}` };
}
function oracleOutcome(r) {
    if (r.noEvidence) {
        return { ok: false, kind: r.kind, claim: r.claim, detail: r.detail || '本机没有可比的来源' };
    }
    const strong = r.sources.filter((s) => s.ok && !s.weak).length;
    if (strong === 0) {
        return { ok: false, kind: r.kind, claim: r.claim, detail: `${r.detail}\n（只有弱证据，不能算通过）` };
    }
    return { ok: r.ok, kind: r.kind, claim: r.claim, detail: r.detail };
}
export async function runCheck(check, opts) {
    const cwd = String(check.cwd ?? opts.cwd ?? process.cwd());
    switch (check.kind) {
        case 'command': return runCommand(check, opts);
        case 'fileExists': return runFileExists(check);
        case 'fileMatch': return runFileMatch(check);
        case 'httpStatus': return runHttp(check, opts);
        case 'expr': return runExpr(check, opts);
        case 'textEquals': return runTextEquals(check);
        case 'commandAvailability': return oracleOutcome(commandAvailability(String(check.claim ?? check.argv?.join(' ') ?? ''), check.argv ?? []));
        case 'packageVersion': return oracleOutcome(packageVersion(String(check.claim ?? check.name ?? ''), String(check.name ?? ''), cwd));
        case 'versionClaim': return oracleOutcome(versionClaim(String(check.claim ?? check.expected ?? ''), cwd, check.name));
        case 'symbolExists': return oracleOutcome(symbolExists(String(check.signature ?? check.claim ?? check.source ?? ''), cwd));
        default: return { ok: false, kind: String(check?.kind ?? 'unknown'), claim: check?.claim, detail: `未知 check.kind：${String(check?.kind)}` };
    }
}
export async function runChecks(checks, opts) {
    const out = [];
    for (const c of checks)
        out.push(await runCheck(c, opts));
    return out;
}
//# sourceMappingURL=verify.js.map