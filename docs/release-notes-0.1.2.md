# dsh-doubt 0.1.2

Release-engineering release. No runtime behavior changes from 0.1.1.

## Highlights

- Added release metadata (`repository`, `homepage`, `bugs`) and tag-pinned install URLs.
- Added public installation, quick-start, versioning-history and security sections to the
  READMEs.
- Moved internal verification snapshots to [provenance.md](provenance.md).
- Added `SECURITY.md`, `CONTRIBUTING.md`, code of conduct, issue templates and a pull
  request template.
- Added a tag-triggered release workflow that runs static checks and unit tests, builds the
  plugin tarball and source zip, and publishes both assets.
- Fixed CI-only test fixtures that assumed a particular Windows drive letter. The latest
  static and test jobs pass on Windows and Ubuntu with Node 22 and 24.

## Validation

- `npm run check`, `npm run build`, 12 test suites, smoke and audit pass locally.
- The cross-platform CI matrix passes on the latest `main` commit.
- Host-level and online checks remain documented in [provenance.md](provenance.md).

## Install

Download `dsh-doubt-0.1.2-source.zip`, unpack it, then run:

```powershell
pnpm install
node .\scripts\install-local.mjs --profile desktop
cd "$env:USERPROFILE\.dsh\profiles\desktop"
pnpm install --offline
```

Restart DSH afterward.
