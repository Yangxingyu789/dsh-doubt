import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
function selfPackageRoot() {
    try {
        return walkUp(dirname(fileURLToPath(import.meta.url)), (d) => existsSync(join(d, 'package.json'))) ?? '';
    }
    catch {
        return '';
    }
}
function noEvidence(kind, claim, why) {
    return { kind, claim, ok: false, noEvidence: true, sources: [], detail: why };
}
const PKG_STOPWORDS = new Set(['version', 'versions', 'ver', 'v', 'to', 'at', 'is', 'in', 'and', 'or', 'the', 'from', 'with', 'requires', 'require', 'using', 'use', 'installed', 'install', 'latest', 'current']);
const PKG_HINT_RE = /^(@?[\w@/.-]+)\s+\d+\.\d+/;
function hintName(claim) {
    const raw = PKG_HINT_RE.exec(claim.trim())?.[1] ?? '';
    const bare = raw.replace(/^@?([\w.-]+)\/?/, '$1');
    if (!raw || PKG_STOPWORDS.has(raw.toLowerCase()) || PKG_STOPWORDS.has(bare.toLowerCase()))
        return '';
    return raw;
}
function summarize(kind, claim, sources) {
    const supporting = sources.filter((s) => s.ok);
    const detail = sources.map((s) => `${s.ok ? '✓' : '✗'} [${s.label}] ${s.value}`).join('\n');
    return { kind, claim, ok: supporting.length > 0, noEvidence: sources.length === 0, sources, detail };
}
const SELF_PACKAGE_NAME = (() => {
    try {
        const pkg = readJson(join(selfPackageRoot(), 'package.json'));
        return typeof pkg?.name === 'string' ? pkg.name : null;
    }
    catch {
        return null;
    }
})();
const selfDirCache = new Map();
function insideSelfPackage(p) {
    if (!SELF_PACKAGE_NAME)
        return false;
    let dir = p;
    for (let i = 0; i < 8; i += 1) {
        const cached = selfDirCache.get(dir);
        if (cached !== undefined)
            return cached;
        const pkg = readJson(join(dir, 'package.json'));
        if (pkg) {
            const hit = pkg.name === SELF_PACKAGE_NAME;
            selfDirCache.set(dir, hit);
            return hit;
        }
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return false;
}
function walkUp(start, visit) {
    let dir = resolve(start);
    for (let i = 0; i < 12; i += 1) {
        if (visit(dir))
            return dir;
        const parent = dirname(dir);
        if (parent === dir)
            break;
        dir = parent;
    }
    return null;
}
function readJson(path) {
    try {
        return JSON.parse(readFileSync(path, 'utf8'));
    }
    catch {
        return null;
    }
}
export function which(bin) {
    const cleaned = bin.replace(/"/g, '').trim();
    if (!cleaned)
        return null;
    if (cleaned.includes('/') || cleaned.includes('\\')) {
        const direct = resolve(cleaned);
        try {
            if (existsSync(direct) && statSync(direct).isFile())
                return direct;
        }
        catch { /* ignore */ }
    }
    const pathVar = process.env.PATH ?? process.env.Path ?? '';
    const isWin = process.platform === 'win32';
    const exts = isWin ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : [''];
    const names = [];
    const seenName = new Set();
    const add = (n) => {
        const k = isWin ? n.toLowerCase() : n;
        if (seenName.has(k))
            return;
        seenName.add(k);
        names.push(n);
    };
    add(cleaned);
    for (const ext of exts) {
        add(cleaned + ext.toLowerCase());
        add(cleaned + ext);
    }
    for (const dir of pathVar.split(isWin ? ';' : ':')) {
        if (!dir)
            continue;
        for (const name of names) {
            const cand = join(dir, name);
            try {
                if (existsSync(cand) && statSync(cand).isFile())
                    return cand;
            }
            catch { /* ignore */ }
        }
    }
    return null;
}
const PS_CMDLET_RE = /^(Get|Set|New|Remove|Copy|Move|Rename|Test|Add|Out|Select|Where|ForEach|Measure|Write|Invoke|Start|Stop|Restart|Wait|Import|Export|ConvertFrom|ConvertTo|Format|Clear|Read|Install|Update|Push|Pop|Use)-[A-Z]\w+$/;
const PS_ALIASES = new Set(['irm', 'iwr', 'ise', 'ips', 'gcm', 'gci', 'gps', 'ps', 'sls', 'cat', 'cp', 'ls', 'mv', 'rm', 'echo', 'cd', 'cls', 'clear', 'write', 'select', 'where', 'foreach', 'measure', 'sort', 'group']);
const POSIX_ONLY = new Set(['df', 'free', 'lscpu', 'lsblk', 'top', 'htop', 'grep', 'awk', 'sed', 'du', 'ls', 'cp', 'mv', 'rm', 'nvidia-smi', 'journalctl', 'systemctl', 'apt', 'apt-get', 'yum', 'dnf', 'pacman', 'apk', 'zypper', 'brew', 'launchctl', 'ssh', 'scp', 'rsync', 'python3', 'pip3', 'bash', 'sh', 'zsh', 'vllm', 'cuda', 'tr', 'cut', 'sort', 'uniq', 'head', 'tail', 'wc', 'xargs', 'chmod', 'chown', 'ln', 'touch', 'find', 'which', 'sudo', 'service', 'systemd']);
/**
 * Device/vendor CLIs run on ANOTHER machine (the NPU/GPU server), by definition.
 * Measured: the only `refuted` verdict on a real 46k-char deployment manual was
 * `npu-smi info` -> "npu-smi not on PATH". Asserting the answer is wrong because
 * this Windows workstation lacks the Ascend tool is a pure false refutation.
 */
const REMOTE_DEVICE_TOOLS = new Set(['npu-smi', 'nvidia-smi', 'rocm-smi', 'hccn_tool', 'ibstat', 'ibv_devinfo', 'mlxconfig', 'ascend-dmi', 'dcmi', 'ipmitool', 'racadm']);
function notApplicableHere(bin) {
    const bare = bin.replace(/\.(exe|cmd|bat)$/i, '').replace(/\.+$/, '');
    if (REMOTE_DEVICE_TOOLS.has(bare.toLowerCase()))
        return 'Device/vendor CLI: it belongs to another machine (the NPU/GPU server), so missing it here proves nothing';
    if (PS_CMDLET_RE.test(bare))
        return 'PowerShell cmdlet 不在 PATH 里是正常的';
    if (PS_ALIASES.has(bare.toLowerCase()) && process.platform === 'win32')
        return 'PowerShell 别名不在 PATH 里是正常的';
    if (process.platform === 'win32' && POSIX_ONLY.has(bare.toLowerCase()))
        return 'POSIX 工具：这条命令大概是在讲另一台机器（Linux）';
    return null;
}
const METHOD_CALL_RE = /^[A-Za-z_$][\w$.]*\s*[({]/;
export function commandAvailability(claim, argv) {
    const bin = argv[0] ?? '';
    if (!bin)
        return noEvidence('commandAvailability', claim, '空命令');
    if (METHOD_CALL_RE.test(bin)) {
        return noEvidence('commandAvailability', claim, `${bin} 是方法/函数调用，不是可执行程序名；本机无法据此核验`);
    }
    const na = notApplicableHere(bin);
    if (na)
        return noEvidence('commandAvailability', claim, `${bin} 不在 PATH 中，但${na}；不能据此断言回答错了`);
    const found = which(bin);
    const sources = [{
            label: 'PATH/PATHEXT',
            value: found ? `${bin} → ${found}` : `${bin} 不在 PATH 中`,
            ok: Boolean(found),
        }];
    return summarize('commandAvailability', claim, sources);
}
export function packageVersion(claim, name, cwd) {
    const bare = name.replace(/^`|`$/g, '').replace(/@[~^]?\d[\w.-]*$/, '');
    const sources = [];
    const nmDir = walkUp(cwd, (d) => existsSync(join(d, 'node_modules')));
    if (nmDir) {
        const pkgJson = join(nmDir, 'node_modules', bare, 'package.json');
        const meta = readJson(pkgJson);
        if (meta?.version) {
            sources.push({ label: `node_modules/${bare}/package.json`, value: `已安装 ${meta.version}`, ok: true });
        }
        else {
            sources.push({ label: `node_modules/${bare}`, value: `本机（${nmDir}）未安装`, ok: false, weak: true });
        }
    }
    else {
        sources.push({ label: 'node_modules', value: `从 ${cwd} 向上找不到 node_modules`, ok: false, weak: true });
    }
    const declared = walkUp(cwd, (d) => existsSync(join(d, 'package.json')));
    if (declared) {
        const pkg = readJson(join(declared, 'package.json')) ?? {};
        const fields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
        let range;
        for (const f of fields)
            range ??= pkg[f]?.[bare];
        if (range)
            sources.push({ label: join(declared, 'package.json'), value: `声明范围 ${range}（声明不等于已安装）`, ok: true, weak: true });
    }
    if (!sources.some((s) => s.ok))
        return noEvidence('packageVersion', claim, `本机没有该包（${bare}）；除非回答断言它装在本机，否则不构成反驳`);
    return summarize('packageVersion', claim, sources);
}
function findInstalledByVersion(root, version) {
    const nmRoot = walkUp(root, (d) => existsSync(join(d, 'node_modules')));
    if (!nmRoot)
        return null;
    const base = join(nmRoot, 'node_modules');
    const check = (dir, label) => {
        const meta = readJson(join(dir, 'package.json'));
        if (meta?.version === version)
            return label;
        return null;
    };
    let entries;
    try {
        entries = readdirSync(base);
    }
    catch {
        return null;
    }
    for (const entry of entries.slice(0, 800)) {
        if (entry.startsWith('.'))
            continue;
        const full = join(base, entry);
        if (entry.startsWith('@')) {
            let scoped;
            try {
                scoped = readdirSync(full);
            }
            catch {
                continue;
            }
            for (const s of scoped.slice(0, 200)) {
                const hit = check(join(full, s), `${entry}/${s}`);
                if (hit)
                    return hit;
            }
            continue;
        }
        const hit = check(full, entry);
        if (hit)
            return hit;
    }
    return null;
}
function parseVer(v) {
    const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
    if (!m)
        return null;
    return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function cmp(a, b) {
    for (let i = 0; i < 3; i += 1) {
        if (a[i] !== b[i])
            return a[i] < b[i] ? -1 : 1;
    }
    return 0;
}
export function rangeSatisfied(range, version) {
    if (version.includes('-'))
        return undefined;
    const v = parseVer(version);
    if (!v)
        return undefined;
    const r = range.trim();
    if (!r)
        return undefined;
    if (r === '*' || r === 'latest')
        return true;
    if (/^(workspace:|file:|link:|npm:)/.test(r))
        return undefined;
    for (const part of r.split('||')) {
        const sat = satisfiesPart(part.trim(), v);
        if (sat === true)
            return true;
        if (sat === undefined)
            return undefined;
    }
    return false;
}
function parseLooseWide(v) {
    const m = /^(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:[-+][\w.]+)?$/.exec(v.trim());
    if (!m)
        return null;
    const isNum = (s) => s !== undefined && /^\d+$/.test(s);
    const nums = [Number(m[1]), isNum(m[2]) ? Number(m[2]) : 0, isNum(m[3]) ? Number(m[3]) : 0];
    const width = isNum(m[3]) ? 3 : isNum(m[2]) ? 2 : 1;
    return { nums, width };
}
function satisfiesPart(part, v) {
    if (!part || part === '*' || part === 'x')
        return true;
    const op = /^(>=|<=|>|<|=)\s*/.exec(part);
    if (op) {
        const parsed = parseLooseWide(part.slice(op[0].length));
        if (!parsed)
            return undefined;
        const { nums: t, width } = parsed;
        const c = cmp(v, t);
        const upper = () => (width === 2 ? [t[0], t[1] + 1, 0] : [t[0] + 1, 0, 0]);
        switch (op[1]) {
            case '>=': return c >= 0;
            case '>': return width >= 3 ? c > 0 : cmp(v, upper()) >= 0;
            case '<': return c < 0;
            case '<=': return width >= 3 ? c <= 0 : cmp(v, upper()) < 0;
            default: return width >= 3 ? c === 0 : cmp(v.slice(0, width), t.slice(0, width)) === 0;
        }
    }
    const caret = /^\^\s*(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?/.exec(part);
    if (caret) {
        const spec = [caret[1], caret[2], caret[3]].filter((x) => x !== undefined).join('.');
        const parsed = parseLooseWide(spec);
        if (!parsed)
            return undefined;
        const { nums: t, width } = parsed;
        if (cmp(v, t) < 0)
            return false;
        //   ^1.2.3 → <2.0.0    ^0.5 → <0.6.0    ^0.0.3 → <0.0.4
        //   ^0 / ^0.x → <1.0.0                ^0.0 / ^0.0.x → <0.1.0
        if (t[0] > 0)
            return v[0] === t[0];
        if (width === 1)
            return v[0] === 0;
        if (t[1] > 0)
            return v[0] === 0 && v[1] === t[1];
        if (width === 2)
            return v[0] === 0 && v[1] === 0;
        return v[0] === 0 && v[1] === 0 && v[2] === t[2];
    }
    const tilde = /^~\s*(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?/.exec(part);
    if (tilde) {
        const major = Number(tilde[1]);
        const minorRaw = tilde[2];
        if (minorRaw === undefined || minorRaw === 'x' || minorRaw === '*')
            return v[0] === major;
        const minor = Number(minorRaw);
        const patchRaw = tilde[3];
        if (patchRaw === undefined || patchRaw === 'x' || patchRaw === '*')
            return v[0] === major && v[1] === minor;
        const target = parseVer(`${major}.${minor}.${Number(patchRaw)}`);
        if (!target)
            return undefined;
        return v[0] === major && v[1] === minor && cmp(v, target) >= 0;
    }
    const xr = /^(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/.exec(part);
    if (xr) {
        if (Number(xr[1]) !== v[0])
            return false;
        if (xr[2] === undefined || xr[2] === 'x' || xr[2] === '*')
            return true;
        if (Number(xr[2]) !== v[1])
            return false;
        if (xr[3] === undefined || xr[3] === 'x' || xr[3] === '*')
            return true;
        return Number(xr[3]) === v[2];
    }
    return undefined;
}
export function versionClaim(claim, cwd, name) {
    const m = /(v?\d+\.\d+(?:\.\d+)?)/.exec(claim);
    const claimed = m?.[1]?.replace(/^v/, '');
    if (!claimed)
        return noEvidence('versionClaim', claim, '断言里读不出具体版本号');
    const sources = [];
    const rootPkg = readJson(join(cwd, 'package.json'));
    const rootName = rootPkg?.name ?? '';
    const pkgName = name || hintName(claim);
    if (pkgName) {
        const nmDir = walkUp(cwd, (d) => existsSync(join(d, 'node_modules', pkgName, 'package.json')));
        if (nmDir) {
            const v = readJson(join(nmDir, 'node_modules', pkgName, 'package.json'))?.version;
            if (v)
                sources.push({ label: `node_modules/${pkgName}`, value: `实际 ${v}，断言 ${claimed}`, ok: v === claimed });
        }
        if (rootName && rootName === pkgName && rootPkg?.version) {
            sources.push({ label: '本包 package.json', value: `实际 ${rootPkg.version}，断言 ${claimed}`, ok: rootPkg.version === claimed });
        }
        const declared = walkUp(cwd, (d) => existsSync(join(d, 'package.json')));
        if (declared) {
            const pkg = readJson(join(declared, 'package.json')) ?? {};
            let range;
            for (const f of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'])
                range ??= pkg[f]?.[pkgName];
            if (range) {
                const sat = rangeSatisfied(range, claimed);
                sources.push({
                    label: join(declared, 'package.json'),
                    value: sat === undefined
                        ? `声明范围 ${range}（无法判断是否覆盖 ${claimed}）`
                        : `声明范围 ${range}，断言 ${claimed}${sat ? '（满足）' : '（不满足）'}`,
                    ok: sat === true,
                    weak: sat === undefined,
                });
            }
        }
        if (sources.length === 0)
            return noEvidence('versionClaim', claim, `本机找不到包 ${pkgName}，无法判断版本 ${claimed}`);
        return summarize('versionClaim', claim, sources);
    }
    const holder = findInstalledByVersion(cwd, claimed);
    if (holder)
        sources.push({ label: 'node_modules', value: `本机恰好有 ${holder}@${claimed}，但与断言指代物未必相同`, ok: true, weak: true });
    if (sources.length === 0) {
        return noEvidence('versionClaim', claim, `断言里没定位到包名，本机也没有任何包是 ${claimed}；无法判断（不猜）`);
    }
    return summarize('versionClaim', claim, sources);
}
const DECL_PATTERNS = (id) => {
    const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return [
        new RegExp(`\\b(function|class|interface|type|enum|namespace|declare)\\s+${esc}\\b`),
        new RegExp(`\\b(const|let|var)\\s+${esc}\\b`),
        new RegExp(`^[ \\t]+(export\\s+)?(async\\s+)?${esc}\\s*[(:?<]`, 'm'),
        new RegExp(`\\b${esc}\\s*:\\s*(function|\\()`),
    ];
};
export function symbolExists(claim, cwd) {
    const sig = claim.replace(/^`|`$/g, '');
    const id = /([A-Za-z_$][\w$]*)\s*\(/.exec(sig)?.[1] ?? sig.split('.').pop() ?? '';
    if (!id || id.length < 3)
        return noEvidence('symbolExists', claim, '读不出可查找的标识符');
    let roots = [];
    const nm = walkUp(cwd, (d) => existsSync(join(d, 'node_modules')));
    if (nm)
        roots.push(join(nm, 'node_modules'));
    const selfRoot = selfPackageRoot();
    roots.push(cwd);
    roots = roots.filter((r) => !selfRoot || !r.startsWith(selfRoot));
    const strong = [];
    const weak = [];
    const decls = DECL_PATTERNS(id);
    const exts = ['.d.ts', '.ts', '.js', '.mjs', '.cjs'];
    const scanDir = (dir, depth) => {
        if (strong.length >= 3 || depth > 6)
            return;
        let entries;
        try {
            entries = readdirSync(dir);
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (strong.length >= 3)
                return;
            if (entry === 'node_modules' || entry.startsWith('.'))
                continue;
            const full = join(dir, entry);
            if (insideSelfPackage(full))
                continue;
            let st;
            try {
                st = statSync(full);
            }
            catch {
                continue;
            }
            if (st.isDirectory()) {
                scanDir(full, depth + 1);
                continue;
            }
            if (!exts.some((e) => entry.endsWith(e)))
                continue;
            let text;
            try {
                text = readFileSync(full, 'utf8');
            }
            catch {
                continue;
            }
            const at = text.indexOf(id);
            if (at < 0)
                continue;
            const line = text.slice(0, at).split('\n').length;
            if (decls.some((re) => re.test(text))) {
                if (strong.length < 3)
                    strong.push(`${full}:${line}`);
            }
            else if (weak.length < 3) {
                weak.push(`${full}:${line}`);
            }
        }
    };
    for (const root of roots)
        scanDir(root, 0);
    if (strong.length > 0) {
        return summarize('symbolExists', claim, [{ label: roots.join(' , '), value: `找到定义 ${id}：${strong.join(' ')}`, ok: true }]);
    }
    if (weak.length > 0) {
        return summarize('symbolExists', claim, [{ label: roots.join(' , '), value: `${id} 只在非定义位置出现（弱证据）：${weak.join(' ')}`, ok: false, weak: true }]);
    }
    return noEvidence('symbolExists', claim, `在 ${roots.join(' , ')} 里找不到 ${id}；不能据此断言回答错了（作用域可能不是这里）`);
}
//# sourceMappingURL=local.js.map