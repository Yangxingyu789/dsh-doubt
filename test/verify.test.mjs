import assert from 'node:assert/strict'
import { writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCheck } from '../lib/verify.js'




const tmpFile = (name) => join(tmpdir(), `dsh-doubt-${process.pid}-${name}`)

const opts = { timeoutMs: 8000, denyBinaries: ['rm', 'del'] }

// fileExists
let r = await runCheck({ kind: 'fileExists', path: process.argv[1] }, opts)
assert.ok(r.ok, '当前脚本应存在：' + r.detail)
r = await runCheck({ kind: 'fileExists', path: 'E:\\一定不存在的文件-9f2b.txt' }, opts)
assert.ok(!r.ok && r.detail.includes('不存在'), '缺失文件应判失败')

// fileMatch
const tmp = tmpFile('match.txt')
writeFileSync(tmp, 'line1\nversion = "0.1.0"\nline3\n', 'utf8')
r = await runCheck({ kind: 'fileMatch', path: tmp, regex: 'version\\s*=\\s*"0\\.1\\.0"' }, opts)
assert.ok(r.ok && r.detail.includes(':2'), '应匹配到第 2 行：' + r.detail)
unlinkSync(tmp)


r = await runCheck({ kind: 'command', argv: [process.execPath, '-e', 'console.log("measured-42")'], expectMatch: 'measured-42' }, opts)
assert.ok(r.ok, '命令应通过：' + r.detail)
r = await runCheck({ kind: 'command', argv: [process.execPath, '-e', 'process.exit(3)'], expectExit: 0 }, opts)
assert.ok(!r.ok && r.detail.includes('期望退出码 0'), '退出码不符应判失败：' + r.detail)

// denyBinaries
r = await runCheck({ kind: 'command', argv: ['rm', '-rf', '/'], expectExit: 0 }, opts)
assert.ok(!r.ok && r.detail.includes('拒绝执行'), '被禁程序应拒绝：' + r.detail)




for (const bin of ['del.exe', 'reg.exe', 'schtasks.exe', 'format.com', 'rm.bat', 'C:\\Windows\\System32\\reg.exe']) {
  r = await runCheck({ kind: 'command', argv: [bin, '/?'] }, { timeoutMs: 8000, denyBinaries: ['rm', 'del', 'reg', 'schtasks', 'format'] })
  assert.ok(!r.ok && r.detail.includes('拒绝执行'), `带扩展名的被禁程序应拒绝：${bin} → ${r.detail}`)
}



try {
  const { statSync } = await import('node:fs')
  statSync('C:\\pagefile.sys')
} catch (e) {
  if (e?.code && e.code !== 'ENOENT' && e.code !== 'ENOTDIR') {
    r = await runCheck({ kind: 'fileExists', path: 'C:\\pagefile.sys' }, opts)
    assert.ok(!r.detail.startsWith('不存在'), 'stat 失败不得报「不存在」：' + r.detail)
    assert.ok(r.detail.includes('无法判定'), '应如实报无法判定：' + r.detail)
  }
}


r = await runCheck({ kind: 'fileMatch', path: 'C:\\Windows\\System32\\config\\SAM', regex: 'x' }, opts)
assert.ok(!r.ok, '不可读/非法文件应判失败而不是抛错')


r = await runCheck({ kind: 'command', argv: [] }, opts)
assert.ok(!r.ok, '空 argv 应失败')


r = await runCheck({ kind: 'expr', source: '21 * 2', expectMatch: '42' }, opts)
assert.ok(r.ok, '表达式应求值为 42：' + r.detail)
r = await runCheck({ kind: 'expr', source: 'typeof require', expectMatch: 'undefined' }, opts)
assert.ok(r.ok && r.detail.includes('undefined'), '沙箱里 require 应为 undefined：' + r.detail)
r = await runCheck({ kind: 'expr', source: 'process.exit(1)' }, opts)
assert.ok(!r.ok, 'process 不存在，求值应失败')



r = await runCheck({ kind: 'expr', source: '1 === 2' }, opts)
assert.ok(!r.ok, 'expr 未给期望应判失败（不得假成功）：' + r.detail)
r = await runCheck({ kind: 'expr', source: '1 === 2', expectMatch: '' }, opts)
assert.ok(!r.ok, '空 expectMatch 应判失败：' + r.detail)
r = await runCheck({ kind: 'textEquals' }, opts)
assert.ok(!r.ok, 'textEquals 两侧都空应判失败：' + r.detail)
r = await runCheck({ kind: 'fileMatch', path: process.argv[1], regex: '' }, opts)
assert.ok(!r.ok, 'fileMatch 空正则应判失败：' + r.detail)


{
  const { writeFileSync } = await import('node:fs')
  const redos = tmpFile('redos.txt')
  writeFileSync(redos, 'a'.repeat(40) + 'b', 'utf8')
  const t0 = Date.now()
  r = await runCheck({ kind: 'fileMatch', path: redos, regex: '(a+)+$' }, opts)
  const ms = Date.now() - t0
  assert.ok(!r.ok, '灾难性回溯不得判通过：' + r.detail)
  assert.ok(ms < 8000, `灾难性回溯必须在预算内返回，实际 ${ms}ms`)
  ;(await import('node:fs')).unlinkSync(redos)
}






{
  const { spawnSync } = await import('node:child_process')
  const lib = new URL('../lib/verify.js', import.meta.url).href
  const probe = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { runCheck } = await import(${JSON.stringify(lib)})
    const cases = [
      "Promise.reject(new Error('x'))",
      "import('node:fs')",
      "(() => { const f = () => Promise.resolve().then(f); f(); return 'started' })()",
    ]
    for (const source of cases) {
      const t0 = Date.now()
      const out = await runCheck({ kind: 'expr', source }, { timeoutMs: 600, denyBinaries: [] })
      if (out.ok !== false) { console.error('expected ok=false for ' + source); process.exit(3) }
      if (Date.now() - t0 > 5000) { console.error('took too long: ' + source); process.exit(4) }
    }
    console.log('EXPR-ASYNC-SAFE')
  `], { encoding: 'utf8', timeout: 20000 })
  assert.equal(probe.status, 0, `expr 异步载荷不得打死进程（status=${probe.status} signal=${probe.signal}）：${probe.stderr?.slice(0, 300)}`)
  assert.ok(/EXPR-ASYNC-SAFE/.test(probe.stdout ?? ''), '子进程应跑完全部异步载荷：' + (probe.stdout ?? '').slice(0, 200))
}


r = await runCheck({ kind: 'command', argv: [process.execPath, '-e', 'setTimeout(()=>{},30000)'], timeoutMs: 700 }, opts)
assert.ok(!r.ok && r.detail.includes('超时'), '应超时：' + r.detail)


r = await runCheck({ kind: 'httpStatus', url: 'not-a-url' }, opts)
assert.ok(!r.ok && r.detail.includes('url 非法'), '非法 url 应判失败')

// textEquals
r = await runCheck({ kind: 'textEquals', actual: ' a ', expected: 'a' }, opts)
assert.ok(r.ok, 'trim 后应一致')





{
  const hostile = [
    { src: '({ then() { for (;;) {} } })' },
    { src: '({ get then() { for (;;) {} } })' },
    { src: 'new Proxy({}, { get() { for (;;) {} } })' },
    { src: "Object.defineProperty({}, 'then', { get: () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0) } })" },
    { src: '({ then() { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0) } })' },
    { src: '({ toJSON() { for (;;) {} } })' },
    { src: "(() => { Promise.reject(new Error('unhandled-in-vm')); return 'ok' })()" },
    { src: "(() => { Promise.reject('string-reason'); return 2 })()" },
  ]
  const t0 = Date.now()
  for (const h of hostile) {
    const out = await runCheck({ kind: 'expr', source: h.src }, { timeoutMs: 800, denyBinaries: [] })
    assert.equal(out.ok, false, `恶意载荷不得报通过：${h.src} → ${out.ok}`)
  }

  const dropped = await runCheck(
    { kind: 'expr', source: "(() => { Promise.reject(new Error('dropped')); return 'looks-fine' })()", expectMatch: 'looks-fine' },
    { timeoutMs: 800, denyBinaries: [] },
  )
  assert.equal(dropped.ok, true, '表达式本身返回了期望值，应判通过；但进程必须还活着')
  const spent = Date.now() - t0
  assert.ok(spent < 40000, `载荷必须被隔离在子进程里并在预算内返回，实际 ${spent}ms`)
}

console.log('verify.test OK（命令/文件/表达式/超时/黑名单/子进程隔离 全部实测）')
