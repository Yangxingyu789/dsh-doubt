// 危险变更闸门：识别规则 / 三件产物判定 / 热改 live profile 事故回归 / 历史轮不污染 / 开关 / 不误伤
import assert from 'node:assert/strict'
import { assessLiveMutation, confirmationSeen, detectLiveMutations, healthChecked, rollbackDisclosed } from '../lib/guard.js'
import { reviewDraft } from '../lib/completion.js'
import { normalizeConfig } from '../lib/config.js'

const iterable = async function* (items) { yield* items }
const textChunks = (text) => [{ type: 'text-delta', index: 0, text }, { type: 'finish', reason: { kind: 'stop' } }]
const payloadOf = (r) => JSON.parse(r.messages[1].content[0].text)
const approveReply = (r) => {
  const p = payloadOf(r)
  return JSON.stringify({ decision: 'approve', segments: [{ partIds: p.draftParts.map((x) => x.id), kind: 'nonfactual', evidence: [] }] })
}

const turn = 1
const cfg = normalizeConfig({ reviewMaxChars: 8000, factored: false, reviewTimeoutMs: 2000 })
const LIVE_PROFILE = 'C:\\Users\\Administrator\\.dsh\\profiles\\desktop'
const LIVE_PLUGIN_INDEX = 'C:\\Users\\Administrator\\.dsh\\plugins\\dsh-doubt\\lib\\index.js'
const call = (id, name, args = {}, t = turn) => ({ type: 'tool/call', data: { turn: t, callId: id, name, arguments: JSON.stringify(args) } })
const result = (id, text = 'ok', t = turn) => ({
  type: 'tool/result', surfaceOp: 'append',
  data: { turn: t, message: { toolCallId: id, source: { callId: id }, content: [{ type: 'text', text }] } },
})
const humanEvent = (text) => ({ type: 'user/message', data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] } })
const approvalEvent = (text) => ({ type: 'user/message', data: { role: 'user', source: { kind: 'user-approval' }, content: [{ type: 'text', text }] } })
const msgs = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续完善插件并验收。' }] }]
const rulesOf = (events, t = turn) => detectLiveMutations(events, t, cfg).map((f) => f.rule)

// ── 1. 识别单测（§4.2 / §4.3）：每条规则一个正例 + 反例 ──────────────────────────
{
  // 本仓库安装脚本会写 .dsh/plugins → install-local-script（kind=write）
  const events = [call('a', 'pwsh', { command: 'node scripts/install-local.mjs' }), result('a', 'installed')]
  const findings = detectLiveMutations(events, turn, cfg)
  assert.deepEqual(findings.map((f) => f.rule), ['install-local-script'])
  assert.equal(findings[0].kind, 'write')
  const assessment = assessLiveMutation({ events, turn, draft: '装好了。', config: cfg })
  assert.equal(assessment.mutated, true)
  assert.equal(assessment.satisfied, false, '只有安装动作、没有三件产物 → 不得放行')
  console.log('  ✓ pwsh node scripts/install-local.mjs → install-local-script')
}
{
  // live profile 里 pnpm install → install-into-live-profile（kind=install）
  const events = [call('b', 'pwsh', { command: 'pnpm.cmd install --offline', workdir: LIVE_PROFILE }), result('b', 'Done')]
  const findings = detectLiveMutations(events, turn, cfg)
  assert.deepEqual(findings.map((f) => f.rule), ['install-into-live-profile'])
  assert.equal(findings[0].kind, 'install')
  // 非 live 工作目录的 pnpm install 不是宿主机变更（防误报）
  assert.deepEqual(rulesOf([call('b2', 'pwsh', { command: 'pnpm.cmd install --offline', workdir: 'E:\\dsh-doubt' }), result('b2', 'Done')]), [])
  console.log('  ✓ pnpm.cmd install（workdir=live profile）→ install-into-live-profile；仓库目录不触发')
}
{
  for (const name of ['edit', 'write']) {
    const events = [call('c', name, { file_path: LIVE_PLUGIN_INDEX }), result('c', 'saved')]
    const findings = detectLiveMutations(events, turn, cfg)
    assert.deepEqual(findings.map((f) => f.rule), ['live-path-write'], `${name} 写 live 插件目录应命中`)
    assert.equal(findings[0].kind, 'write')
    assert.ok(findings[0].target.toLowerCase().includes('.dsh\\plugins'), 'target 应是命中路径')
  }
  console.log('  ✓ edit/write 目标 = .dsh/plugins/... → live-path-write')
}
{
  const events = [call('d', 'pwsh', { command: 'Remove-Item -Recurse E:\\tmp\\x' }), result('d', 'done')]
  const findings = detectLiveMutations(events, turn, cfg)
  assert.deepEqual(findings.map((f) => f.rule), ['recursive-delete'])
  assert.equal(findings[0].kind, 'delete')
  console.log('  ✓ pwsh Remove-Item -Recurse（任意外部路径）→ recursive-delete')
}
{
  // 执行前闸门启用后，常见项目/临时目录清理不应被拦：live/系统/盘根/未知目标才拦。
  const cases = [
    ['Remove-Item -Recurse -Force "C:\\Users\\Administrator\\AppData\\Local\\Temp\\probe"', 'temp path must be allowed', false],
    ['Remove-Item -Recurse -Force $env:TEMP\\probe', '$env:TEMP must be allowed', false],
    ['rm -rf node_modules', null, false, 'E:\\dsh-doubt'],
    ['Remove-Item "C:\\Users\\Administrator\\AppData\\Local\\Temp\\probe" -Recurse -Force; Write-Host "deleted=$?"', 'temp delete with trailing Write-Host must be allowed (0.8.2 parser fix)', false],
    ['Remove-Item $dir -Recurse -Force', 'variable target stays conservative (blocked)', true],
    ['Remove-Item -Recurse C:\\Windows\\System32\\drivers', 'system dir must be blocked', true],
    ['Remove-Item -Recurse C:\\', 'drive root must be blocked', true],
    ['Remove-Item -Recurse C:\\Users\\Administrator\\.dsh\\plugins\\dsh-doubt', 'live path must be blocked', true],
    ['Remove-Item -Recurse', 'unknown target must stay conservative', true],
  ]
  for (const [command, label, expected, workdir] of cases) {
    const events = [call('x', 'pwsh', { command, ...(workdir ? { workdir } : {}) }), result('x', 'done')]
    const found = detectLiveMutations(events, turn, cfg)
    assert.equal(found.length > 0, expected, `${label}: ${command} → ${JSON.stringify(found.map((f) => f.rule))}`)
  }
  console.log('  ✓ 递归删除细化：temp/$env:TEMP/仓库 workdir 放行；系统目录/盘根/live 路径/未知目标拦截')
}
{
  // 写入方向：从 live 路径复制出来（备份）是只读；复制/写入进 live 路径才是变更。
  const cases = [
    [`Copy-Item 'C:\\Users\\Administrator\\.dsh\\plugins\\dsh-doubt' 'E:\\dsh-doubt\\_diag\\backup' -Recurse -Force`, false, 'copy OUT of live path (backup) must be allowed'],
    [`Copy-Item 'E:\\dsh-doubt\\lib' 'C:\\Users\\Administrator\\.dsh\\plugins\\dsh-doubt\\lib' -Recurse -Force`, true, 'copy INTO live path must be flagged'],
    [`Set-Content -Path 'C:\\Users\\Administrator\\.dsh\\profiles\\desktop\\x.yml' -Value 'x'`, true, 'content write into live path must be flagged'],
    [`Get-Content 'C:\\Users\\Administrator\\.dsh\\profiles\\desktop\\cordis.yml' > 'E:\\dsh-doubt\\_diag\\out.txt'`, false, 'redirect OUT of live path (read-only source) must be allowed'],
    [`Get-Content 'E:\\dsh-doubt\\README.md' > 'C:\\Users\\Administrator\\.dsh\\profiles\\desktop\\x.txt'`, true, 'redirect INTO live path must be flagged'],
  ]
  for (const [command, expected, label] of cases) {
    const events = [call('w', 'pwsh', { command }), result('w', 'done')]
    const found = detectLiveMutations(events, turn, cfg)
    assert.equal(found.length > 0, expected, `${label}: ${command} → ${JSON.stringify(found.map((f) => f.rule))}`)
  }
  console.log('  ✓ 写入方向：live→备份放行；仓库/临时→live 拦截；重定向同方向判定')
}
{
  const events = [call('e', 'pwsh', { command: 'Stop-Process -Name "DeepSeek Harness"' }), result('e', 'done')]
  assert.deepEqual(rulesOf(events), ['process-control'])
  console.log('  ✓ pwsh Stop-Process → process-control')
}
{
  const events = [call('f', 'pwsh', { command: 'reg add HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run /v dsh /d x' }), result('f', 'done')]
  assert.deepEqual(rulesOf(events), ['registry-or-service'])
  console.log('  ✓ pwsh reg add HKCU\\... → registry-or-service')
}
{
  // 反例：查询类命令、读 live 路径、仓库源码 edit、ops_replace dryRun 都不得命中
  const harmless = [
    call('r', 'read', { path: LIVE_PLUGIN_INDEX }), result('r', 'contents'),
    call('v', 'pwsh', { command: 'node --version' }), result('v', 'v24.21.0'),
    call('e', 'edit', { file_path: 'E:\\dsh-doubt\\src\\x.ts' }), result('e', 'saved'),
    call('o', 'ops_replace', { path: LIVE_PLUGIN_INDEX, dryRun: true }), result('o', 'dry-run ok'),
    call('q', 'pwsh', { command: 'pnpm --version' }), result('q', '12.10.1'),
    call('w', 'verify_claims', { checks: [{ kind: 'command', argv: ['node', '--version'] }] }), result('w', 'v24.21.0'),
    // 只读 node -e：命令里出现 live 路径 + JS 箭头函数/比较运算符 + 2>&1，必须不判成 live 写入
    call('js', 'pwsh', { command: `node -e "const fs=require('node:fs');const a=[1,2].map(x=>x).filter(x=>x>=1);const p=fs.readFileSync('C:/Users/Administrator/.dsh/profiles/desktop/cordis.patch.yml','utf8');console.log(a.length,p.length)" 2>&1 | Out-String` }), result('js', '2 1962'),
  ]
  assert.deepEqual(rulesOf(harmless), [])
  const assessment = assessLiveMutation({ events: harmless, turn, draft: '已完成。', config: cfg })
  assert.equal(assessment.mutated, false)
  assert.equal(assessment.satisfied, true)
  console.log('  ✓ 反例（read / node --version / 仓库 edit / ops_replace dryRun / verify_claims 只读）mutated === false')
}
{
  // 没有 turn 字段的旧 fixture 视为当前轮；历史轮（turn < 当前）不在作用域
  const noTurn = [{ type: 'tool/call', data: { callId: 'x', name: 'pwsh', arguments: JSON.stringify({ command: 'node scripts/install-local.mjs' }) } }]
  assert.deepEqual(detectLiveMutations(noTurn, 3, cfg).map((f) => f.rule), ['install-local-script'])
  const historical = [call('old', 'pwsh', { command: 'node scripts/install-local.mjs' }, 1), result('old', 'installed', 1)]
  assert.deepEqual(detectLiveMutations(historical, 5, cfg), [], '历史轮的危险变更不参与当前轮判定')
  console.log('  ✓ 无 turn 记录按当前轮；turn < 当前轮不参与')
}

// ── 三件产物 helper 单测（§4.4）────────────────────────────────────────────────
const incident = [
  call('install-local', 'pwsh', { command: 'node scripts/install-local.mjs' }),
  result('install-local', '.dsh\\plugins\\dsh-doubt 已写入'),
  call('profile-install', 'pwsh', { command: 'pnpm.cmd install --offline', workdir: LIVE_PROFILE }),
  result('profile-install', 'Done in 3.2s'),
]
const ROLLBACK_DRAFT = '回滚路径：备份在 E:\\backup\\dsh-plugins-0.5.1（安装前完整副本）。\n回滚命令：\n```powershell\ncd E:\\dsh-doubt\ngit checkout -- src lib\n```'
{
  assert.equal(rollbackDisclosed(ROLLBACK_DRAFT), true)
  assert.equal(rollbackDisclosed('已把改造版插件装进 live profile，插件已生效。'), false)
  assert.equal(rollbackDisclosed('已回滚，备份在 E:\\bak。'), false, '有回滚词和备份但缺少可直接执行的命令')
  assert.equal(rollbackDisclosed('回滚命令：cd E:\\dsh-doubt'), false, '有回滚词和命令但缺少备份证据')

  const findings = detectLiveMutations(incident, turn, cfg)
  assert.equal(findings.length, 2)
  assert.equal(confirmationSeen(incident, findings), false, '没有批准事件')
  const withApproval = [humanEvent('把插件装进 live profile 并验收。'), approvalEvent('批准安装到 live profile，装完立即重启。'), ...incident]
  assert.equal(confirmationSeen(withApproval, detectLiveMutations(withApproval, turn, cfg)), true, '批准事件在 mutation 之前')
  const approvalAfter = [...incident, approvalEvent('批准安装到 live profile。')]
  assert.equal(confirmationSeen(approvalAfter, findings), false, '批准事件在 mutation 之后不算')
  // 草稿自述「已确认」不算：confirmationSeen 只看事件与真人请求，不看 draft
  assert.equal(confirmationSeen(incident, findings, [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '把插件装进 live profile 并验收。' }] }]), false)

  assert.equal(healthChecked(incident, turn, findings).ok, false, '变更后没有调用')
  const withHealth = [...incident, call('health', 'pwsh', { command: 'node --version' }), result('health', 'v24.21.0')]
  assert.deepEqual(healthChecked(withHealth, turn, detectLiveMutations(withHealth, turn, cfg)), { ok: true, callIds: ['health'] })
  // 历史轮的事后调用不能当本轮健康检查
  const staleHealth = [...incident, call('health', 'pwsh', { command: 'node --version' }, 0), result('health', 'v24.21.0', 0)]
  assert.equal(healthChecked(staleHealth, turn, findings).ok, false, '历史轮调用不是当前轮的变更后检查')
  console.log('  ✓ rollbackDisclosed / confirmationSeen / healthChecked 细粒度判定符合 §4.4')
}
{
  // 用户明确授权（最后一条真人请求同时含确认词与动作词）可作确认证据；draft 自述不算
  const findings = detectLiveMutations(incident, turn, cfg)
  const approvingMessages = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '确认安装这个插件' }] }]
  assert.equal(confirmationSeen(incident, findings, approvingMessages), true, '真人请求含确认词+动作词 → 视为授权')
  const authorized = assessLiveMutation({ events: incident, turn, draft: '装好了。', config: cfg, messages: approvingMessages })
  assert.equal(authorized.present.confirm, true, 'assess 应把真人授权计入确认点')
  assert.equal(authorized.satisfied, false, '仍缺回滚与健康检查')
  const neutralMessages = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续完善插件并验收。' }] }]
  assert.equal(confirmationSeen(incident, findings, neutralMessages), false, '请求不含确认词 → 不算授权')
  const selfClaim = assessLiveMutation({ events: incident, turn, draft: `已确认可以安装。\n${ROLLBACK_DRAFT}`, config: cfg, messages: neutralMessages })
  assert.equal(selfClaim.present.confirm, false, 'draft 里写「已确认」是自我声明，不算确认证据')
  assert.equal(selfClaim.satisfied, false)
  // 用户对「是否安装」的直接回复（单独一句「确认」）也是明确授权，
  // 旧规则要求同句含动作词，会把这种真实确认误判成缺失。
  for (const reply of ['确认', '确认。', '批准安装', 'OK', 'yes']) {
    const msgs = [{ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: reply }] }]
    assert.equal(confirmationSeen(incident, findings, msgs), true, `单独确认「${reply}」应视为授权`)
  }
  console.log('  ✓ 真人请求授权可作确认证据；单独「确认/OK/yes」也算；draft 自述「已确认」不算')
}

// ── 2. 事故回归（核心）：安装到 live profile → 宿主服务失效，本轮无任何后续调用 ──────
{
  let calls = 0
  const out = await reviewDraft(incident, turn, msgs, '已把改造版插件装进 live profile，插件已生效。', {}, {
    stream: () => { calls++; return iterable(textChunks(JSON.stringify({ decision: 'approve' }))) },
  }, cfg)
  assert.equal(out.decision.approved, false, '事故轨迹必须打回')
  assert.equal(out.decision.failure, undefined, '是 verify 打回，不是审核服务故障（不得走 fail-open）')
  assert.equal(calls, 0, '确定性闸门不应调用审核模型')
  const issues = out.decision.issues.join('\n')
  for (const word of ['回滚', '确认', '健康检查']) {
    assert.ok(issues.includes(word), `打回意见应包含「${word}」：${issues}`)
  }
  assert.equal(out.uncovered.length, 0)
  console.log('  ✓ 事故回归：live profile 安装 + 声称完成 + 无回滚/确认/健康检查 → 打回（calls=0，failure=undefined）')
}
{
  // 补了健康检查，仍缺回滚/确认 → 仍打回，只报这两个缺口
  let calls = 0
  const events = [...incident, call('health', 'pwsh', { command: 'node --version' }), result('health', 'v24.21.0')]
  const out = await reviewDraft(events, turn, msgs, '已把改造版插件装进 live profile，插件已生效。', {}, {
    stream: () => { calls++; return iterable(textChunks(JSON.stringify({ decision: 'approve' }))) },
  }, cfg)
  const issues = out.decision.issues.join('\n')
  assert.equal(out.decision.approved, false)
  assert.equal(calls, 0)
  assert.ok(issues.includes('回滚') && issues.includes('确认'), issues)
  assert.ok(!issues.includes('健康检查'), `健康检查已补，不应再报该缺口：${issues}`)
  console.log('  ✓ 补健康检查仍缺回滚/确认 → 打回，只报回滚 + 确认缺口')
}
{
  // 三件产物齐全 → 放行确定性闸门，继续走模型审核（受控 reviewer 返回 approve）
  let calls = 0
  const events = [
    humanEvent('把改造版插件装进 live profile 并验收。'),
    approvalEvent('批准安装到 live profile，装完立即重启。'),
    ...incident,
    call('health', 'pwsh', { command: 'node --version' }),
    result('health', 'v24.21.0'),
  ]
  const draft = `${ROLLBACK_DRAFT}\n\n健康检查：变更后另起一次 pwsh 调用执行 node --version，实测输出 v24.21.0。`
  const assessment = assessLiveMutation({ events, turn, draft, config: cfg })
  assert.equal(assessment.mutated, true)
  assert.equal(assessment.satisfied, true, `三件产物齐全应满足：${assessment.gaps.join(' / ')}`)
  const out = await reviewDraft(events, turn, msgs, draft, {}, {
    stream: (r) => { calls++; return iterable(textChunks(approveReply(r))) },
  }, cfg)
  assert.equal(calls, 1, '三件产物齐全时闸门放行、正常审核一次')
  assert.equal(out.decision.approved, true)
  console.log('  ✓ 回滚 + 确认 + 事后健康检查齐全 → 闸门放行，继续模型审核（calls=1，approved）')
}
{
  // 有确认、有回滚、变更后无调用 → 仅健康检查缺失打回
  let calls = 0
  const events = [approvalEvent('批准安装到 live profile。'), ...incident]
  const out = await reviewDraft(events, turn, msgs, ROLLBACK_DRAFT, {}, {
    stream: () => { calls++; return iterable(textChunks(JSON.stringify({ decision: 'approve' }))) },
  }, cfg)
  const issues = out.decision.issues.join('\n')
  assert.equal(out.decision.approved, false)
  assert.equal(calls, 0)
  assert.ok(issues.includes('健康检查'), issues)
  assert.ok(!issues.includes('回滚') && !issues.includes('确认'), `回滚/确认已给，不应再报：${issues}`)
  console.log('  ✓ 缺健康检查单独打回（有确认 + 有回滚）')
}

// ── 3. 关闭开关：guardLiveMutation=false 完全退回旧行为 ─────────────────────────
{
  const off = normalizeConfig({ reviewMaxChars: 8000, factored: false, reviewTimeoutMs: 2000, guardLiveMutation: false })
  assert.equal(off.guardLiveMutation, false)
  assert.equal(assessLiveMutation({ events: incident, turn, draft: '装好了。', config: off }).mutated, false)
  let calls = 0
  const out = await reviewDraft(incident, turn, msgs, '已把改造版插件装进 live profile，插件已生效。', {}, {
    stream: (r) => { calls++; return iterable(textChunks(approveReply(r))) },
  }, off)
  assert.equal(calls, 1, '关闭开关后不再确定性打回，由受控 reviewer 决定')
  assert.equal(out.decision.approved, true)
  console.log('  ✓ guardLiveMutation=false：同一事故轨迹不被打回（calls=1）')
}

// ── 4. 不误伤 + 历史轮假阳性回归 ───────────────────────────────────────────────
{
  let calls = 0
  const events = [
    call('edit', 'edit', { file_path: 'E:\\dsh-doubt\\src\\x.ts' }), result('edit', 'saved'),
    call('read', 'read', { path: 'E:\\dsh-doubt\\src\\x.ts' }), result('read', 'saved'),
  ]
  const out = await reviewDraft(events, turn, msgs, '已修改 src/x.ts 并回读确认。', {}, {
    stream: (r) => { calls++; return iterable(textChunks(approveReply(r))) },
  }, cfg)
  assert.equal(calls, 1, '普通轨迹应正常审核一次')
  assert.equal(out.decision.approved, true)
  console.log('  ✓ 普通轨迹（仓库 edit + read）不误伤（calls=1）')
}
{
  // turn=1 发生过 live profile 安装；当前审的是 turn=5 的普通回答 → 不得被污染
  const events = [
    call('old-install', 'pwsh', { command: 'node scripts/install-local.mjs' }, 1), result('old-install', 'installed', 1),
    call('old-profile', 'pwsh', { command: 'pnpm.cmd install --offline', workdir: LIVE_PROFILE }, 1), result('old-profile', 'Done', 1),
    call('edit', 'edit', { file_path: 'E:\\dsh-doubt\\src\\x.ts' }, 5), result('edit', 'saved', 5),
  ]
  const assessment = assessLiveMutation({ events, turn: 5, draft: '已修改 src/x.ts。', config: cfg })
  assert.equal(assessment.mutated, false, '历史轮安装不得污染当前轮')
  assert.equal(assessment.findings.length, 0)
  let calls = 0
  const out = await reviewDraft(events, 5, msgs, '已修改 src/x.ts。', {}, {
    stream: (r) => { calls++; return iterable(textChunks(approveReply(r))) },
  }, cfg)
  assert.equal(calls, 1, '历史轮危险变更不影响当前轮的模型审核')
  assert.equal(out.decision.approved, true)
  console.log('  ✓ 历史轮（turn=1）live 安装不污染 turn=5 普通回答（mutated=false，calls=1）')
}

// ── 执行前闸门（tools/pre-execute）：危险操作在执行前 ask/deny ─────────────────
{
  const { createPreflightGuard } = await import('../lib/preflight.js')
  const cfgOn = normalizeConfig({ guardPreExecute: true })
  const execOf = (name, args) => ({ name, arguments: args, callId: 'c1', agent: { session: { id: 's1' } } })
  const allow = async () => ({ kind: 'allow' })

  // 有审批通道、策略 ask：危险操作返回 kind=ask（权限审批注入）
  let asked = 0
  const askGuard = createPreflightGuard(() => cfgOn, { approval: () => ({ overrideOf: () => 'ask' }) })
  const askDecision = await askGuard(execOf('pwsh', { command: 'node scripts/install-local.mjs' }), allow)
  assert.equal(askDecision.kind, 'ask', '危险操作应要求权限审批')
  assert.ok(askDecision.reason.includes('危险变更闸门'))
  assert.ok(askDecision.displayReason?.zh, '应带本地化审批文案')
  asked++
  assert.equal(asked, 1)

  // 策略 never：直接 deny（无法弹审批时也不放行）
  const denyGuard = createPreflightGuard(() => cfgOn, { approval: () => ({ overrideOf: () => 'never' }) })
  const denyDecision = await denyGuard(execOf('pwsh', { command: 'pnpm.cmd install --offline', workdir: LIVE_PROFILE }), allow)
  assert.equal(denyDecision.kind, 'deny', '策略 never 时应拒绝执行')

  // 无审批通道：拒绝
  const noSeam = createPreflightGuard(() => cfgOn, { approval: () => undefined })
  assert.equal((await noSeam(execOf('edit', { file_path: LIVE_PLUGIN_INDEX }), allow)).kind, 'deny')

  // 普通仓库操作 / 只读命令：放行（不干扰正常工作）
  for (const [name, args] of [
    ['edit', { file_path: 'E:\\dsh-doubt\\src\\x.ts' }],
    ['read', { file_path: LIVE_PLUGIN_INDEX }],
    ['pwsh', { command: 'node --version' }],
    // 临时目录递归删除与仓库内递归清理不属于 live 危险变更：执行前闸门应放行
    ['pwsh', { command: 'Remove-Item -Recurse -Force "C:\\Users\\Administrator\\AppData\\Local\\Temp\\probe"' }],
    ['pwsh', { command: 'rm -rf node_modules', workdir: 'E:\\dsh-doubt' }],
  ]) {
    const decision = await askGuard(execOf(name, args), allow)
    assert.equal(decision.kind, 'allow', `${name} 普通操作应放行：${JSON.stringify(args)}`)
  }
  // live 路径递归删除仍应 ask（有审批）或 deny（never）
  assert.equal((await askGuard(execOf('pwsh', { command: `Remove-Item -Recurse ${LIVE_PROFILE}` }), allow)).kind, 'ask')
  assert.equal((await noSeam(execOf('pwsh', { command: `Remove-Item -Recurse ${LIVE_PROFILE}` }), allow)).kind, 'deny')

  // 关闭开关：完全退回原行为
  const offGuard = createPreflightGuard(() => normalizeConfig({ guardPreExecute: false }), { approval: () => ({ overrideOf: () => 'ask' }) })
  assert.equal((await offGuard(execOf('pwsh', { command: 'node scripts/install-local.mjs' }), allow)).kind, 'allow', '关闭后不介入')

  // 下游已经 deny/ask：不覆盖
  const downstreamDeny = async () => ({ kind: 'deny', reason: 'other guard' })
  assert.deepEqual(await askGuard(execOf('pwsh', { command: 'node scripts/install-local.mjs' }), downstreamDeny), { kind: 'deny', reason: 'other guard' })
  console.log('  ✓ 执行前闸门：危险操作 ask（有审批）/ deny（never 或无通道）；普通操作放行；关闭开关回退')
}

console.log('guard.test OK：识别规则 / 三件产物判定 / 事故回归 / 关闭开关 / 历史轮不污染 / 不误伤 / 执行前闸门 全部符合预期')
