#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const name = pkg.name
const dry = process.argv.includes('--dry')
const at = process.argv.indexOf('--profile')
const profile = at > 0 ? process.argv[at + 1] : 'desktop'

const home = process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME, '.dsh')
const dest = join(home, 'plugins', name)
const profileDir = join(home, 'profiles', profile)
const profilePkgPath = join(profileDir, 'package.json')

if (!existsSync(profileDir)) {
  console.error(`profile 目录不存在：${profileDir}`)
  console.error('现有 profile：')
  for (const p of ['desktop', 'web']) if (existsSync(join(home, 'profiles', p))) console.error('  -', p)
  process.exit(1)
}

if (!dry) {
  const build = spawnSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(root, 'tsconfig.json')], { cwd: root, stdio: 'inherit' })
  if (build.status !== 0) {
    console.error('构建失败，已中止安装')
    process.exit(build.status ?? 1)
  }
}

const COPY = ['lib', 'cordis.patch.yml', 'dsh-plugin.json', 'package.json', 'README.md', 'README.zh-CN.md', 'LICENSE', 'CHANGELOG.md', 'docs']
const todo = COPY.filter((f) => existsSync(join(root, f)))

console.log(`插件      : ${name}@${pkg.version}`)
console.log(`目标目录  : ${dest}`)
console.log(`复制项    : ${todo.join(', ')}`)
console.log(`profile   : ${profilePkgPath}`)

if (dry) {
  const p = JSON.parse(readFileSync(profilePkgPath, 'utf8'))
  console.log('\n[dry] 现有 dependencies :', Object.keys(p.dependencies || {}).join(', '))
  console.log('[dry] 现有 bundles      :', (p?.dsh?.profile?.bundles || []).join(', '))
  console.log(`[dry] 将会追加        : ${name} -> file:../../plugins/${name}`)
  process.exit(0)
}

mkdirSync(dest, { recursive: true })
for (const f of todo) {
  const to = join(dest, f)
  if (existsSync(to)) rmSync(to, { recursive: true, force: true })
  cpSync(join(root, f), to, { recursive: true })
}

const p = JSON.parse(readFileSync(profilePkgPath, 'utf8'))
writeFileSync(`${profilePkgPath}.bak-dsh-doubt`, JSON.stringify(p, null, 2))

p.dependencies ??= {}
p.dependencies[name] = `file:../../plugins/${name}`
p.dsh ??= {}
p.dsh.profile ??= {}
p.dsh.profile.bundles ??= []
if (!p.dsh.profile.bundles.includes(name)) p.dsh.profile.bundles.push(name)

writeFileSync(profilePkgPath, `${JSON.stringify(p, null, 2)}\n`)

console.log('\n已写入 profile/package.json（备份：package.json.bak-dsh-doubt）')
console.log('\n下一步（离线）：')
console.log(`  cd "${profileDir}"`)
console.log('  pnpm install --offline')
console.log('然后重启 DSH 宿主。卸载：删掉上面两处新增项，再 pnpm install --offline。')
