

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const problems = []
const notes = []
const read = (p) => readFileSync(join(root, p), 'utf8')


for (const f of ['package.json', 'dsh-plugin.json']) {
  try {
    JSON.parse(read(f))
    notes.push(`JSON 合法：${f}`)
  } catch (e) {
    problems.push(`${f} 不是合法 JSON：${e.message}`)
  }
}

const pkg = JSON.parse(read('package.json'))
const manifest = JSON.parse(read('dsh-plugin.json'))


if (pkg.version !== manifest.version) problems.push(`版本不一致：package.json=${pkg.version} dsh-plugin.json=${manifest.version}`)
else notes.push(`版本一致：${pkg.version}`)


for (const [key, val] of Object.entries(pkg.exports ?? {})) {
  const targets = typeof val === 'string' ? [val] : [val?.default, val?.types].filter(Boolean)
  for (const t of targets) {
    if (!existsSync(join(root, t))) problems.push(`exports[${key}] 指向不存在的文件：${t}`)
  }
}
notes.push(`exports 条目全部存在（${Object.keys(pkg.exports ?? {}).length} 个）`)


for (const f of pkg.files ?? []) {
  if (!existsSync(join(root, f))) problems.push(`files 列了不存在的路径：${f}`)
}


const configSrc = read('src/config.ts')
const iface = configSrc.slice(configSrc.indexOf('export interface DoubtConfig'), configSrc.indexOf('export const DEFAULT_CONFIG'))
if (!iface || iface.length < 200) problems.push('没定位到 DoubtConfig 接口，检查失败')
const declaredKeys = new Set([...iface.matchAll(/^\s{2}([A-Za-z][\w]*)\??:/gm)].map((m) => m[1]))
const patch = read('cordis.patch.yml')


const patchLines = patch.split('\n')
const cfgLine = patchLines.findIndex((l) => /^\s*config:\s*$/.test(l))
const patchKeys = []
if (cfgLine < 0) {
  problems.push('cordis.patch.yml 里找不到 config: 块')
} else {
  const indent = patchLines[cfgLine].match(/^\s*/)[0].length
  for (let i = cfgLine + 1; i < patchLines.length; i += 1) {
    const line = patchLines[i]
    if (!line.trim() || line.trim().startsWith('#')) continue
    const ind = line.match(/^\s*/)[0].length
    if (ind <= indent) break
    const m = new RegExp(`^\\s{${ind}}([A-Za-z][\\w]*):`).exec(line)
    if (m) patchKeys.push(m[1])
  }
}
if (patchKeys.length === 0) problems.push('cordis.patch.yml 的 config 块里没解析出任何键，检查失效')
const unknown = patchKeys.filter((k) => !declaredKeys.has(k))
if (unknown.length > 0) problems.push(`cordis.patch.yml 里有配置类型不认识的键：${unknown.join(', ')}`)
else notes.push(`patch.yml 的 ${patchKeys.length} 个键都在 DoubtConfig 里`)


const defaults = configSrc.slice(configSrc.indexOf('export const DEFAULT_CONFIG'))
for (const k of declaredKeys) {
  if (!new RegExp(`^\\s{2}${k}:`, 'm').test(defaults)) problems.push(`DEFAULT_CONFIG 缺少键 ${k}`)
}


const stale = ['autoRecheck']
const scanFiles = ['src/index.ts', 'src/loop.ts', 'src/config.ts', 'test/smoke.mjs', 'test/loop.test.mjs', 'cordis.patch.yml', 'README.md', 'README.zh-CN.md']
for (const f of scanFiles) {
  const text = read(f)
  for (const s of stale) {
    if (text.includes(s)) problems.push(`${f} 残留旧字段 ${s}`)
  }
}
notes.push('无旧字段残留（autoRecheck）')


for (const f of ['README.md', 'README.zh-CN.md']) {
  const refs = new Set([...read(f).matchAll(/\((src\/[\w.-]+\.ts)\)/g)].map((m) => m[1]))
  for (const r of refs) {
    if (!existsSync(join(root, r))) problems.push(`${f} 引用不存在的文件：${r}`)
  }
  notes.push(`${f} 引用 ${refs.size} 个源文件，全部存在`)
}


const suiteCount = (pkg.scripts.test ?? '').split('&&').length
for (const f of ['README.md', 'README.zh-CN.md']) {
  const text = read(f)
  const claimed = [...text.matchAll(/(\d+)\s*(?:套|test suites?)/gi)].map((m) => Number(m[1]))
  for (const c of claimed) {
    if (c !== suiteCount && c !== suiteCount + 1) problems.push(`${f} 声称 ${c} 套测试，实际 test 脚本跑 ${suiteCount} 套`)
  }
}
notes.push(`test 脚本 ${suiteCount} 套 + smoke`)


const declaredTools = (manifest.contributes?.['x-tool-namespaces'] ?? []).flatMap((ns) => ns.tools ?? [])
for (const t of declaredTools) {
  const toolSources = read('src/tool.ts') + read('src/completion.ts')
  if (!toolSources.includes(`'${t}'`) && !toolSources.includes(`"${t}"`)) {
    problems.push(`manifest 声明工具 ${t}，但工具实现里找不到`)
  }
}
notes.push(`manifest 工具声明：${declaredTools.join(', ')}`)


const entry = manifest.facets?.host?.entry
if (!entry || !existsSync(join(root, entry))) problems.push(`manifest entry 不存在：${entry}`)
else notes.push(`manifest entry 存在：${entry}`)




//   dsh: [dsh-doubt] patch: entry "dsh-doubt" not found

const topLevelItems = patch.split(/\n(?=- )/)
const nonInsertNamed = topLevelItems.filter((item) => /^- (?!insert:)/.test(item) && /^\s{2,}name:/m.test(item))
if (nonInsertNamed.length > 0) {
  problems.push('cordis.patch.yml 有顶层非 insert 条目声明了 name：宿主会当作覆盖并跳过，插件不会加载')
}
if (!/^- insert:/m.test(patch)) problems.push('cordis.patch.yml 没有顶层 insert:，插件行不会被插入')
else notes.push('patch.yml 用 insert: 插入新行（宿主 applyEntryPatches 会真正加载）')


const pkgName = pkg.name
if (!new RegExp(`^\\s+- id:\\s*${pkgName}\\s*$`, 'm').test(patch)) problems.push(`patch.yml 的 insert 里没有 id: ${pkgName}`)
else notes.push(`insert 的 id 与包名一致：${pkgName}`)

for (const n of notes) console.log(`OK   ${n}`)
if (problems.length > 0) {
  console.error('')
  for (const p of problems) console.error(`FAIL ${p}`)
  console.error(`\n自检失败：${problems.length} 项`)
  process.exit(1)
}
console.log(`\n自检通过：${notes.length} 项`)
