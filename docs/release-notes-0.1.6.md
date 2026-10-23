# dsh-doubt 0.1.6

Documentation and repository-security audit release. No runtime behavior changes from
0.1.5.

## Fixes and additions

- Corrected the release checklist command from `npm run pack` to `npm pack`.
- Corrected the documented default `liveMutationPaths` list to match
  `src/config.ts` (`.dsh/profiles`, `.dsh/plugins`, `program files`, `programdata`,
  `c:/windows`).
- Enabled GitHub private vulnerability reporting, secret scanning, secret scanning push
  protection, vulnerability alerts and Dependabot security updates.
- Kept Dependabot version-update automation, but deferred the initial batch of
  automated PRs so the 0.1.x release line stays pinned.
- Install URLs and release assets point at `v0.1.6`.

## Validation

- `npm run check`, `npm run build`, 12 test suites, smoke, audit and the full local verify
  chain pass.
- All local Markdown links resolve.
- The release tarball includes `package/lib/index.js`, `docs/zh/`, the architecture
  assets and the community files.
- `dsh plugin --profile <test> add github:Yangxingyu789/dsh-doubt#v0.1.6` is the supported
  install command.

## Install

```bash
dsh plugin --profile web add github:Yangxingyu789/dsh-doubt#v0.1.6
```

Restart the harness and refresh the UI; enable the plugin under **Settings → Plugins** if
needed.
