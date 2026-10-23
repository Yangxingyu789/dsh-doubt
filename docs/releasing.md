# Releasing

The repository publishes a GitHub Release from an annotated `vX.Y.Z` tag. The release
workflow runs the same checks as CI, builds the plugin tarball and source zip, and attaches
both assets.

## 1. Prepare the version

Update every place that carries the version:

- `package.json` (`version`, `dsh.install` URLs)
- `dsh-plugin.json`
- `src/index.ts`
- `test/host.test.mjs`
- `README.md` / `README.zh-CN.md` (badges, tag-pinned commands)
- `CHANGELOG.md`
- `docs/release-notes-<version>.md`
- `docs/provenance.md` (add the release row)

Build before committing so the tracked `lib/` output matches the source:

```bash
npm run check
npm run build
npm test
npm run smoke
npm run audit
```

`lib/` is committed intentionally: DSH's `dsh plugin add github:...` installs the
repository as-is and does not run a build step.

## 2. Verify

```bash
npm run verify                 # local, with DSH_APP_DIR when available
npm pack --dry-run              # inspect package contents
```

Wait for the CI matrix on `main` to pass.

## 3. Tag and publish

```bash
git add -A
git commit -m "release: X.Y.Z"
git push origin main
git tag -a vX.Y.Z -m "dsh-doubt X.Y.Z"
git push origin vX.Y.Z
```

The `Release` workflow runs:

1. Windows verification (`npm run check/build/test/smoke/audit`).
2. Ubuntu packaging (`npm pack`, source zip).
3. `gh release create` with `docs/release-notes-X.Y.Z.md`.

## 4. Verify the release

- Release is not draft/prerelease; assets exist and download.
- The tarball contains `package/lib/index.js` and reports the expected version.
- `dsh plugin --profile <test> add github:<owner>/<repo>#vX.Y.Z` installs in a disposable
  profile.
- Public repository page, topics and community files remain correct.

## Rollback

Release tags are immutable once published. To correct a bad release, publish a new patch
version instead of moving the tag. If a build is broken before announcement, delete the
remote tag/release only after confirming no consumer installed it, then re-tag.
