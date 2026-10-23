# dsh-doubt 0.1.4

Installability and documentation release. No runtime behavior changes from 0.1.3.

## Highlights

- **The built `lib/` directory is now committed.** The official DSH plugin installer,
  `dsh plugin add github:...`, installs the repository as-is and does not run a build;
  previously a GitHub/tag install would have had no loadable `lib/index.js`.
- README adds the official plugin-manager install command (tag-pinned), the tested DSH
  runtime version, and an architecture diagram.
- New documentation: [architecture](architecture.md), [configuration](configuration.md),
  [compatibility](compatibility.md), [releasing](releasing.md) and a
  [documentation index](README.md).
- GitHub topic `dsh-plugin` added so the repository is discoverable through the DSH
  plugin ecosystem.
- Install URLs and release assets point at `v0.1.4`.

## Validation

- `npm run check`, `npm run build`, 12 test suites, smoke, audit and the full local verify
  chain pass.
- CI static and test jobs pass on Windows and Ubuntu with Node 22 and 24.
- The release tarball is built from this tag and includes `package/lib/index.js`; the
  source zip includes the checked-in `lib/`.

## Install

```bash
dsh plugin --profile web add github:Yangxingyu789/dsh-doubt#v0.1.4
```

Restart the harness and refresh the UI; the plugin is managed under **Settings → Plugins**.
Windows desktop offline installer and source install steps are in the main README.
