/** Locate the installed DSH desktop app directory.
 *
 * Several checks need the REAL host runtime that is not this repository:
 *   - test/host.test.mjs, test/host-loop.test.mjs  (spawn the Electron binary)
 *   - scripts/unpack-host.mjs                       (unpack resources/app.asar)
 *   - scripts/verify-independent.mjs                (detect a stale unpack)
 *
 * Resolution order:
 *   1. `--app <dir>` on the command line
 *   2. DSH_APP_DIR environment variable
 *   3. the running `DeepSeek Harness` process (Windows; the desktop app is normally up)
 *   4. well-known install locations
 *
 * Returns null when nothing looks like an install, so callers can skip honestly
 * instead of failing with a misleading error.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const EXE = process.platform === 'win32' ? 'DeepSeek Harness.exe' : 'DeepSeek Harness'

/** True when `dir` contains the desktop app's asar bundle. */
export function isHostApp(dir) {
  return !!dir && existsSync(join(dir, 'resources', 'app.asar'))
}

function fromRunningProcess() {
  if (process.platform !== 'win32') return []
  const out = []
  const query = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command',
      `(Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)`],
    { encoding: 'utf8', windowsHide: true, timeout: 8000 },
  )
  const path = (query.stdout ?? '').trim()
  if (path && path.toLowerCase().endsWith(EXE.toLowerCase())) out.push(dirname(path))
  return out
}

function fromWellKnownLocations() {
  const roots = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs'),
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    join(homedir(), 'AppData', 'Local', 'Programs'),
    join(homedir(), 'Applications'),
    '/opt',
  ].filter((r) => typeof r === 'string' && r.length > 0)
  return roots.map((r) => join(r, 'DeepSeek Harness'))
}

/** All paths that will be probed, in order. Exposed for diagnostics. */
export function hostAppCandidates(argv = process.argv) {
  const list = []
  const at = argv.indexOf('--app')
  if (at >= 0 && argv[at + 1]) list.push(resolve(argv[at + 1]))
  if (process.env.DSH_APP_DIR) list.push(resolve(process.env.DSH_APP_DIR))
  list.push(...fromRunningProcess(), ...fromWellKnownLocations())
  return [...new Set(list)]
}

/** The installed app directory, or null when none is found. */
export function resolveHostApp(argv = process.argv) {
  for (const candidate of hostAppCandidates(argv)) if (isHostApp(candidate)) return candidate
  return null
}

/** One-line instruction shown when the app cannot be found. */
export const HOST_HINT = 'pass --app <installed DSH directory> or set DSH_APP_DIR'
