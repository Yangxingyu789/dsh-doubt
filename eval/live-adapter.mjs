/** Read a specifically selected existing account in memory, only for synthetic
 * live evaluation against its official inference endpoint. Never export secrets.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
export async function liveAdapter(app, accountHome) {
  if (!app || !accountHome) throw Error('Explicit app and account-home required')
  const host = join(resolve(app), 'resources/app.asar/dsh')
  const req = createRequire(join(host, 'x.js'))
  const { parseDocument } = req('yaml')
  const doc = parseDocument(readFileSync(join(resolve(accountHome), '.credentials.yaml'), 'utf8'), { prettyErrors: false })
  if (doc.errors.length) throw Error('Cannot parse credential store (contents suppressed)')
  const store = doc.toJS(), grant = store.records?.['deepseek-account-platform/default']
  if (store.version !== 1 || grant?.kind !== 'grant' || typeof grant.payload?.token !== 'string') throw Error('No stored DeepSeek account grant')
  const issuer = new URL(grant.payload.issuer)
  if (issuer.protocol !== 'https:' || issuer.hostname !== 'platform.deepseek.com' || grant.payload.token.startsWith('dsh_mock_')) throw Error('Unsupported account issuer; no request sent')
  const { DeepSeekAdapter, resolveAdapterOptions } = await import(pathToFileURL(join(host, 'node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js')).href)
  const connection = resolveAdapterOptions({ baseURL: 'https://api.deepseek.com/anthropic' })
  return new DeepSeekAdapter({ options: () => connection,
    resolveAuth: async () => ({ headers: { 'x-dsh-auth-token': grant.payload.token } }),
    resolveUserId: () => readFileSync(join(resolve(accountHome), '.anonymous-user-id'), 'utf8').trim(),
    prepareExtensions: async () => ({ fields: {}, accept: async () => {} }),
  })
}
