# Contributing

Thanks for helping improve `dsh-doubt`.

## Development setup

Requirements: Node.js `^22.19` or `>=24`, pnpm 10.

```bash
pnpm install
npm run check
npm run build
npm test
npm run smoke
npm run audit
```

With an installed DSH app available, run the host-level checks too:

```bash
# PowerShell
$env:DSH_APP_DIR = "C:\path\to\dsh"
npm run verify
```

`npm run verify` includes host integration. Without `DSH_APP_DIR`, host tests are
skipped; that is expected on CI because hosted runners do not have a DSH installation.

## Pull requests

- Keep changes focused; explain the failure mode or user problem being fixed.
- Add or update a test for behavior changes. Tests must pass on Windows and Linux, so do
  not depend on a specific drive letter, home directory, shell prompt or locale.
- Do not include personal paths, real session logs, credentials or customer data.
- Update `README.md` / `README.zh-CN.md` and `CHANGELOG.md` for user-visible changes.
- Do not change the plugin's public config keys without calling it out in the PR.
- Run `npm run check && npm run build && npm test && npm run smoke && npm run audit`
  before opening the PR.

## Versioning

The public release series is `0.1.x`. Pre-public `0.7.x` / `0.8.x` tags are not release
targets. Releases are tagged `vX.Y.Z` and published with the packaged plugin tarball and
source archive.

## Security reports

Do not open a public issue for a vulnerability. Follow [SECURITY.md](SECURITY.md).

## Code of conduct

Participation is covered by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
