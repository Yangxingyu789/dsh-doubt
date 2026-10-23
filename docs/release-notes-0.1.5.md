# dsh-doubt 0.1.5

Documentation and presentation release. No runtime behavior changes from 0.1.4.

## Highlights

- Added a Chinese documentation set: index, architecture, configuration reference,
  compatibility, releasing and FAQ under [`docs/zh`](zh/README.md).
- Added an English FAQ and linked both documentation indexes from the READMEs.
- Expanded the README badge row: CI, latest release, license, Node, tested DSH runtime,
  platform, `dsh-plugin` topic, 12 test suites and current version.
- Enlarged and centered the project icon in both READMEs.
- Added Issue template configuration and Dependabot configuration for maintenance.
- Install URLs and release assets point at `v0.1.5`.

## Validation

- `npm run check`, `npm run build`, 12 test suites, smoke, audit and the full local verify
  chain pass.
- CI static and test jobs pass on Windows and Ubuntu with Node 22 and 24.
- The release tarball includes `package/lib/index.js`; the source zip includes the built
  `lib/` and the Chinese docs.
- `dsh plugin --profile <test> add github:Yangxingyu789/dsh-doubt#v0.1.5` is the supported
  install command.

## Install

```bash
dsh plugin --profile web add github:Yangxingyu789/dsh-doubt#v0.1.5
```

Restart the harness and refresh the UI; the plugin is managed under **Settings → Plugins**.
