# dsh-doubt

[![CI](https://github.com/Yangxingyu789/dsh-doubt/actions/workflows/ci.yml/badge.svg)](https://github.com/Yangxingyu789/dsh-doubt/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen)](https://nodejs.org)
![Version](https://img.shields.io/badge/version-0.1.1-blue)

<img src="assets/icon.png" alt="dsh-doubt icon" width="96">

A completion guard for [DeepSeek Harness](https://github.com/deepseek-ai) (DSH) agents.
It checks the *real tool evidence* behind an answer before that answer is shown, so a
model cannot pass off an unverified claim as a completed task.

## What it does

- **Pre-execution gate** — dangerous live-host mutations (writes into `.dsh/profiles`
  or `.dsh/plugins`, process kills, service/registry changes, recursive deletes, system
  directories) are routed through the host approval seam; with no approval channel they
  are denied before the tool body runs.
- **Final-answer review** — before a final answer is displayed, a tool-less reviewer
  compares every actionable claim (commands, paths, versions, symbols, measured numbers)
  against the turn's actual tool calls and results. Rejected drafts are never shown;
  when review cannot complete the draft is released fail-open with an explicit status.
- **`verify_claims` tool** — runs submitted checks locally (command / file / HTTP /
  expression) and returns measured output, so claims can be grounded in real results.
- **Provenance for deliverables** — when a Markdown/TXT deliverable is written without
  inline source annotations, a step-by-step provenance table is requested.
- **Live-mutation guard** — an executed live mutation must disclose a backup location,
  an executable rollback command, and a post-action health check.

The review is an evidence check, not a correctness guarantee.

### Token usage and loop protection

Internal `doubt_review` receipts are hidden from the model's tool list while
remaining executable by the host. Stale model-authored receipt calls cannot spin
the agent indefinitely: other tools in a mixed response still run; a receipt-only
response stops with an explicit incomplete-verification notice. Normal automatic
evidence recovery remains available. Review-attempt logs include provider-reported
token counters when available; missing usage is unknown, not zero. See the
[token audit](docs/token-audit-2026-10-21.md) for scope and verification details.

## Requirements

- Node.js `^22.19` or `>=24`
- DSH desktop app or host bundle for the integration tests (`verify:host*`)
- Windows is the primary platform; Linux/macOS are supported for development and CI

## Install (development)

```bash
pnpm install
npm run build          # tsc -> lib/
npm test               # unit tests
npm run doctor         # check the installed DSH plugin, if present
```

To install into a live DSH profile, use the offline installer script; it builds,
backs up the current plugin, copies `lib/`, runs `pnpm install --offline`, and verifies
file hashes. See [scripts/install-local.mjs](scripts/install-local.mjs) for the Windows
offline flow.

## Configuration (excerpt)

All options live under the plugin's `config:` block (see [cordis.patch.yml](cordis.patch.yml)).

| Key | Default | Meaning |
|---|---|---|
| `guardPreExecute` | `true` | Ask/deny dangerous live mutations before the tool runs |
| `guardLiveMutation` | `true` | Require backup + rollback + health check for executed live mutations |
| `requireOperationEvidence` | `true` | Review the final answer against tool evidence |
| `reviewMaterialOnly` | `true` | Skip the reviewer when a draft has no actionable claims |
| `reviewNotice` | `off` | Trailing notice after an incomplete review: `banner` / `short` / `off` |
| `requireProvenance` | `true` | Require a provenance table for annotation-free deliverables |

## Development

```bash
npm run check          # tsc --noEmit
npm run build          # compile to lib/
npm test               # 12 unit test files
npm run smoke          # load the plugin in a bare Cordis app
npm run audit          # repository consistency checks
npm run verify         # full chain, including host tests
```

## Limits

- The gate and scanner are heuristics over commands and text; unusual quoting, variables
  or nested shells can be classified conservatively (deny/ask) or missed.
- The final review depends on a model provider call. When it cannot complete, the answer
  is released fail-open; logs record the failure but the default `reviewNotice: off`
  does not add a visible notice.
- Version 0.1.0 is the first public release; interfaces and config keys may change.

## License

MIT — see [LICENSE](LICENSE). Changelog: [CHANGELOG.md](CHANGELOG.md).
## 逐步骤溯源表（0.1.0 发布时快照；当前版本 0.1.1 见 CHANGELOG）

Checked before this section was written (local files, `git ls-remote`, command output). No external URL was fetched, so badge reachability is explicitly left unverified.

| # | Item | Claim | Evidence | Class |
|---|---|---|---|---|
| 1 | Version | 0.1.0 in both manifests and plugin source | `package.json:3`, `dsh-plugin.json:5`, `src/index.ts:13`; `npm run audit` → `版本一致：0.1.0` | sourced |
| 2 | Host load | Plugin loads as 0.1.0 | `node test/host.test.mjs` → `Loaded 0.1.0` | sourced |
| 3 | Release checks | 11 test files, smoke, audit 13 items, host-loop 4 modes pass | command output before commit `e9061bf` | sourced |
| 4 | Comment cleanup method | TS AST/scanner helpers used | TypeScript 5.9.3; `node_modules/typescript/lib/typescript.d.ts:8505` (`getLeadingCommentRanges`), `:8521` (`getTextPos`), `:8523` (`getTokenPos`) | sourced |
| 5 | Cleanup script | Not committed to the repository | `git ls-files scripts/strip-cn-comments.mjs` → 0; `Test-Path` → False | sourced (negative) |
| 6 | CJK comments | No Chinese comment lines remain in src/test/scripts | `Select-String '^\s*(//|\*|/\*).*CJK'` → 0 lines | sourced |
| 7 | Git refs | At check time remote main was `e9061bf` and tag `v0.1.0^{}` was `e9061bf` | `git ls-remote` output; the later docs commit `90e8dc4` advanced main | sourced |
| 8 | Live install | Installed plugin is still 0.8.4 (0.1.0 not installed) | `C:\Users\Example\.dsh\plugins\dsh-doubt\package.json` → `0.8.4` | sourced |
| 9 | Badge reachability | CI/License/Node/Version badges render on GitHub | No HTTP fetch was performed; shields.io and GitHub Actions badge URLs are conventional | unsourced (not verified) |
| 10 | Compatibility statement | "0.1.0 is the first public release; interfaces may change" | Planning statement, no measured artifact | unsourced |
## 逐步骤溯源表（仓库清理与文档修订，2026-10-21）

Checked before this section was written. Local-only paths are named only where the fact itself is about them. No HTTP fetch was performed.

| # | Item | Claim | Evidence | Class |
|---|---|---|---|---|
| 1 | Documentation files | README.md, README.zh-CN.md and CHANGELOG.md exist at the repository root | `Test-Path` → True; `git ls-files` lists all three | sourced |
| 2 | package.json fields | `main` is `lib/index.js`; `files` includes `assets/icon*.png` | `package.json` read; `main=lib/index.js`; `assets/` contains 4 files | sourced |
| 3 | Local exclude file | `.git/info/exclude` contains a local-only ignore entry for the internal handoff document | file exists; `Select-String` → 1 match | sourced (local file) |
| 4 | Internal doc removed from tree | The internal handoff document is no longer in the HEAD tree | `git ls-tree -r HEAD --name-only` filtered for it → 0 | sourced |
| 5 | Local copy retained | The handoff document still exists in the working directory for local use | `Test-Path` → True | sourced |
| 6 | Local plugin path | `C:\Users\Example\.dsh\plugins\dsh-doubt` exists (path used in the 0.1.0 table) | `Test-Path` → True | sourced |
| 7 | History purge | Removing the file from past commits needs `git filter-repo` / `filter-branch` plus a force push | Not installed and not run; recommendation based on Git behavior, no command output | unsourced |
| 8 | Push state | Local commit `151ba29` exists; its remote push succeeded | Local: `git rev-parse` → `151ba29`; remote: last `git ls-remote` failed with a connection error, so the remote ref is unverified | mixed: local sourced, remote unsourced (unverified) |
