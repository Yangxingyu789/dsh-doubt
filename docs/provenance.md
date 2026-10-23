# Verification provenance

This page records what was checked for the public `0.1.x` releases, with the command or
artifact used. It is a historical snapshot, not a live guarantee.

## 0.1.3 (release engineering follow-up)

| Check | Result | Evidence |
|---|---|---|
| Type check / build | pass | `npm run check`, `npm run build` |
| Unit tests | 12 suites pass | `npm test` |
| Smoke | pass | `npm run smoke` |
| Repository audit | 13 checks, version consistent | `npm run audit` |
| Real host integration | pass with host runtime (PTC boundary included) | `npm run verify:host` with `DSH_APP_DIR` set |
| Agent-loop integration | 5 scenarios pass | `npm run verify:host-loop` with `DSH_APP_DIR` set |
| Independent checks | 6 PASS, 0 FAIL, 0 SKIP | `npm run verify:independent` |
| Cross-platform CI | static (Windows/Ubuntu, Node 22/24) and tests (Windows, Node 22/24) pass | GitHub Actions |
| Online reviewer | 23/23 synthetic cases matched expected decisions | `node eval/review-live.mjs --model deepseek-flash` on a signed-in host |
| Online agent behavior | tool hiding, read-then-answer, false-claim correction, refuse-to-fabricate | headless DSH profile with a signed-in account |

The live model checks used the real provider account and synthetic or read-only tasks.
They are evidence for the tested behavior; they are not a long-run accuracy or billing
guarantee.

## 0.1.1 (token-loop and gate hardening)

| Check | Result | Evidence |
|---|---|---|
| Token-loop regression | pure invented receipts stop; mixed responses keep real tools | `test/token-budget.test.mjs`, host-loop `--receipt-misuse` |
| Pre-execution gate bypasses | fixed for `cmd /c`, encoded PowerShell, archive/`tar`/`robocopy`, `git`, ACL tools, JS `fs` writes and related wrappers | `test/guard.test.mjs` adversarial group |
| Full local chain | pass | `npm run verify` with `DSH_APP_DIR` |
| Historical session audit | 3,796 `doubt_review` calls in one project session; 112 legitimate, 3,683 `invalid` | local session log decode; details in [token audit](token-audit-2026-10-21.md) |

The historical audit numbers are from recorded sessions, not from a controlled rerun of
the old build. The old-vs-new retry comparison in the audit document is a controlled
fixture comparison, not a billing measurement.

## 0.1.0 (first public release)

- Version consistency: `package.json`, `dsh-plugin.json` and plugin source all reported
  `0.1.0`; audit reported `版本一致：0.1.0`.
- Host load: `node test/host.test.mjs` reported `Loaded 0.1.0`.
- Release checks at that time: 11 unit test files, smoke, audit 13 items, host-loop
  four modes.
- Known boundary: the installed marketplace copy was older than the repository build;
  repository tests do not imply a live install was upgraded.

## How to reproduce

```bash
npm run check
npm run build
npm test
npm run smoke
npm run audit
# With a DSH app checkout available:
DSH_APP_DIR=<app-dir> npm run verify
```

`npm run verify` includes host integration when `DSH_APP_DIR` points at an installed DSH
app. Without it, host tests are skipped; CI cannot run them because the hosted runner has
no DSH installation.
