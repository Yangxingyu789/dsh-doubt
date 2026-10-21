

import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const files = [
  'E:\\dsh-doubt\\scripts\\upgrade-offline.ps1',
  'E:\\dsh-doubt\\scripts\\run-upgrade.ps1',
]

for (const file of files) {
  if (!existsSync(file)) { console.log(`skip-missing ${file}`); continue }
  let text = readFileSync(file, 'utf8')
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
  writeFileSync(file, '\uFEFF' + text, 'utf8')
  console.log(`bom-added ${file}`)
}
