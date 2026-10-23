const SNIPPET_MAX = 160;
function clip(s) {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > SNIPPET_MAX ? `${t.slice(0, SNIPPET_MAX)}…` : t;
}
function codeBlocks(text) {
    const out = [];
    const re = /```([^\n`]*)\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(text)) !== null) {
        out.push({ lang: (m[1] || '').trim().toLowerCase(), body: m[2] || '' });
    }
    return out;
}
const SHELL_LANGS = new Set(['bash', 'sh', 'shell', 'zsh', 'fish', 'nu', 'console', 'ps1', 'powershell', 'pwsh', 'cmd', 'batch', 'bat']);
const SHELL_PROMPT = /^\s*(?:\$|>|PS>|C:\\[^>]*>|#)\s*(.+)$/;
const NOT_A_COMMAND = /[\u4e00-\u9fff→⇒]|=>|\|\s|\d{2}:\d{2}:\d{2}|\bPID\b|\bMiB\b|\bGiB\b|\bStatus\s*=|={3,}|-{3,}/;
const SHELL_SYNTAX = [
    /^@/,
    /^&/, // @echo off
    /^:(?!:)/,
    /\[[\w.]*\]\s*@?\{?\s*$/, // [pscustomobject]@{ 、[ordered]@{}
    /^["'][^"']*["']\s*$/, // whole-line string literal
    /^(set|setx|export|alias|unset|declare|local|readonly)\b/i, // set "X=Y" / export X=Y
    /^(if|then|elif|else|fi|for|foreach|while|until|do|done|case|esac|select|switch|foreach-object|where-object)\b/i,
    /^(env:|\$env:|function|filter|param|begin|process|end|try|catch|finally|throw|return|break|continue)\b/i,
    /^(rem|title|pause|color|prompt|ver|verify|vol|shift|goto|call|pushd|popd|setlocal|endlocal|chcp|attrib|assoc|ftype|path|exit|start-sleep)\b/i,
    /^(new-item|write-host|write-output|out-null|convertto-json|convertfrom-json|get-content|set-content|add-content|copy-item|move-item|remove-item|test-path|join-path|split-path|resolve-path|invoke-webrequest|invoke-restmethod)\b/i,
];
function isShellSyntax(cmd) {
    return SHELL_SYNTAX.some((re) => re.test(cmd));
}
function commandLines(text) {
    const out = [];
    for (const block of codeBlocks(text)) {
        const labeled = SHELL_LANGS.has(block.lang);
        for (const raw of block.body.split('\n')) {
            const line = raw.trim();
            if (!line || line.startsWith('#') || line.startsWith('//'))
                continue;
            const m = SHELL_PROMPT.exec(line);
            if (!labeled && !m)
                continue;
            const cmd = (m ? m[1] : line).trim();
            if (cmd.length <= 2)
                continue;
            if (NOT_A_COMMAND.test(cmd))
                continue;
            if (isShellSyntax(cmd))
                continue;
            if (/^[a-z][\w+.-]*:\/\//i.test(cmd))
                continue;
            if (/^-/.test(cmd))
                continue;
            if (/^\$?[A-Za-z_][\w.]*\s*=[^=]/.test(cmd))
                continue;
            const first = cmd.split(/\s+/)[0];
            if (/[\\/.]/.test(first) && /\s/.test(cmd) && !/^["']/.test(cmd))
                continue;
            out.push(cmd);
        }
    }
    return out;
}
const NOT_IN_PATH = String.raw `^\s` + '`' + String.raw `'"<>()|、。，；：！？` + String.raw `\u3000-\u303f\u4e00-\u9fff\uff00-\uffef`;
const PATH_RE = new RegExp(`(?<![A-Za-z0-9])[A-Za-z]:[/\\\\][${NOT_IN_PATH}]+|~?\\/(?:[\\w.@-]+\\/){1,}[\\w.@-]+`, 'g');
const TRAILING_PUNCT = /[.,;:!?'"）)\]]+$/;
const VERSION_RE = /(?:[vV]ersion|版本)\s*[:：]?\s*\d+(?:\.\d+){1,3}|[vV]\d+(?:\.\d+){1,3}|\^\s?\d+\.\d+\.\d+|~\d+\.\d+\.\d+|(?:[A-Za-z@][\w@/.-]*\s+)?\d+\.\d+\.\d+(?:[-+][\w.]+)?|\b\d{3,}\.\d{3,}\b/g;
const SYMBOL_RE = /`([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*){0,4}\([^`)]{0,60}\))`/g;
const PACKAGE_RE = /`((?:@[a-z0-9._-]+\/)?[a-z][a-z0-9._-]{1,60}(?:@[~^]?\d[\w.-]*)?)`/g;
const ABSOLUTE_RE = /(绝对|必然|肯定|一定能|一定会|保证|百分之百|100%|不可能出错|万无一失|一定可以|稳赢|definitely|guaranteed|certainly|always works|impossible to fail|100%\s*works)/gi;
const NUMBER_RE = /\b\d+(?:[.,]\d+)?\s*(?:MB|GB|TB|KiB|MiB|GiB|ms|s|秒|分钟|小时|行|loc|tokens?|个\s?(?:文件|条目|问题)|%|％)(?![A-Za-z0-9])/gi;
const REVERSAL_RE = /(抱歉|对不起|我之前说错|我说错|更正一下|更正：|其实刚才|刚才那(?:个|条)(?:不对|有误)|我犯(?:了)?错|sorry,?\s+i\s+(?:was\s+)?wrong|apolog)/i;
const FILE_EXT_RE = /\.(json5?|ya?ml|toml|txt|md|py|js|mjs|cjs|ts|tsx|jsx|bat|cmd|exe|dll|so|dylib|gguf|log|lock|bak\d*|csv|ini|cfg|sh|ps1|patch|diff|html|css|svg|png|jpg|zip|tar|gz|xz)$/i;
const DOMAIN_RE = /\.(com|net|org|cn|io|dev|app|edu|gov|mil|xyz|top|cc|tv|me|co|jp|kr|de|fr|ru|ir|uk|us|info|biz|ai|sh|link|cloud)$/i;
function isPlausiblePackageName(token) {
    const name = token.split('@').filter(Boolean)[0] ?? token;
    if (!name)
        return false;
    if (token.includes('://') || token.includes('\\'))
        return false;
    if (FILE_EXT_RE.test(token) || DOMAIN_RE.test(name))
        return false;
    if (/[A-Z]/.test(name))
        return false;
    if (/^\d/.test(name))
        return false;
    if (name.includes('_'))
        return false;
    return true;
}
function isPathLike(t) {
    if (!t || t.includes('\n') || t.includes('://'))
        return false;
    if (/^\\(?![\\/])/.test(t))
        return false;
    if (/[{}$`]/.test(t))
        return false;
    if (t.includes('...'))
        return false;
    if (/^\.\.[\\/]/.test(t))
        return false;
    return /^[A-Za-z]:[\\/]/.test(t) || /^~?[\\/]{2}/.test(t) || /^~?\//.test(t) || /^\.{1,2}[\\/]/.test(t);
}
function pathCandidates(text) {
    const spans = [
        ...[...text.matchAll(/`([^`\n]{2,240})`/g)].map((m) => m[1].trim()),
        ...[...text.matchAll(/<([^<>\n]{2,240})>/g)].map((m) => m[1].trim()),
    ].filter(isPathLike);
    const out = new Set(spans);
    for (const m of text.matchAll(PATH_RE)) {
        const p = m[0].replace(TRAILING_PUNCT, '');
        const whole = [...out].find((s) => s.startsWith(p));
        out.add(whole ?? p);
    }
    return [...out];
}
const DETECTORS = [
    {
        kind: 'command',
        weight: 2,
        hint: '把这条命令真的跑一遍，贴出退出码与输出，别凭记忆描述结果',
        find: (text) => commandLines(text),
    },
    {
        kind: 'path',
        weight: 1,
        hint: '确认该路径存在（列目录或读文件），不存在就改掉',
        find: (text) => pathCandidates(text),
    },
    {
        kind: 'version',
        weight: 2,
        hint: '用实际来源核对版本号（package.json / --version / 官方页面）',
        find: (text) => [...new Set(text.match(VERSION_RE) ?? [])],
    },
    {
        kind: 'symbol',
        weight: 2,
        hint: '确认该函数/方法签名真实存在（读定义处或类型声明），不要凭印象编 API',
        find: (text) => [...new Set([...text.matchAll(SYMBOL_RE)].map((m) => m[1]))],
    },
    {
        kind: 'package',
        weight: 2,
        hint: '确认包名与版本可安装（查 registry 或本地 node_modules）',
        find: (text) => [...new Set([...text.matchAll(PACKAGE_RE)].map((m) => m[1]))].filter(isPlausiblePackageName),
    },
    {
        kind: 'number',
        weight: 1,
        hint: '这个数字从哪来？给出测量方式或来源，否则改成区间/删掉',
        find: (text) => [...new Set(text.match(NUMBER_RE) ?? [])],
    },
    {
        kind: 'code',
        weight: 2,
        hint: '把代码块实际编译/运行一次，贴出真实结果',
        find: (text) => codeBlocks(text).filter((b) => !SHELL_LANGS.has(b.lang)).map((b) => `${b.lang} 代码块 ${b.body.split('\n').length} 行`),
    },
    {
        kind: 'absolute',
        weight: 2,
        hint: '绝对化结论需要证据；把「一定」换成有出处的表述，或补上验证',
        find: (text) => [...new Set(text.match(ABSOLUTE_RE) ?? [])],
    },
    {
        kind: 'reversal',
        weight: 3,
        hint: '本轮出现改口/认错：把被推翻的结论连同正确版本一起重新核验',
        find: (text) => [...new Set(text.match(REVERSAL_RE) ?? [])],
    },
];
export const DETECTOR_KINDS = DETECTORS.map((d) => d.kind);
export function scanAnswer(text, options = {}) {
    const body = String(text ?? '');
    const cap = Math.max(1, options.capPerKind ?? 3);
    const findings = [];
    let score = 0;
    for (const spec of DETECTORS) {
        if (options.detectors?.[spec.kind] === false)
            continue;
        const hits = spec.find(body).filter((s) => clip(s).length > 0);
        let counted = 0;
        for (const hit of hits) {
            if (counted >= cap)
                break;
            counted += 1;
            score += spec.weight;
            findings.push({ kind: spec.kind, weight: spec.weight, snippet: clip(hit), hint: spec.hint });
        }
    }
    findings.sort((a, b) => b.weight - a.weight);
    return { score, findings, chars: body.length };
}
export function turnHadVerification(toolNames, allowed) {
    const set = new Set(allowed);
    for (const name of toolNames)
        if (set.has(name))
            return true;
    return false;
}
const DELIVERABLE_RE = /\.(md|mdx|markdown|txt|rst|adoc)$/i;
const DELIVERABLE_EXCLUDE_RE = /(^|[\\/])(logs?|tmp|temp|\.cache|node_modules|dist|build|out|\.git)([\\/]|$)/i;
const DOC_WRITER_TOOLS = new Set(['write', 'edit', 'ops_replace', 'str_replace_editor', 'create_file', 'apply_patch']);
export function writtenDeliverables(events, turn) {
    const out = new Set();
    for (const raw of events) {
        const ev = raw;
        if (ev?.type !== 'tool/call' || Number(ev.data?.turn) !== turn)
            continue;
        if (!DOC_WRITER_TOOLS.has(String(ev.data?.name ?? '')))
            continue;
        const rawArgs = ev.data?.arguments;
        let args = null;
        if (typeof rawArgs === 'string') {
            try {
                args = JSON.parse(rawArgs);
            }
            catch {
                args = null;
            }
        }
        else if (rawArgs && typeof rawArgs === 'object') {
            args = rawArgs;
        }
        const p = args?.file_path ?? args?.path ?? args?.filePath ?? args?.target;
        if (typeof p === 'string' && DELIVERABLE_RE.test(p) && !DELIVERABLE_EXCLUDE_RE.test(p))
            out.add(p);
    }
    return [...out];
}
export function agentWorkspace(agent) {
    const cwd = agent?.session?.header?.cwd;
    return typeof cwd === 'string' && cwd.trim() ? cwd : null;
}
export function sessionCwd(events) {
    for (const raw of events) {
        const ev = raw;
        if (ev?.type !== 'session')
            continue;
        if (typeof ev.cwd === 'string' && ev.cwd.trim())
            return ev.cwd;
    }
    return null;
}
export function extractTurn(events, turn) {
    let text = '';
    let finalText = '';
    const toolNames = [];
    for (const raw of events) {
        const ev = raw;
        if (!ev || typeof ev.type !== 'string' || !ev.data)
            continue;
        if (Number(ev.data.turn) !== turn)
            continue;
        if (ev.type === 'assistant/message') {
            const part = collectText(ev.data.message);
            text += `${part}\n`;
            if (part.trim())
                finalText = part;
        }
        else if (ev.type === 'tool/call' || ev.type === 'tool/result') {
            const name = ev.data.name ?? ev.data.toolName ?? ev.data.call?.name;
            if (typeof name === 'string')
                toolNames.push(name);
        }
    }
    return { turn, text, finalText, toolNames };
}
export function collectText(message) {
    if (!message)
        return '';
    if (typeof message === 'string')
        return message;
    const content = message.content ?? message;
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return '';
    const parts = [];
    for (const item of content) {
        if (!item || typeof item !== 'object')
            continue;
        const part = item;
        if (part.type === 'text' && typeof part.text === 'string')
            parts.push(part.text);
        else if (typeof part.text === 'string' && part.type !== 'tool-call')
            parts.push(part.text);
    }
    return parts.join('\n');
}
export function lastTurn(events) {
    let turn = 0;
    for (const raw of events) {
        const ev = raw;
        if (ev?.type === 'turn/end' && Number.isFinite(Number(ev.data?.turn)))
            turn = Number(ev.data.turn);
    }
    return turn;
}
//# sourceMappingURL=scanner.js.map