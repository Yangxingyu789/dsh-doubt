/** Optional live evaluation. Uses the installed host adapter and an explicitly
 * selected existing DeepSeek account. Never prints/copies credentials, changes
 * profiles, runs agent tools, or sends local sessions. Sends synthetic cases only.
 * node eval/review-live.mjs --app E:/dsh --account-home <DSH_HOME> --model deepseek-flash
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'
import { liveAdapter } from './live-adapter.mjs'
import { reviewCases } from './review-cases.mjs'
import { reviewPacket as currentReviewPacket } from '../lib/completion.js'
import { normalizeConfig } from '../lib/config.js'
const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1] }
const app = arg('--app') || process.env.DSH_APP_DIR
const accountHome = arg('--account-home')
const model = arg('--model')
const reviewRoot = arg('--review-root')
const reviewPacket = reviewRoot ? (await import(pathToFileURL(join(resolve(reviewRoot), 'lib/completion.js')).href)).reviewPacket : currentReviewPacket
if (!app || !accountHome || !model) throw Error('Provide --app, --account-home and --model explicitly. Live evaluation consumes model usage.')
if (!process.argv.includes('--worker')) {
  const child = spawnSync(join(resolve(app), 'DeepSeek Harness.exe'), [fileURLToPath(import.meta.url), ...process.argv.slice(2), '--worker'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, stdio: 'inherit', timeout: 900_000,
  })
  if (child.error) console.error(child.error.code)
  process.exit(child.status ?? 1)
}
const adapter = await liveAdapter(app, accountHome)
// Exercise host model resolution and error-to-finish conversion as production
// does, not just adapter.stream (which skips that integration boundary).
const hostModule = (name) => import(pathToFileURL(join(resolve(app), 'resources/app.asar/dsh/node_modules/@deepseek-ai', name, 'lib/index.js')).href)
const { Context } = await hostModule('cordis')
const { LlmRuntime } = await hostModule('dsh-llm')
const context = new Context(), runtime = new LlmRuntime(context)
runtime.registerAdapter(['deepseek-account'], adapter)
const cfg = normalizeConfig({ reviewTimeoutMs: 60_000 })
const chosen = reviewCases.filter((c) => !arg('--case') || c.id === arg('--case'))
if (!chosen.length) throw Error('No matching case')
const rows = []
for (const c of chosen) {
  let raw = '', finish, transportError, usage
  const llm = { async *stream(request) {
    try {
      raw = '' // A bounded reviewer retry replaces the previous partial JSON.
      for await (const chunk of runtime.stream(request)) {
        if (chunk.type === 'text-delta') raw += chunk.text
        if (chunk.type === 'finish') {
          finish = chunk.reason.kind
          if (chunk.reason.failure) transportError = { code: chunk.reason.failure.code, status: chunk.reason.failure.status }
        }
        if (chunk.type === 'usage') usage = chunk
        yield chunk
      }
    } catch (e) { transportError = { code: e.code || e.name, status: e.failure?.status, causeCode: e.failure?.cause?.cause?.code ?? e.cause?.cause?.code ?? e.failure?.cause?.code }; throw Error('Provider request failed; see transport status') }
  } }
  const start = Date.now()
  const result = await reviewPacket(c.packet, { provider: 'deepseek-account', model }, llm, cfg)
  let parsed
  try { parsed = JSON.parse(raw) } catch {}
  const validModelResponse = !transportError && finish === 'stop' && ['approve', 'verify'].includes(parsed?.decision)
  const status = !validModelResponse ? 'ERROR' : result.approved === c.expected ? 'PASS' : 'FAIL'
  const row = { id: c.id, expected: c.expected, status, elapsedMs: Date.now() - start, result, review: parsed, finish, transportError, usage }
  rows.push(row)
  console.log(JSON.stringify({ id: row.id, status, elapsedMs: row.elapsedMs, approved: result.approved, issues: result.issues, transportError }))
  // Do not burn the remaining suite on a broken account or connection.
  if (transportError) break
}
const output = resolve(arg('--out') || 'eval/out/review-live.json')
mkdirSync(join(output, '..'), { recursive: true })
writeFileSync(output, JSON.stringify({ timestamp: new Date().toISOString(), model, reviewRoot: reviewRoot ?? 'workspace', scope: 'synthetic evidence through real host LlmRuntime and adapter; not a desktop end-to-end repair trial', requestedCases: chosen.length, rows }, null, 2))
console.log(`Report: ${output}`)
await context.fiber.dispose()
process.exitCode = rows.length === chosen.length && rows.every((r) => r.status === 'PASS') ? 0 : 1
