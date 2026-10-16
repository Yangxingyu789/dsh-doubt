import assert from 'node:assert/strict'
import { writeFileSync, unlinkSync } from 'node:fs'
import { runCheck } from '../lib/verify.js'

const opts = { timeoutMs: 8000, denyBinaries: ['rm', 'del'] }

// fileExists
let r = await runCheck({ kind: 'fileExists', path: process.argv[1] }, opts)
assert.ok(r.ok, '当前脚本应存在：' + r.detail)
r = await runCheck({ kind: 'fileExists', path: 'E:\\一定不存在的文件-9f2b.txt' }, opts)
assert.ok(!r.ok && r.detail.includes('不存在'), '缺失文件应判失败')

// fileMatch
const tmp = 'E:\\dsh-doubt\\test\\__tmp_match.txt'
writeFileSync(tmp, 'line1\nversion = "0.1.0"\nline3\n', 'utf8')
r = await runCheck({ kind: 'fileMatch', path: tmp, regex: 'version\\s*=\\s*"0\\.1\\.0"' }, opts)
assert.ok(r.ok && r.detail.includes(':2'), '应匹配到第 2 行：' + r.detail)
unlinkSync(tmp)

// command：真实执行 node
r = await runCheck({ kind: 'command', argv: [process.execPath, '-e', 'console.log("measured-42")'], expectMatch: 'measured-42' }, opts)
assert.ok(r.ok, '命令应通过：' + r.detail)
r = await runCheck({ kind: 'command', argv: [process.execPath, '-e', 'process.exit(3)'], expectExit: 0 }, opts)
assert.ok(!r.ok && r.detail.includes('期望退出码 0'), '退出码不符应判失败：' + r.detail)

// denyBinaries
r = await runCheck({ kind: 'command', argv: ['rm', '-rf', '/'], expectExit: 0 }, opts)
assert.ok(!r.ok && r.detail.includes('拒绝执行'), '被禁程序应拒绝：' + r.detail)

// 空 argv
r = await runCheck({ kind: 'command', argv: [] }, opts)
assert.ok(!r.ok, '空 argv 应失败')

// expr：沙箱里没有 require
r = await runCheck({ kind: 'expr', source: '21 * 2', expectMatch: '42' }, opts)
assert.ok(r.ok, '表达式应求值为 42：' + r.detail)
r = await runCheck({ kind: 'expr', source: 'typeof require' }, opts)
assert.ok(r.ok && r.detail.includes('undefined'), '沙箱里 require 应为 undefined：' + r.detail)
r = await runCheck({ kind: 'expr', source: 'process.exit(1)' }, opts)
assert.ok(!r.ok, 'process 不存在，求值应失败')

// 超时
r = await runCheck({ kind: 'command', argv: [process.execPath, '-e', 'setTimeout(()=>{},30000)'], timeoutMs: 700 }, opts)
assert.ok(!r.ok && r.detail.includes('超时'), '应超时：' + r.detail)

// httpStatus（离线时允许失败，但必须是结构化判定）
r = await runCheck({ kind: 'httpStatus', url: 'not-a-url' }, opts)
assert.ok(!r.ok && r.detail.includes('url 非法'), '非法 url 应判失败')

// textEquals
r = await runCheck({ kind: 'textEquals', actual: ' a ', expected: 'a' }, opts)
assert.ok(r.ok, 'trim 后应一致')

console.log('verify.test OK（命令/文件/表达式/超时/黑名单 全部实测）')
