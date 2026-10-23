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


assert.ok(which('node'), 'node 应在 PATH 里')
assert.equal(which('definitely-not-a-real-binary-xyz'), null, '假程序不应找到')


const ca = commandAvailability('pnpm run build', ['pnpm', 'run', 'build'])
assert.equal(ca.noEvidence, false)
assert.equal(ca.ok, which('pnpm') !== null, 'ok 应与 PATH 结果一致')
assert.ok(ca.detail.includes('PATH/PATHEXT'), 'detail 应带来源标签')

const bad = commandAvailability('fakenotexist --version', ['fakenotexist', '--version'])
assert.equal(bad.ok, false, '不存在的程序应判否')


const pv = packageVersion('typescript', 'typescript', cwd)
assert.ok(pv.ok, `typescript 应能在本机找到，实际：${pv.detail}`)
assert.ok(pv.sources.length >= 2, `应有 ≥2 个独立本地来源，实际 ${pv.sources.length}`)
const installed = /已安装 ([\d.]+)/.exec(pv.detail)?.[1]
assert.ok(installed, `应解析出安装版本，实际：${pv.detail}`)


const good = versionClaim(`typescript ${installed}`, cwd, 'typescript')
assert.equal(good.ok, true, `真实版本应被支持：${good.detail}`)
const wrong = versionClaim('typescript 9.9.9', cwd, 'typescript')
assert.equal(wrong.ok, false, `瞎写的版本应被反驳：${wrong.detail}`)
assert.ok(wrong.sources.some((s) => !s.ok), '至少一个来源应反驳')


const orphan = versionClaim('9.9.9', cwd)
assert.equal(orphan.noEvidence, true, `无包名且无人持有的版本应 noEvidence，实际：${orphan.detail}`)
assert.equal(orphan.ok, false)


assert.equal(packageForVersionClaim('TypeScript 5.9.3'), 'TypeScript', '应保留原始大小写')
assert.equal(packageForVersionClaim('version 1.2.3'), null, '连接词不是包名')
assert.equal(packageForVersionClaim('版本是 0.2.0'), null, '中文连接词不是包名')
const cs = versionClaim('TypeScript 5.9.3', cwd, packageForVersionClaim('TypeScript 5.9.3') ?? undefined)
assert.equal(cs.ok, true, `大小写不同的包名应能命中：${cs.detail}`)


const anyVer = versionClaim(`typescript ${installed}`, cwd)
assert.equal(anyVer.ok, true, `应能通过 node_modules 确认 ${installed}：${anyVer.detail}`)


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



if (process.platform === 'win32') {
  assert.ok(which('npm.cmd'), 'npm.cmd 应在 PATH 里')
  const caExt = commandAvailability('npm.cmd 可用', ['npm.cmd'])
  assert.equal(caExt.noEvidence, false, '带扩展名的真实命令不得归结为「无法判断」')
  assert.equal(caExt.ok, true, `npm.cmd 应判存在：${caExt.detail}`)
}

const sudo = commandAvailability('sudo systemctl restart nginx', ['sudo', 'systemctl', 'restart', 'nginx'])
assert.equal(sudo.noEvidence, true, 'sudo 在 Windows 上应判「大概在讲另一台机器」，不得反驳')


const realClaim = versionClaim('typescript 5.9.3', cwd, 'typescript')
assert.equal(realClaim.ok, true, `真实版本应被支持：${realClaim.detail}`)
assert.equal(realClaim.sources.some((s) => !s.ok && !s.weak), false, `不应有反驳来源：${realClaim.detail}`)



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


const weakSym = symbolExists('zzOnlyCalledFn()', fixture)
assert.equal(weakSym.sources.length, 1, `应有弱证据来源：${weakSym.detail}`)
assert.equal(weakSym.sources[0].weak, true, `只有调用没有定义，应标弱证据：${weakSym.detail}`)
assert.equal(weakSym.ok, false, '弱证据不算支持')
rmSync(fixture, { recursive: true, force: true })


const viaTool = await runCheck({ kind: 'packageVersion', name: 'typescript', claim: 'typescript 已安装' }, { timeoutMs: 5000, denyBinaries: [], cwd })
assert.equal(viaTool.ok, true, `runCheck 应能跑 packageVersion：${viaTool.detail}`)
const viaTool2 = await runCheck({ kind: 'commandAvailability', argv: ['node', '--version'], claim: 'node --version' }, { timeoutMs: 5000, denyBinaries: [], cwd })
assert.equal(viaTool2.ok, true, 'runCheck 应能跑 commandAvailability')
assert.equal(sessionCwd([{ type: 'session', cwd: 'E:\\proj' }, { type: 'turn/end', data: {} }]), 'E:\\proj', 'sessionCwd 应取会话事件的顶层 cwd')
assert.equal(sessionCwd([{ type: 'turn/end', data: {} }]), null, '没有 session 事件应返回 null')


const profileDir = join(tmpdir(), `dsh-doubt-nope-${process.pid}`)
mkdirSync(profileDir, { recursive: true })
const toolAt = buildVerifyTool(() => normalizeConfig({ workspace: profileDir }))
const noAgent = await toolAt.execute({ checks: [{ kind: 'packageVersion', name: 'typescript', claim: 'typescript 已安装' }] }, { signal: undefined })
assert.equal(noAgent.results[0].ok, false, `找不到时应如实说没有证据：${noAgent.results[0].detail}`)
assert.ok(noAgent.results[0].detail.includes('未安装') || noAgent.results[0].detail.includes('没有'), '应说明本机没有')



// （dsh-tool-fs/lib/index.js:173、dsh-tool-bash/lib/index.js:294）。


const toolWs = buildVerifyTool(() => normalizeConfig({ workspace: profileDir }))
const agentStub = { id: 'a', session: { header: { cwd } } }
const withAgent = await toolWs.execute({ checks: [{ kind: 'packageVersion', name: 'typescript', claim: 'typescript 已安装' }] }, { signal: undefined, agent: agentStub })
assert.equal(withAgent.results[0].ok, true, `agent 的会话 cwd 应让 oracle 找到包：${withAgent.results[0].detail}`)
assert.equal(withAgent.workspace.source, 'exec.agent.session.header.cwd', '应走 header 这条权威来源')


const fallbackAgent = { id: 'b', session: { id: 'b', snapshotEvents: () => [{ type: 'session', cwd }] } }
const viaFallback = await toolWs.execute({ checks: [{ kind: 'packageVersion', name: 'typescript', claim: 'typescript 已安装' }] }, { signal: undefined, agent: fallbackAgent })
assert.equal(viaFallback.results[0].ok, true, `没有 header 时应回落到事件扫描：${viaFallback.results[0].detail}`)
assert.equal(viaFallback.workspace.source, 'session event scan', '应标明来源是事件扫描')


const explicit = await toolAt.execute({ checks: [{ kind: 'packageVersion', name: 'typescript', claim: 'typescript 已安装', cwd }] }, { signal: undefined })
assert.equal(explicit.results[0].ok, true, '显式 cwd 应覆盖回落值')




//     `tool "verify_claims" returned invalid output: "value.workspace" is not a declared property`

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

  const itemProps = new Set(Object.keys(schema.properties.results.items.properties))
  for (const r of value.results) {
    assert.deepEqual(Object.keys(r).filter((k) => !itemProps.has(k)), [], `results 项里有未声明的键：${JSON.stringify(Object.keys(r))}`)
  }
}
rmSync(profileDir, { recursive: true, force: true })



assert.equal(commandAvailability('z.Dispose()', ['z.Dispose()']).noEvidence, true, 'z.Dispose() 应判无法核验')
assert.equal(commandAvailability('foo.Bar(x)', ['foo.Bar(x)']).noEvidence, true, 'foo.Bar(x) 应判无法核验')
assert.ok(commandAvailability('node --version', ['node', '--version']).detail.includes('PATH/PATHEXT'), '真实程序不受影响')
assert.ok(
  commandAvailability('paren path', ['C:\\Program Files (x86)\\SomeApp\\app.exe']).detail.includes('PATH/PATHEXT'),
  '含 (x86) 的盘符路径不得被当成方法调用',
)
assert.ok(commandAvailability('dotted exe', ['some.tool.exe']).detail.includes('PATH/PATHEXT'), '带点的 exe 名不得被当成方法调用')





const DEVICE_TOOLS = ['npu-smi', 'rocm-smi', 'hccn_tool', 'ibstat', 'ibv_devinfo', 'mlxconfig', 'ascend-dmi', 'dcmi', 'ipmitool', 'racadm', 'nvidia-smi']
for (const tool of DEVICE_TOOLS) {
  const r = commandAvailability(`${tool} info`, [tool, 'info'])
  assert.equal(r.noEvidence, true, `${tool} 应判「另一台机器的工具」，不得反驳（实际 noEvidence=${r.noEvidence}）`)
  assert.equal(r.ok, false, `${tool} 不得被当成支持`)
}

assert.equal(commandAvailability('node --version', ['node', '--version']).noEvidence, false, 'node 不该被判成设备工具')






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
