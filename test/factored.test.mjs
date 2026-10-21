import assert from 'node:assert/strict'
import { factoredCheck, normalizeAnswer } from '../lib/factored.js'


assert.equal(normalizeAnswer('是的，存在'), 'affirmative')
assert.equal(normalizeAnswer('Yes, it exists'), 'affirmative')
assert.equal(normalizeAnswer('不存在这个路径'), 'negative')
assert.equal(normalizeAnswer('No, that is not correct'), 'negative')
assert.equal(normalizeAnswer('实际版本是 v1.2.3'), '1.2.3')
assert.equal(normalizeAnswer('路径是 C:\\a\\b.yaml'), 'c:\\a\\b.yaml')




assert.equal(normalizeAnswer('Node.js v24.21.0 is the runtime'), '24.21.0', '"Node" 不得被当成 no')
assert.equal(normalizeAnswer('node 24'), 'node 24', '"node" 不得被当成 no')
assert.equal(normalizeAnswer('Yes, I know the version: 24.21.0'), 'affirmative', '"know" 不得被当成 no')
assert.equal(normalizeAnswer('notably it exists'), 'affirmative', '"notably" 不得被当成 no')
assert.equal(normalizeAnswer('know-how is present'), 'affirmative')
assert.equal(normalizeAnswer('The file is not missing'), 'negative', '独立词 not 仍是否定')

assert.equal(new Set([1, 2, 3].map(() => normalizeAnswer('Node.js v24.21.0 is the runtime'))).size, 1)
assert.equal(normalizeAnswer('Node.js v24.21.0 is the runtime'), '24.21.0')


const none = await factoredCheck('包 X 是否存在？只回答 yes 或 no。', { provider: 'p', votes: 3, timeoutMs: 1000 }, null)
assert.equal(none.available, false, '无宿主能力应 unavailable')
assert.ok(none.reason, '应说明原因')


function fakeHost(answer, delay = 0) {
  return {
    subagents: {
      start: async (_name, req) => {
        assert.ok(req.prompt[0].text.length > 0, 'prompt 必须是自包含提问')
        assert.ok(req.parent, '必须带 parent')
        assert.ok(req.signal instanceof AbortSignal, '必须带取消信号')
        if (delay) await new Promise((r) => setTimeout(r, delay))
        return {
          result: Promise.resolve({ output: [{ type: 'text', text: answer }], stopReason: 'completed' }),
          dispose: async () => {},
        }
      },
    },
    parent: { id: 'parent-1' },
  }
}

const agree = await factoredCheck('包 X 是否存在？只回答 yes 或 no。', { provider: 'p', votes: 3, timeoutMs: 1000 }, fakeHost('yes'))
assert.equal(agree.available, true)
assert.equal(agree.majority, 'affirmative', `3 票一致应得多数，实际 ${JSON.stringify(agree.votes)}`)
assert.equal(agree.agree, 3)
assert.equal(agree.total, 3)


let i = 0
const splitHost = {
  subagents: {
    start: async () => ({
      result: Promise.resolve({ output: [{ type: 'text', text: (i++ % 2 === 0 ? 'yes' : 'no') }], stopReason: 'completed' }),
      dispose: async () => {},
    }),
  },
  parent: { id: 'p' },
}
const split = await factoredCheck('包 X 是否存在？', { provider: 'p', votes: 4, timeoutMs: 1000 }, splitHost)
assert.equal(split.majority, null, '2:2 分裂不应给结论')
assert.ok(split.reason?.includes('投票分裂'), `应说明分裂，实际 ${split.reason}`)


const failHost = { subagents: { start: async () => { throw new Error('provider 未注册') } }, parent: { id: 'p' } }
const failed = await factoredCheck('包 X 是否存在？', { provider: 'p', votes: 3, timeoutMs: 1000 }, failHost)
assert.equal(failed.available, false, '调用失败应 unavailable')
assert.ok(failed.reason?.includes('provider 未注册'), '应带上失败原因')

console.log('factored.test OK（归一化 / 多数投票 / 分裂不给结论 / 不可用时如实报告）')
