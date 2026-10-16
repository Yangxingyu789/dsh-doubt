import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageForVersionClaim } from '../lib/claims.js'
import { normalizeConfig } from '../lib/config.js'
import { commandAvailability, packageVersion, rangeSatisfied, symbolExists, versionClaim, which } from '../lib/local.js'
import { sessionCwd } from '../lib/scanner.js'
import { buildVerifyTool } from '../lib/tool.js'
import { runCheck } from '../lib/verify.js'

const cwd = process.cwd()

// 1) PATH 查找：真实程序找得到，假程序找不到
assert.ok(which('node'), 'node 应在 PATH 里')
assert.equal(which('definitely-not-a-real-binary-xyz'), null, '假程序不应找到')

// 2) 命令存在性：只查程序在不在，不执行回答里的命令
const ca = commandAvailability('pnpm run build', ['pnpm', 'run', 'build'])
assert.equal(ca.noEvidence, false)
assert.equal(ca.ok, which('pnpm') !== null, 'ok 应与 PATH 结果一致')
assert.ok(ca.detail.includes('PATH/PATHEXT'), 'detail 应带来源标签')

const bad = commandAvailability('fakenotexist --version', ['fakenotexist', '--version'])
assert.equal(bad.ok, false, '不存在的程序应判否')

// 3) 包版本：本仓库装了 typescript，应能查到安装版本与声明范围
const pv = packageVersion('typescript', 'typescript', cwd)
assert.ok(pv.ok, `typescript 应能在本机找到，实际：${pv.detail}`)
assert.ok(pv.sources.length >= 2, `应有 ≥2 个独立本地来源，实际 ${pv.sources.length}`)
const installed = /已安装 ([\d.]+)/.exec(pv.detail)?.[1]
assert.ok(installed, `应解析出安装版本，实际：${pv.detail}`)

// 4) 版本断言：真实版本 → 支持；瞎写的版本 → 反驳
const good = versionClaim(`typescript ${installed}`, cwd, 'typescript')
assert.equal(good.ok, true, `真实版本应被支持：${good.detail}`)
const wrong = versionClaim('typescript 9.9.9', cwd, 'typescript')
assert.equal(wrong.ok, false, `瞎写的版本应被反驳：${wrong.detail}`)
assert.ok(wrong.sources.some((s) => !s.ok), '至少一个来源应反驳')

// 4b) 定位不到包名、且本机没有任何包是这个版本 → 不得反驳，只能承认无法判断（防假证伪）
const orphan = versionClaim('9.9.9', cwd)
assert.equal(orphan.noEvidence, true, `无包名且无人持有的版本应 noEvidence，实际：${orphan.detail}`)
assert.equal(orphan.ok, false)

// 4c) 大小写与连接词不能污染包名（`TypeScript` 应命中 typescript；`版本` 不是包名）
assert.equal(packageForVersionClaim('TypeScript 5.9.3'), 'TypeScript', '应保留原始大小写')
assert.equal(packageForVersionClaim('version 1.2.3'), null, '连接词不是包名')
assert.equal(packageForVersionClaim('版本是 0.2.0'), null, '中文连接词不是包名')
const cs = versionClaim('TypeScript 5.9.3', cwd, packageForVersionClaim('TypeScript 5.9.3') ?? undefined)
assert.equal(cs.ok, true, `大小写不同的包名应能命中：${cs.detail}`)

// 4d) 本机确实装了某个版本 → 按「任何包是这个版本」确认，不硬猜包名
const anyVer = versionClaim(`typescript ${installed}`, cwd)
assert.equal(anyVer.ok, true, `应能通过 node_modules 确认 ${installed}：${anyVer.detail}`)

// 4e) 声明范围语义：`^5` 必须满足 5.9.3（曾把满足的范围算成反驳，导致 inconclusive）
assert.equal(rangeSatisfied('^5', '5.9.3'), true, '^5 应满足 5.9.3')
assert.equal(rangeSatisfied('^5.0.0', '5.9.3'), true)
assert.equal(rangeSatisfied('^5', '9.9.9'), false, '^5 不应满足 9.9.9')
assert.equal(rangeSatisfied('^0.2.0', '0.2.9'), true, '^0.2.0 允许 patch 升')
assert.equal(rangeSatisfied('^0.2.0', '0.3.0'), false, '^0.x 不得跨 minor')
assert.equal(rangeSatisfied('~5.9.0', '5.9.3'), true)
assert.equal(rangeSatisfied('~5.9.0', '5.10.0'), false, '~5.9.0 不得跨 minor')
assert.equal(rangeSatisfied('>=4', '5.9.3'), true)
assert.equal(rangeSatisfied('<4', '5.9.3'), false)
assert.equal(rangeSatisfied('5.x', '5.9.3'), true)
assert.equal(rangeSatisfied('4.x', '5.9.3'), false)
assert.equal(rangeSatisfied('*', '5.9.3'), true)
assert.equal(rangeSatisfied('^1.2.3 || ^5.0.0', '5.9.3'), true, '|| 任一满足即可')
assert.equal(rangeSatisfied('workspace:*', '5.9.3'), undefined, '无法判断的范围必须返回 undefined，不得算反驳')

// 4g) 部分版本号的上界语义（与 node-semver 逐条对齐过 612 组）：
//     `<=1.2` 是 <1.3.0、`<=4` 是 <5.0.0、`>1.2` 是 >=1.3.0。曾直接拿补 0 的三元组比 → 假证伪。
assert.equal(rangeSatisfied('<=1.2', '1.2.5'), true, '<=1.2 应允许 1.2.5')
assert.equal(rangeSatisfied('<=1.2', '1.3.0'), false, '<=1.2 不应允许 1.3.0')
assert.equal(rangeSatisfied('<=4', '4.5.0'), true, '<=4 应允许 4.5.0')
assert.equal(rangeSatisfied('<=4', '5.0.0'), false, '<=4 不应允许 5.0.0')
assert.equal(rangeSatisfied('>1.2', '1.2.5'), false, '>1.2 表示 >=1.3.0，1.2.5 不满足')
assert.equal(rangeSatisfied('>1.2', '1.3.0'), true, '>1.2 应允许 1.3.0')
assert.equal(rangeSatisfied('^0', '0.5.0'), true, '^0 是 >=0.0.0 <1.0.0，0.5.0 应满足')
assert.equal(rangeSatisfied('^0', '1.0.0'), false, '^0 不应跨到 1.0.0')
assert.equal(rangeSatisfied('^0.0', '0.0.5'), true, '^0.0 是 <0.1.0，0.0.5 应满足')
assert.equal(rangeSatisfied('^0.0', '0.1.0'), false, '^0.0 不应跨到 0.1.0')
assert.equal(rangeSatisfied('^0.x', '0.2.9'), true, '^0.x 是 <1.0.0')
assert.equal(rangeSatisfied('^0.0.3', '0.0.4'), false, '^0.0.3 不应跨 patch')
assert.equal(rangeSatisfied('=1.2', '1.2.9'), true, '=1.2 等价于 1.2.x')

// 4h) which() 必须认得**已经写全扩展名**的命令。
//     只往后拼 PATHEXT 时，明明在 PATH 上的 npm.cmd 会被判「不存在」→ 假证伪。
if (process.platform === 'win32') {
  assert.ok(which('npm.cmd'), 'npm.cmd 应在 PATH 里')
  const caExt = commandAvailability('npm.cmd 可用', ['npm.cmd'])
  assert.equal(caExt.noEvidence, false, '带扩展名的真实命令不得归结为「无法判断」')
  assert.equal(caExt.ok, true, `npm.cmd 应判存在：${caExt.detail}`)
}
// POSIX 专用工具在 Windows 上不得算反驳
const sudo = commandAvailability('sudo systemctl restart nginx', ['sudo', 'systemctl', 'restart', 'nginx'])
assert.equal(sudo.noEvidence, true, 'sudo 在 Windows 上应判「大概在讲另一台机器」，不得反驳')

// 4f) 真实版本断言不得因范围判断错误而降级成 inconclusive
const realClaim = versionClaim('typescript 5.9.3', cwd, 'typescript')
assert.equal(realClaim.ok, true, `真实版本应被支持：${realClaim.detail}`)
assert.equal(realClaim.sources.some((s) => !s.ok && !s.weak), false, `不应有反驳来源：${realClaim.detail}`)

// 5) 符号存在性：一律用**外部 fixture**，因为插件自己的包必须被排除——
//    评测实测过 `agent.followup()` 被插件自己生成的 lib/loop.d.ts 「证实」，那是自指背书。
const fixture = join(tmpdir(), `dsh-doubt-fixture-${process.pid}`)
mkdirSync(join(fixture, 'node_modules', 'zzdep'), { recursive: true })
writeFileSync(join(fixture, 'app.ts'), 'export function zzDefinedHere(x: number): number { return x }\n', 'utf8')
writeFileSync(join(fixture, 'node_modules', 'zzdep', 'index.d.ts'), 'export declare function zzFromDep(): void\n', 'utf8')
writeFileSync(join(fixture, 'caller.ts'), 'zzOnlyCalledFn() // 只有调用\n', 'utf8')

const sym = symbolExists('zzDefinedHere(x)', fixture)
assert.equal(sym.ok, true, `外部源码里的定义应找到：${sym.detail}`)

const depSym = symbolExists('zzFromDep()', fixture)
assert.equal(depSym.ok, true, `依赖 .d.ts 里的定义应找到：${depSym.detail}`)
assert.notEqual(depSym.sources[0].weak, true, '定义位置命中应是强证据')

const selfSym = symbolExists('normalizeConfig(x)', cwd)
assert.equal(selfSym.noEvidence, true, `插件自己仓库的定义不得当证据（自指背书）：${selfSym.detail}`)

const noSym = symbolExists('thisFunctionDoesNotExistAnywhere(x)', fixture)
assert.equal(noSym.noEvidence, true, `找不到标识符应承认无法判断，不得反驳：${noSym.detail}`)

// 只有调用、没有定义 → 弱证据（中性）
const weakSym = symbolExists('zzOnlyCalledFn()', fixture)
assert.equal(weakSym.sources.length, 1, `应有弱证据来源：${weakSym.detail}`)
assert.equal(weakSym.sources[0].weak, true, `只有调用没有定义，应标弱证据：${weakSym.detail}`)
assert.equal(weakSym.ok, false, '弱证据不算支持')
rmSync(fixture, { recursive: true, force: true })

// 6) 这些 oracle 也能通过 runCheck 走（verify_claims 同样能调）
const viaTool = await runCheck({ kind: 'packageVersion', name: 'typescript', claim: 'typescript 已安装' }, { timeoutMs: 5000, denyBinaries: [], cwd })
assert.equal(viaTool.ok, true, `runCheck 应能跑 packageVersion：${viaTool.detail}`)
const viaTool2 = await runCheck({ kind: 'commandAvailability', argv: ['node', '--version'], claim: 'node --version' }, { timeoutMs: 5000, denyBinaries: [], cwd })
assert.equal(viaTool2.ok, true, 'runCheck 应能跑 commandAvailability')

// 7) 本机 oracle 的查找起点必须是**会话的工作目录**，不是宿主进程的 cwd。
//
// 实测症状：`DEFAULT_CONFIG.workspace = process.cwd()` 在插件加载时求值，而宿主进程的
// cwd 是 profile 目录（`…\.dsh\profiles\desktop`），于是 `verify_claims` 里
// `packageVersion typescript` 返回「本机没有该包」——而它其实装在用户的项目里。
// 权威来源是会话的第一个事件：`{ type:'session', cwd:'…' }`（cwd 是**顶层**字段）。
assert.equal(sessionCwd([{ type: 'session', cwd: 'E:\\proj' }, { type: 'turn/end', data: {} }]), 'E:\\proj', 'sessionCwd 应取会话事件的顶层 cwd')
assert.equal(sessionCwd([{ type: 'turn/end', data: {} }]), null, '没有 session 事件应返回 null')

// 工具路径：没有 agent 时回落到 cfg.workspace（这里故意指到 profile 目录）
const profileDir = join(tmpdir(), `dsh-doubt-nope-${process.pid}`)
mkdirSync(profileDir, { recursive: true })
const toolAt = buildVerifyTool(() => normalizeConfig({ workspace: profileDir }))
const noAgent = await toolAt.execute({ checks: [{ kind: 'packageVersion', name: 'typescript', claim: 'typescript 已安装' }] }, { signal: undefined })
assert.equal(noAgent.results[0].ok, false, `找不到时应如实说没有证据：${noAgent.results[0].detail}`)
assert.ok(noAgent.results[0].detail.includes('未安装') || noAgent.results[0].detail.includes('没有'), '应说明本机没有')

// 有 agent（会话 cwd = 本仓库）时应能找到。
// **必须用运行时的真实形状** `agent.session.header.cwd` —— 宿主自己的工具就是这么拿的
// （dsh-tool-fs/lib/index.js:173、dsh-tool-bash/lib/index.js:294）。
// 我上一版拿自己编的 `session: { snapshotEvents }` 形状去验证，于是活体上一直回落到
// profile 目录、`packageVersion typescript` 报「本机没有该包」，而测试却是绿的。
const toolWs = buildVerifyTool(() => normalizeConfig({ workspace: profileDir }))
const agentStub = { id: 'a', session: { header: { cwd } } }
const withAgent = await toolWs.execute({ checks: [{ kind: 'packageVersion', name: 'typescript', claim: 'typescript 已安装' }] }, { signal: undefined, agent: agentStub })
assert.equal(withAgent.results[0].ok, true, `agent 的会话 cwd 应让 oracle 找到包：${withAgent.results[0].detail}`)
assert.equal(withAgent.workspace.source, 'exec.agent.session.header.cwd', '应走 header 这条权威来源')

// 事件扫描作为兜底：只有 session 事件、没有 header 时也要能用
const fallbackAgent = { id: 'b', session: { id: 'b', snapshotEvents: () => [{ type: 'session', cwd }] } }
const viaFallback = await toolWs.execute({ checks: [{ kind: 'packageVersion', name: 'typescript', claim: 'typescript 已安装' }] }, { signal: undefined, agent: fallbackAgent })
assert.equal(viaFallback.results[0].ok, true, `没有 header 时应回落到事件扫描：${viaFallback.results[0].detail}`)
assert.equal(viaFallback.workspace.source, 'session event scan', '应标明来源是事件扫描')

// 显式 cwd 仍然优先于回落
const explicit = await toolAt.execute({ checks: [{ kind: 'packageVersion', name: 'typescript', claim: 'typescript 已安装', cwd }] }, { signal: undefined })
assert.equal(explicit.results[0].ok, true, '显式 cwd 应覆盖回落值')

// 11) 工具返回值必须**符合它自己声明的 output schema**。
//     宿主按 `additionalProperties: false` 严格校验：活体上我给返回对象加了
//     `workspace` / `failed` 却忘了写进 OUTPUT_SCHEMA，宿主直接报
//     `tool "verify_claims" returned invalid output: "value.workspace" is not a declared property`
//     —— 那次改动让工具在运行时**每次都失败**，而当时测试全绿。
{
  const schema = buildVerifyTool(() => normalizeConfig({})).output?.schema
  assert.ok(schema?.properties, '工具应声明 output schema')
  const declared = new Set(Object.keys(schema.properties))
  const value = await toolAt.execute({ checks: [{ kind: 'fileExists', path: process.argv[1] }] }, { signal: undefined })
  assert.deepEqual(
    Object.keys(value).filter((k) => !declared.has(k)),
    [],
    `返回值里有未在 output schema 声明的键（宿主会拒绝整个输出）：${JSON.stringify(Object.keys(value))} vs ${JSON.stringify([...declared])}`,
  )
  for (const req of schema.required ?? []) assert.ok(req in value, `缺少必填字段 ${req}`)
  // results 里的每一项同样受 additionalProperties:false 约束
  const itemProps = new Set(Object.keys(schema.properties.results.items.properties))
  for (const r of value.results) {
    assert.deepEqual(Object.keys(r).filter((k) => !itemProps.has(k)), [], `results 项里有未声明的键：${JSON.stringify(Object.keys(r))}`)
  }
}
rmSync(profileDir, { recursive: true, force: true })

// 8) 方法/函数调用不是可执行程序名（`.ps1` 里的 `z.Dispose()` 曾被拿去 which → 假证伪）。
//    只往沉默方向走：真实程序、盘符路径、带点的 exe 名都不得被误判成「调用」。
assert.equal(commandAvailability('z.Dispose()', ['z.Dispose()']).noEvidence, true, 'z.Dispose() 应判无法核验')
assert.equal(commandAvailability('foo.Bar(x)', ['foo.Bar(x)']).noEvidence, true, 'foo.Bar(x) 应判无法核验')
assert.ok(commandAvailability('node --version', ['node', '--version']).detail.includes('PATH/PATHEXT'), '真实程序不受影响')
assert.ok(
  commandAvailability('paren path', ['C:\\Program Files (x86)\\SomeApp\\app.exe']).detail.includes('PATH/PATHEXT'),
  '含 (x86) 的盘符路径不得被当成方法调用',
)
assert.ok(commandAvailability('dotted exe', ['some.tool.exe']).detail.includes('PATH/PATHEXT'), '带点的 exe 名不得被当成方法调用')

// 9) 设备/厂商 CLI 属于**另一台机器**（NPU/GPU 服务器），本机没有它不是反驳。
//    变异测试实测：删掉 REMOTE_DEVICE_TOOLS 后 11 个条目里 10 个会退回
//    「✗ [PATH/PATHEXT] <tool> 不在 PATH 中」（noEvidence=false），而当时**没有任何测试会失败**。
//    这正是插件在真实 46k 部署手册上唯一那条 refuted（`npu-smi info`）。
const DEVICE_TOOLS = ['npu-smi', 'rocm-smi', 'hccn_tool', 'ibstat', 'ibv_devinfo', 'mlxconfig', 'ascend-dmi', 'dcmi', 'ipmitool', 'racadm', 'nvidia-smi']
for (const tool of DEVICE_TOOLS) {
  const r = commandAvailability(`${tool} info`, [tool, 'info'])
  assert.equal(r.noEvidence, true, `${tool} 应判「另一台机器的工具」，不得反驳（实际 noEvidence=${r.noEvidence}）`)
  assert.equal(r.ok, false, `${tool} 不得被当成支持`)
}
// 真实存在的本机程序不得被这条守卫吞掉
assert.equal(commandAvailability('node --version', ['node', '--version']).noEvidence, false, 'node 不该被判成设备工具')

// 10) 自指证据：**任何同名包**都不是证据——不管它在哪个路径。
//     实测过的失效场景：插件从已安装副本加载（C:\...\.dsh\plugins\dsh-doubt），
//     会话工作目录是仓库（C:\work\dsh-doubt）——两个路径、同一个包，路径前缀比较必然漏掉，
//     于是 `symbolExists('normalizeConfig()', 'C:/work/dsh-doubt')` 引用 src/config.ts
//     把插件自己的 API「证实」给自己看。所以这里造一个**同名包在别的路径**来测。
{
  const fake = join(tmpdir(), `dsh-doubt-copy-${process.pid}`)
  rmSync(fake, { recursive: true, force: true })
  mkdirSync(fake, { recursive: true })
  writeFileSync(join(fake, 'package.json'), JSON.stringify({ name: 'dsh-doubt', version: '0.0.0' }))
  writeFileSync(join(fake, 'lib.js'), 'export function zzSelfOnlySymbol() { return 1 }\n')
  const selfHit = symbolExists('zzSelfOnlySymbol()', fake)
  assert.equal(selfHit.noEvidence, true, `同名包里的符号不得当证据：${selfHit.detail}`)
  assert.equal(selfHit.ok, false, '自指证据不得算支持')
  rmSync(fake, { recursive: true, force: true })
}

console.log(`local.test OK（PATH/包版本/版本断言/符号/会话工作目录/方法调用守卫/自指证据 全部实测；typescript=${installed}，${pv.sources.length} 个独立来源）`)
