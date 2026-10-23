#!/usr/bin/env node
/**
 * Unpack the installed DSH desktop app's `resources/app.asar` into a plain directory
 * so the external-oracle checks can import the real host modules from disk:
 *
 *   - scripts/verify-independent.mjs  (semver, the real dsh CLI)
 *   - (test/host*.test.mjs spawn the Electron binary directly and do not need this)
 *
 * Why a script and not a one-liner: the previous unpack on this machine was taken by
 * hand from an older build and silently lost 87 packages' `package.json`, which made
 * `verify:independent` fail with `ERR_MODULE_NOT_FOUND` for a reason that had nothing
 * to do with this plugin. The marker file written here lets the verifier tell a fresh
 * unpack from a stale or partial one and skip with an actionable message.
 *
 * Usage:
 *   node scripts/unpack-host.mjs [--app <dir>] [--out <dir>] [--quiet]
 *   npm run host:unpack
 *
 * Defaults:
 *   --out  <tmp>/dsh-asar   (the asar ROOT: dsh/, lib/, node_modules/, renderer/, package.json)
 *   --app  resolved by scripts/host-app.mjs
 *
 * Layout note: the host runtime lives at `<out>/dsh/node_modules/@deepseek-ai/...`,
 * which is what DSH_ASAR_DIR points at.
 */
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { HOST_HINT, resolveHostApp } from './host-app.mjs'

const arg = (name) => {
  const at = process.argv.indexOf(name)
  return at >= 0 ? process.argv[at + 1] : undefined
}
const quiet = process.argv.includes('--quiet')
const say = (...a) => { if (!quiet) console.log(...a) }

const app = resolveHostApp()
if (!app) {
  // No DSH install: platform checks are unavailable here.
  console.log(`SKIP unpack-host: no installed DSH app found (${HOST_HINT})`)
  process.exit(0)
}
const asarPath = join(app, 'resources', 'app.asar')
if (!existsSync(asarPath)) {
  console.error(`FAIL unpack-host: ${asarPath} does not exist`)
  process.exit(1)
}
const out = resolve(arg('--out') ?? join(tmpdir(), 'dsh-asar'))
const staging = `${out}.unpacking-${process.pid}`

// ── read the asar header ──────────────────────────────────────────────────────
// Layout: UInt32(4) | UInt32(headerSize) | UInt32(headerObjectSize) | UInt32(jsonLength) | JSON | files
const fd = openSync(asarPath, 'r')
let header, base
try {
  const head = Buffer.alloc(16)
  readSync(fd, head, 0, 16, 0)
  if (head.readUInt32LE(0) !== 4) throw new Error('not an asar archive (bad pickle header)')
  const headerSize = head.readUInt32LE(4)
  const jsonLength = head.readUInt32LE(12)
  const json = Buffer.alloc(jsonLength)
  readSync(fd, json, 0, jsonLength, 16)
  header = JSON.parse(json.toString('utf8'))
  base = 8 + headerSize

  // ── extract ────────────────────────────────────────────────────────────────
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  const unpackedRoot = join(app, 'resources', 'app.asar.unpacked')
  let files = 0
  let unpacked = 0
  const walk = (node, rel) => {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const childRel = rel ? `${rel}/${name}` : name
      const childAbs = join(staging, childRel)
      if (entry.files) {
        mkdirSync(childAbs, { recursive: true })
        walk(entry, childRel)
        continue
      }
      mkdirSync(dirname(childAbs), { recursive: true })
      if (entry.unpacked) {
        copyFileSync(join(unpackedRoot, childRel), childAbs)
        unpacked++
      } else {
        const size = Number(entry.size)
        const offset = Number(entry.offset)
        const buf = Buffer.alloc(size)
        readSync(fd, buf, 0, size, base + offset)
        writeFileSync(childAbs, buf)
        files++
      }
    }
  }
  walk(header, '')
  writeFileSync(join(staging, '.unpacked.json'), `${JSON.stringify({
    app,
    asar: asarPath,
    asarSize: statSync(asarPath).size,
    asarMtimeMs: statSync(asarPath).mtimeMs,
    unpackedAt: Date.now(),
    files,
    unpacked,
  }, null, 2)}\n`)

  rmSync(out, { recursive: true, force: true })
  renameSync(staging, out)
  say(`OK unpack-host: ${files} packed + ${unpacked} unpacked files -> ${out}`)
  say(`   host runtime: ${join(out, 'dsh')}`)
} catch (error) {
  rmSync(staging, { recursive: true, force: true })
  console.error(`FAIL unpack-host: ${error.message}`)
  process.exit(1)
} finally {
  closeSync(fd)
}
