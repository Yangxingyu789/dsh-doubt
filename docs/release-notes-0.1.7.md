# dsh-doubt 0.1.7

Code-comment and evaluation-script audit release. No runtime behavior changes from 0.1.6.

## Fixes

- Removed remaining Chinese, tutorial-style and placeholder code comments from
  `src/`, `test/`, `scripts/` and `eval/`. Comments now state only non-obvious
  constraints, edge cases or intent.
- Translated the offline upgrade script's comments to concise English.
- Fixed a pre-existing syntax error in `eval/inspect.mjs`: a `for` loop followed a
  `console.log` call on the same line. The script now parses and runs.
- Added concise English file-purpose comments to the evaluation scripts.
- Install URLs and release assets point at `v0.1.7`.

## Validation

- `npm run check`, `npm run build`, 12 test suites, smoke, audit and the full local verify
  chain pass.
- All `eval/*.mjs` files pass `node --check`.
- The PowerShell upgrade launcher and offline upgrade script pass `-CheckOnly` /
  `-DryRun`.
- Release tarball includes `package/lib/index.js`; the source zip includes the cleaned
  comments and scripts.

## Install

```bash
dsh plugin --profile web add github:Yangxingyu789/dsh-doubt#v0.1.7
```

Restart the harness and refresh the UI; enable the plugin under **Settings → Plugins** if
needed.
