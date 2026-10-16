import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageForVersionClaim } from '../lib/claims.js'
import { commandAvailability, packageVersion, rangeSatisfied, symbolExists, versionClaim, which } from '../lib/local.js'
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

// 4f) 真实版本断言不得因范围判断错误而降级成 inconclusive
const realClaim = versionClaim('typescript 5.9.3', cwd, 'typescript')
assert.equal(realClaim.ok, true, `真实版本应被支持：${realClaim.detail}`)
assert.equal(realClaim.sources.some((s) => !s.ok && !s.weak), false, `不应有反驳来源：${realClaim.detail}`)

// 5) 符号存在性：本仓库真实导出的函数名应找到
const sym = symbolExists('normalizeConfig(x)', cwd)
assert.equal(sym.ok, true, `应找到 normalizeConfig：${sym.detail}`)
const noSym = symbolExists('thisFunctionDoesNotExistAnywhere(x)', cwd)
assert.equal(noSym.ok, false, '不存在的标识符应判否（自指文件已被排除）')

// 5b) 依赖 .d.ts 里的真实定义 → 强证据（跨 node_modules 查找）
const strongSym = symbolExists('randomUUID()', cwd)
assert.equal(strongSym.ok, true, `randomUUID 在 @types/node 里有定义：${strongSym.detail}`)
assert.notEqual(strongSym.sources[0].weak, true, '定义位置命中应是强证据')

// 5c) 只有调用、没有定义 → 弱证据（中性），用临时 fixture 保证确定性
const fixture = join(tmpdir(), `dsh-doubt-fixture-${process.pid}`)
mkdirSync(fixture, { recursive: true })
writeFileSync(join(fixture, 'probe.mjs'), 'zzNotDefinedAnywhereFn() // 只有调用\n', 'utf8')
const weakSym = symbolExists('zzNotDefinedAnywhereFn()', fixture)
assert.equal(weakSym.sources.length, 1)
assert.equal(weakSym.sources[0].weak, true, `只有调用没有定义，应标弱证据：${weakSym.detail}`)
assert.equal(weakSym.ok, false, '弱证据不算支持')
rmSync(fixture, { recursive: true, force: true })

// 6) 这些 oracle 也能通过 runCheck 走（verify_claims 同样能调）
const viaTool = await runCheck({ kind: 'packageVersion', name: 'typescript', claim: 'typescript 已安装' }, { timeoutMs: 5000, denyBinaries: [], cwd })
assert.equal(viaTool.ok, true, `runCheck 应能跑 packageVersion：${viaTool.detail}`)
const viaTool2 = await runCheck({ kind: 'commandAvailability', argv: ['node', '--version'], claim: 'node --version' }, { timeoutMs: 5000, denyBinaries: [], cwd })
assert.equal(viaTool2.ok, true, 'runCheck 应能跑 commandAvailability')

console.log(`local.test OK（PATH/包版本/版本断言/符号 全部实测；typescript=${installed}，${pv.sources.length} 个独立来源）`)
