# dsh-doubt

[![CI](https://github.com/Yangxingyu789/dsh-doubt/actions/workflows/ci.yml/badge.svg)](https://github.com/Yangxingyu789/dsh-doubt/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen)](https://nodejs.org)
![Version](https://img.shields.io/badge/version-0.1.0-blue)

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
file hashes. See [scripts/install-local.mjs](scripts/install-local.mjs) and
[交接文档.md](交接文档.md) for the Windows offline flow.

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
npm test               # 11 unit test files
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
