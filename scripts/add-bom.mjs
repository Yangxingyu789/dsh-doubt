// 给 PowerShell 脚本加 UTF-8 BOM：Windows PowerShell 5.1 对无 BOM 的 UTF-8 会按 ANSI
// 解码，中文注释/字符串里的多字节字符会把引号/括号解析坏（实测 upgrade-offline.ps1 语法错误）。
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
