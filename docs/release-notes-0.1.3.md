# dsh-doubt 0.1.3

Follow-up release-hygiene release. No runtime behavior changes from 0.1.2.

## Highlights

- The Windows upgrade launcher and offline upgrade scripts no longer hardcode the
  developer's `C:\work\dsh-doubt` repository path or a specific DSH installation path. They
  derive the repository from the script location and discover the app from
  `DSH_APP_DIR` / standard install locations; `-App` can override it.
- Sanitized example paths in tests and historical documentation; added the release badge
  to the READMEs.
- Release assets and tag-pinned install URLs now point at `v0.1.3`.
- No changes to the review policy, gate rules, default configuration or plugin runtime.

## Validation

- `npm run check`, `npm run build`, 12 test suites, smoke and audit pass.
- CI static and test jobs pass on Windows and Ubuntu with Node 22 and 24.
- The tag-triggered release workflow runs the same checks, packages the plugin tarball,
  produces a source zip and publishes both assets.

## Install

Download `dsh-doubt-0.1.3-source.zip`, unpack it, then run:

```powershell
pnpm install
node .\scripts\install-local.mjs --profile desktop
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm install --offline
```

Restart DSH afterward.
