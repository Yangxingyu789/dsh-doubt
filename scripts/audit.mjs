/**
 * 仓库自检：把「我声称的」和「文件里实际有的」逐项对齐。
 * 任何一项失败都退出码 1，可挂进 CI。
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const problems = []
const notes = []
const read = (p) => readFileSync(join(root, p), 'utf8')

// 1. JSON 合法性
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

// 2. 版本一致性
if (pkg.version !== manifest.version) problems.push(`版本不一致：package.json=${pkg.version} dsh-plugin.json=${manifest.version}`)
else notes.push(`版本一致：${pkg.version}`)

// 3. exports 指向的文件必须存在（lib 已构建）
for (const [key, val] of Object.entries(pkg.exports ?? {})) {
  const targets = typeof val === 'string' ? [val] : [val?.default, val?.types].filter(Boolean)
  for (const t of targets) {
    if (!existsSync(join(root, t))) problems.push(`exports[${key}] 指向不存在的文件：${t}`)
  }
}
notes.push(`exports 条目全部存在（${Object.keys(pkg.exports ?? {}).length} 个）`)

// 4. files 里列的东西必须存在
for (const f of pkg.files ?? []) {
  if (!existsSync(join(root, f))) problems.push(`files 列了不存在的路径：${f}`)
}

// 5. patch.yml 的 config 键必须都在 DoubtConfig 里
const configSrc = read('src/config.ts')
const iface = configSrc.slice(configSrc.indexOf('export interface DoubtConfig'), configSrc.indexOf('export const DEFAULT_CONFIG'))
if (!iface || iface.length < 200) problems.push('没定位到 DoubtConfig 接口，检查失败')
const declaredKeys = new Set([...iface.matchAll(/^\s{2}([A-Za-z][\w]*)\??:/gm)].map((m) => m[1]))
const patch = read('cordis.patch.yml')
const patchKeys = [...patch.matchAll(/^ {4}([A-Za-z][\w]*):/gm)].map((m) => m[1])
const unknown = patchKeys.filter((k) => !declaredKeys.has(k))
if (unknown.length > 0) problems.push(`cordis.patch.yml 里有配置类型不认识的键：${unknown.join(', ')}`)
else notes.push(`patch.yml 的 ${patchKeys.length} 个键都在 DoubtConfig 里`)

// 6. 默认值必须真的存在于 DEFAULT_CONFIG
const defaults = configSrc.slice(configSrc.indexOf('export const DEFAULT_CONFIG'))
for (const k of declaredKeys) {
  if (!new RegExp(`^\\s{2}${k}:`, 'm').test(defaults)) problems.push(`DEFAULT_CONFIG 缺少键 ${k}`)
}

// 7. 源码/测试/文档里不得残留已改名的旧字段
const stale = ['autoRecheck']
const scanFiles = ['src/index.ts', 'src/loop.ts', 'src/config.ts', 'test/smoke.mjs', 'test/loop.test.mjs', 'cordis.patch.yml', 'README.md', 'README.zh-CN.md']
for (const f of scanFiles) {
  const text = read(f)
  for (const s of stale) {
    if (text.includes(s)) problems.push(`${f} 残留旧字段 ${s}`)
  }
}
notes.push('无旧字段残留（autoRecheck）')

// 8. README 引用的 src/*.ts 必须存在
for (const f of ['README.md', 'README.zh-CN.md']) {
  const refs = new Set([...read(f).matchAll(/\((src\/[\w.-]+\.ts)\)/g)].map((m) => m[1]))
  for (const r of refs) {
    if (!existsSync(join(root, r))) problems.push(`${f} 引用不存在的文件：${r}`)
  }
  notes.push(`${f} 引用 ${refs.size} 个源文件，全部存在`)
}

// 9. 测试套件数量与 README 声明一致
const suiteCount = (pkg.scripts.test ?? '').split('&&').length
for (const f of ['README.md', 'README.zh-CN.md']) {
  const text = read(f)
  const claimed = [...text.matchAll(/(\d+)\s*(?:套|test suites?)/gi)].map((m) => Number(m[1]))
  for (const c of claimed) {
    if (c !== suiteCount && c !== suiteCount + 1) problems.push(`${f} 声称 ${c} 套测试，实际 test 脚本跑 ${suiteCount} 套`)
  }
}
notes.push(`test 脚本 ${suiteCount} 套 + smoke`)

// 10. manifest 声明的工具名必须真的在代码里注册
const declaredTools = (manifest.contributes?.['x-tool-namespaces'] ?? []).flatMap((ns) => ns.tools ?? [])
for (const t of declaredTools) {
  if (!read('src/tool.ts').includes(`'${t}'`) && !read('src/tool.ts').includes(`"${t}"`)) {
    problems.push(`manifest 声明工具 ${t}，但 src/tool.ts 里找不到`)
  }
}
notes.push(`manifest 工具声明：${declaredTools.join(', ')}`)

// 11. manifest 的 entry 必须存在
const entry = manifest.facets?.host?.entry
if (!entry || !existsSync(join(root, entry))) problems.push(`manifest entry 不存在：${entry}`)
else notes.push(`manifest entry 存在：${entry}`)

for (const n of notes) console.log(`OK   ${n}`)
if (problems.length > 0) {
  console.error('')
  for (const p of problems) console.error(`FAIL ${p}`)
  console.error(`\n自检失败：${problems.length} 项`)
  process.exit(1)
}
console.log(`\n自检通过：${notes.length} 项`)
