# dsh-doubt

<img src="assets/icon.png" alt="dsh-doubt icon" width="128">

**Tiered evidence gathering instead of asking "are you sure?".**

A model's first answer is often sloppy: the command was never run, the path was never confirmed, the version came from memory, the API signature was invented. So you ask "are you sure?" several times — and every time it actually checks, it finds a problem.

`dsh-doubt` buffers final text for independent review against human requests and actual tool evidence. Missing evidence sends the agent back through its normal tool loop; unavailable verification produces an explicit incomplete status. Existing post-turn checks and document provenance remain available.

[中文](README.zh-CN.md) | English

---

## Why not just "ask again"

This is the key v0.1 → v0.2 change, and it comes from measured results, not intuition:

| Approach | Measured result | Source |
|---|---|---|
| Intrinsic self-correction (re-read, no external feedback) | GPT-4 GSM8K **95.5 → 89.0**; Llama-2 **62.0 → 36.5**; CommonSenseQA 75.8 → 38.1 | [Large Language Models Cannot Self-Correct Reasoning Yet, ICLR 2024](https://arxiv.org/abs/2310.01798) |
| Mechanism | 74.7% keep the original answer; among changes, **correct→wrong beats wrong→correct** | same paper §3.3 |
| Correction **with** external feedback | consistent gains; authors recommend tools as verifiers | [CRITIC, ICLR 2024](https://arxiv.org/abs/2305.11738) |
| Verification questions answered **independently** (draft hidden) | hallucinations drop; seeing the draft copies the same hallucination | [Chain-of-Verification](https://arxiv.org/abs/2309.11495) |
| Yes/no verification questions | models tend to **agree regardless of correctness** | same paper |
| Independent re-derivation + majority vote | 76.7 → 82.5 → 85.3 → 88.2 as samples grow; beats multi-agent debate at equal cost | [2310.01798 §4](https://arxiv.org/abs/2310.01798) |

These are historical Tier C design references, not evidence of this version's effectiveness. Current independent review also compares drafts with tool evidence and requires empirical evaluation.

---

## The tiers

```
                     ┌──────────────────────────────────────────────┐
   answer ──────────►│ risk scanner (pure, 9 detectors)             │
                     │ command / path / version / symbol / package  │
                     │ number / code / absolute / reversal          │
                     └──────────────────┬───────────────────────────┘
                                        │ claims → mechanically executable checks
                                        ▼
        ┌───────────────────────────────────────────────────────────┐
        │ Tier A deterministic local oracles (works offline)        │
        │   PATH/PATHEXT lookup · installed version in node_modules │
        │   package.json ranges · lockfiles · definition-site lookup│
        ├───────────────────────────────────────────────────────────┤
        │ Tier B multi-source cross-check (when online)             │
        │   confirmed needs ≥requireSources independent agreements  │
        ├───────────────────────────────────────────────────────────┤
        │ Tier C independent re-derivation + majority vote          │
        │   claim → self-contained question → fresh subagent, N     │
        │   times, draft not in context → majority; a split is      │
        │   reported as a split, never forced into a verdict        │
        └───────────────────────────┬───────────────────────────────┘
                                    ▼
                     ┌──────────────────────────────────────────────┐
                     │ injected: measured evidence + verdict        │
                     │ refuted / conflicting / unverifiable /       │
                     │ confirmed — each line carries its source     │
                     └──────────────────────────────────────────────┘
```

Four verdicts, **no "probably fine"**:

- `confirmed` — source-count requirement met
- `refuted` — a source contradicts and none support
- `inconclusive` — sources conflict / too few agreeing online / only weak evidence
- `unverifiable` — no judge exists locally or online; must be labelled, never guessed

**Weak-evidence model**: an identifier that appears only at call sites, never at a definition site, is *neutral* — it neither confirms nor refutes. This was forced by measurement: an earlier version treated "the assertion's own text in a test file" as evidence (self-referential false positive).

---

## Install

```bash
dsh plugin --profile desktop add dsh-doubt
```

Offline:

```bash
git clone https://github.com/Yangxingyu789/dsh-doubt.git
cd dsh-doubt
pnpm install --offline
node scripts/install-local.mjs --dry
node scripts/install-local.mjs
cd "$DSH_HOME/profiles/desktop" && pnpm install --offline
# restart the DSH host
```

---

## Upgrading (offline)

Since 0.7.0 the pre-execution guard denies live installation or writes into `.dsh/profiles/**` / `.dsh/plugins/**` while the host is running (see "Pre-execution guard"). Upgrades therefore run with DSH fully closed:

1. Double-click `dsh-doubt-upgrade.cmd` (repository copy: `scripts\dsh-doubt-upgrade.cmd`; it calls `scripts/run-upgrade.ps1`). If DSH is still running, the window waits up to 15 minutes.
2. Fully quit `DeepSeek Harness` (tray icon → Exit, or Task Manager: end every "DeepSeek Harness" process). The launcher detects the exit and continues automatically.
3. The launcher builds with `tsc`, backs up the current install to `_diag\offline-upgrade-backup-<timestamp>`, copies the new `lib/`, runs `pnpm install --offline` in the profile, compares every `lib` file by SHA-256, and starts DSH.
4. Re-run the health check: `npm run doctor` (expect every check PASS: `installed-version`, `lib-identical` 48 files / 0 differing, `preflight-module`).

Expected live behaviour after the upgrade (verified by the assistant once you reply "已启动"):
- recursive delete of a literal temp directory is **allowed** (0.8.0 rule);
- writing into `.dsh/plugins/**` is **denied** by the pre-execute guard;
- copying a live file out to temp is **allowed** (0.8.1 write-direction rule);
- installing while DSH runs stays denied by design.

Read-only self-check without quitting DSH:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\upgrade-offline.ps1 -DryRun
```

It prints the target version and resolved tool paths and writes nothing.

Rollback: restore `_diag\offline-upgrade-backup-<timestamp>\plugins-dsh-doubt\*` into `%USERPROFILE%\.dsh\plugins\dsh-doubt\`, restore `profile-files\package.json` and `pnpm-lock.yaml` into the profile directory, run `pnpm install --offline` there, and restart DSH. The upgrader prints these commands after every run.

Honest limits: every `lib` file is compared by SHA-256, but the version the running host actually loaded is **inferred** from the process start time and observed behaviour — the host has no load log. Do not hot-install into a running host; the guard denies it by design.

---

## Configuration

Override in your profile's `cordis.patch.yml` (later layers win):

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch |
| `verifyTool` | `true` | Register `verify_claims` |
| `promptSection` | `true` | Inject the tiered-verification rules and hard bans |
| `autoVerify` | `true` | Enable final review and post-turn Tier A/B/C |
| `requireSources` | `2` | Independent agreeing sources needed when online |
| `probeUrls` | 2 registries + arXiv | Connectivity probes |
| `registryUrls` | npmmirror, npmjs | Tier B cross-check sources |
| `onlineTimeoutMs` | `8000` | Online request timeout |
| `factored` | `true` | Enable Tier C |
| `factoredVotes` | `3` | Independent re-derivation samples |
| `factoredProvider` | `spawn` | Subagent provider name (verified: `dsh-subagent-spawn-in-process` registers under its own `config.providerName`, default `spawn`; that provider's children have zero parent context). Auto-degrades with an honest report when unavailable |
| `executeAnswerCommands` | `false` | **Do not execute commands from the answer by default** — only check that the program exists |
| `strictLabeling` | `true` | Unverifiable assertions must be labelled in the final answer |
| `requireProvenance` | `true` | When a delivered document (`.md`/`.txt`) is written with no provenance section, ask for a step-by-step provenance table (see "Provenance gate"). Once per document; own budget of 4 per human turn, independent of `maxRounds` |
| `requireOperationEvidence` | `true` | Independently review full final text and evidence before display, without keyword/length thresholds |
| `operationMaxRounds` | `3` | Recovery budget per host turn (0–5); 0 reviews but does not retry. Raised from 2 after a measured long answer needed a third draft before the reviewer could approve |
| `reviewTimeoutMs` | `120000` | Per-attempt review deadline (two attempts max); a timeout never releases the unreviewed draft, but it now retries once without optional history |
| `reviewMaxChars` | `120000` | Review request bound in chars (≈ tokens for Chinese). Raised from 48000 so more historical evidence fits into the packet (history is capped at a third of the budget); reviewer thinking is off, so the budget goes to the verdict. Cost: slower/larger review calls |
| `segmentedReview` | `true` | Review long drafts part by part when the full packet does not fit (see "Operation evidence gate"); `false` restores the single-packet path |
| `reviewReasoningEffort` | `off` | Reasoning effort for the reviewer call. The host DeepSeek adapter defaults to `high` + thinking when omitted, and thinking shares `max_tokens`; measured attempt 1 spent all 12000 output tokens on thinking with 0 visible text → `max-tokens`. `off` keeps the budget for the JSON verdict; `default` restores the old host default |
| `guardLiveMutation` | `true` | Deterministic live-mutation gate before review (see "Live-mutation gate"); `false` restores the previous behaviour exactly |
| `guardPreExecute` | `true` | Pre-execution gate on the host's `tools/pre-execute` waterfall: dangerous live mutations require host approval before the tool runs (`ask`), and are denied when no approval channel exists or the policy is `never` (see "Pre-execution guard"); `false` restores post-hoc disclosure only |
| `reviewNotice` | `short` | Tail notice when final-answer review did not complete: `banner` = full notice + issues, `short` = one line, `off` = no notice (review result is still logged internally) |
| `reviewMaterialOnly` | `true` | Skip the reviewer LLM call when the draft has no actionable claims (no version/path/command/number/identifier/state assertion); `false` forces review on every answer |
| `liveMutationPaths` | `.dsh/profiles`, `.dsh/plugins`, `program files`, `programdata`, `c:/windows` | Protected path fragments for `guardLiveMutation` / `guardPreExecute` (case- and slash-insensitive) |
| `workspace` | `process.cwd()` | Where local oracles start looking |
| `maxRounds` | `2` | Injection budget (reset by a new human message) |
| `minScore` | `6` | Trigger threshold |
| `maxFindings` | `8` | Max assertions listed |
| `minAnswerChars` | `240` | Claim-level length threshold; does not exempt operation evidence |
| `detectors` | `{}` | Per-detector on/off |
| `verificationTools` | compatibility only | Deprecated; not used for approval or exemption |
| `denyBinaries` | `rm/del/format/…` | Refused binaries |
| `timeoutMs` | `15000` | Per-check timeout |
| `language` | `auto` | Injected text language |

---

## Detectors

| kind | weight | catches | Tier A judgement |
|---|---|---|---|
| `command` | 2 | command lines in shell blocks | is the program on PATH (not executed by default) |
| `path` | 1 | `C:\…` / `/a/b/c` | `existsSync` |
| `version` | 2 | `v1.2.3`, `^4.0.4` | installed version + package.json range + lockfile |
| `symbol` | 2 | `` `foo.bar()` `` | **definition-site** lookup in deps/sources |
| `package` | 2 | package names in backticks | node_modules + registry |
| `number` | 1 | `30 s`, `12 MB` | no mechanical judge → `unverifiable` |
| `code` | 2 | non-shell code blocks | same |
| `absolute` | 2 | "definitely", "guaranteed" | same (constrained by the prompt section) |
| `reversal` | 3 | "sorry, I was wrong earlier" | re-verify the refuted conclusion |

Score = sum of weights, **capped at 3 hits per kind**.

---

## `verify_claims`

Besides generic checks, it exposes the four local oracles directly:

```json
{
  "checks": [
    { "kind": "command", "claim": "pnpm install --offline works",
      "argv": ["pnpm", "install", "--offline"], "expectMatch": "downloaded 0" },
    { "kind": "packageVersion", "name": "typescript" },
    { "kind": "versionClaim", "claim": "typescript 9.9.9", "name": "typescript" },
    { "kind": "symbolExists", "claim": "normalizeConfig(raw)" }
  ]
}
```

Measured reply, with provenance:

```json
{
  "results": [
    { "ok": false, "kind": "versionClaim", "claim": "typescript 9.9.9",
      "detail": "✗ [node_modules/typescript] actual 5.9.3, claimed 9.9.9\n✗ [E:\\dsh-doubt\\package.json] declared range ^5, claimed 9.9.9" }
  ]
}
```

(That block is real output from this machine, not an illustration.)

---

## Operation evidence gate

Previously a tool name exempted the entire turn, and short/low-score/unjudgeable answers were silent. Document provenance ran before those exemptions.

The gate now buffers final text at `llm/stream` and sends human requests, the draft, and current-turn tool arguments/results/chronology to a fresh tool-less reviewer using the same provider/model. Author instructions and reasoning are not inherited.

1. Review target, relevance, contradictions, post-action state and the user's acceptance criteria. README content, False, or a write receipt cannot establish a repair. User-facing tool-ID citations are not required.
2. Approval must partition the entire draft and quote actual call results. Code validates coverage, grounding and post-action timing; semantic relevance still depends on the model.
3. Rejection substitutes a `doubt_review` receipt. The host continues the same turn for actual checks within the original authorization. Honest incomplete answers are allowed; reviewer suggestions are themselves unverified.
4. Reviewer errors, timeouts, invalid JSON/contracts and oversized material are review-service failures, not evidence gaps or task failures. They expose a safe error code plus the validator's reason, never inject an author retry, and suppress legacy post-turn checks. A malformed JSON reply or a contract violation (`INVALID_REVIEW`) is retried once with the validator's exact complaint, because a formatting mistake is not a verdict on the user's task.
5. **The review never destroys the answer.** A rejection inside the retry budget still returns a `doubt_review` receipt and continues the loop, but the terminal fallback — retry budget exhausted, reviewer service failure, or an unsupported replay protocol — **releases the draft with an explicit trailing banner** ("以上草稿未经完整审核" + the unreviewed issues or the failure code/reason). Earlier versions withheld the draft, which in practice swallowed otherwise useful answers.
6. The reviewer covers numbered draft parts instead of copying the whole answer, and parts are grouped into ~400-character units (one part per source line made long answers emit one JSON segment per line). Token truncation triggers one internal retry with a larger output budget (12000 to 24000 tokens) that also drops optional history, with a separate configured deadline per attempt and no user-tool execution. A mixed `partIds`/`text` representation is accepted when the concatenated text still covers the draft; numeric-string and comma-joined `partIds` are accepted too.
7. The whole packet is budgeted against `reviewMaxChars`, current-turn tool records included. Records stay whole while they fit; oversized ones are clipped with an explicit truncation marker plus `truncated`/`truncatedCalls`, so a busy turn can no longer be withheld as `INPUT_LIMIT`. Optional history is capped at a quarter of the budget, so ordinary requests stay well below the ceiling instead of being padded to it; if a review still times out, it is retried once without that history.

**Segmented review (`segmentedReview`, default `true`):** when the draft plus current-turn evidence does not fit `reviewMaxChars`, the draft is split into at most six parts and each part is reviewed in its own packet, which leaves more room for evidence per part. A part that gets a `verify` reply returns immediately. If a part's review service fails, only the parts that were not reviewed are disclosed ("只有部分段落完成审核…") instead of failing the whole turn; a draft that fits in one packet still takes the original path. `segmentedReview: false` restores the old single-packet path, which can exceed the budget and fail closed as `INPUT_LIMIT`. Covered by controlled-reviewer tests (`test/segments.test.mjs`, `test/review-draft.test.mjs`); the real long-task effect is not yet measured.

**Reviewer reasoning budget (`reviewReasoningEffort`, default `off`):** the reviewer call inherits no reasoning control, and the host's DeepSeek adapter then defaults to effort `high` with thinking enabled (`dsh-llm-deepseek`: `options.reasoningEffort ?? connection.defaults.reasoningEffort ?? "high"`), while thinking tokens share `max_tokens`. Replaying the recorded turn-4 packet (52,672 chars, 7 parts) through the real host `LlmRuntime` reproduced the failure: attempt 1 (12,000 tokens) emitted **0 visible characters** and finished `max-tokens`; with effort `off` the same packet returned a verdict in 2.9 s / 325 output tokens. The plugin now sends `reasoningEffort` explicitly (default `off`), falls back to omitting the field when a provider rejects it, and keeps the setting on the 24,000-token retry. `default` restores the previous host default. Covered by `test/review-effort.test.mjs`; the live desktop effect needs a reinstall + restart.

**Review materiality and budget (0.6.3):** evidence is required only for claims the user could act on (commands actually run, paths, versions, identifiers, measured results, completion/postcondition claims, current environment state). Narrative, background, design rationale and summaries do not need a per-sentence quote, and the reviewer must not reject an answer merely because explanatory prose lacks one. `reviewMaxChars` was raised to 120000 so more historical evidence reaches the packet, and the reviewer's issue list is capped at three concrete, fixable gaps. This targets the remaining failure mode measured on a long answer: three consecutive `verify` rejections (each exactly three issues) exhausted the receipt budget and the draft was released with the "自动补查预算已用尽" banner. Covered by `test/operations.test.mjs` assertions on the instruction; real long-answer effect still to be measured after install.

**Cost and limits:** each final answer adds a model call and latency, including short answers; truncation can add one more call. Review usage is not currently added to the original answer's token statistics. Intermediate tool-call text is withheld while tools continue through normal host execution/approval; final text is reviewed. Files already written use the separate document provenance rules. DeepSeek reasoning/signatures are retained for protocol continuation, not approved as final text. PTC-only sessions without the receipt tool and unsupported reasoning replay protocols cannot recover automatically. Evidence is textual and current-turn only, not image inspection or historical task-state management. Reviewer outages still withhold final drafts, but do not ask the author to repeat operations. Review can miss errors and reject valid answers; this is not a hallucination guarantee.

Implementation: [src/completion.ts](src/completion.ts), [src/operations.ts](src/operations.ts). Offline contracts: `test/operations.test.mjs`. Real host services/loop with scripted models: `test/host.test.mjs`, `test/host-loop.test.mjs`. Separate live synthetic-evidence evaluation: `eval/review-live.mjs`; transport failure is ERROR, not successful rejection.

Local 0.5.1 validation on 2026-10-17: 23 synthetic cases across three runs through real LlmRuntime and deepseek-flash matched expected verdicts (14 rejections, 9 approvals). The same long answer reproduced the old 0.5.0 generic failure with a `max-tokens` finish and passed on the new version. Actual AgentLoop UI frames withheld the premature tool-stage claim, and a reviewer SERVER failure caused no author retry. This is not a production error-rate estimate or proof that the pictured Windows issues were repaired. Update installed copies and restart DSH to load changes; repository tests alone do not establish desktop activation.

A real AgentLoop fault-injection trial also confirmed that a live reviewer rejected an injected premature success draft, after which a live author independently read the temporary configuration and produced an approved answer without a second human message. The initial failure is injected; no real application is modified. Reproduce with `test/host-loop.test.mjs --app <app-dir> --live --account-home <DSH_HOME> --model deepseek-flash`.

---

## Live-mutation gate

On 2026-10-17, a modified plugin was installed into the live DSH profile while the host was running; every host tool then failed with `cannot get required service "sessionProjections" in inactive context`, and only a restart recovered. The hot-reload root cause is **inferred, not proven** (no host log). `guardLiveMutation` (default `true`) turns that incident into a structural check: a deterministic gate in front of the reviewer, not a reminder in the prompt.

The gate scans the current turn's tool trace with pure functions and recognizes these live-environment mutations (protected path fragments come from `liveMutationPaths`; matching is case- and slash-insensitive):

- writing or editing files under `.dsh/profiles/**` or `.dsh/plugins/**`;
- `pnpm`/`npm`/`yarn`/`corepack` `install`/`add`/`ci`/`rebuild` where the command or working directory hits a live path;
- running the repository install script `node scripts/install-local.mjs` (it writes `.dsh/plugins`);
- killing processes, stopping services, `shutdown`, restarting the computer;
- registry / service / autostart changes (`reg add`, `New-ItemProperty` under HKLM/HKCU, `schtasks /create`);
- recursive deletes (`Remove-Item -Recurse`, `rm -rf`, `del /s`, …) — since 0.8.0 the target is parsed first: temp roots (`%TEMP%`, `$env:TEMP`, `/tmp/`, `/var/tmp/`) and recursive deletes under a supplied non-live working directory (e.g. `rm -rf node_modules`) are normal cleanup and are not gated; live paths, system directories, drive roots and commands whose target cannot be determined stay gated;
- writes to system directories (the default protected fragments include `Program Files`, `ProgramData`, `C:/Windows`).

If one is found, the draft cannot be released as a completed task until the author supplies all three artifacts. Missing any one produces a deterministic `verify` rejection **before any reviewer model call**; it is not a review-service failure and it does not trigger the "unreviewed" banner. The rejection lists exactly what is missing and arrives as a `doubt_review` receipt:

1. **Rollback path** — the backup location **and** a rollback command the user can actually run.
2. **User confirmation point** — an approval event or the user's explicit authorization *before* the mutation. The model deciding on its own is not confirmation, and a sentence in the draft claiming the user confirmed does not count.
3. **Independent post-action health check** — a separate tool call *after* the mutation that really completes and shows the host and tools still work. The install receipt, or the mutation's own success output, is not a health check. If that check fails, stop the task chain and give the rollback steps; do not keep working.

With all three present the normal review still runs, and the reviewer also checks completion claims against evidence timing. The injected prompt section and the reviewer instruction carry the same rules, so the author is told before acting and the reviewer enforces them after. `guardLiveMutation: false` restores the previous behaviour exactly; `liveMutationPaths` replaces the protected path fragments (defaults in the configuration table).

**Coverage and honesty:** the detector, the rejection path and the incident timeline are covered by unit and controlled-reviewer tests in `test/guard.test.mjs`. Real long tasks and real host sessions have **not** been verified: the inferred hot-reload mechanism has no host log, and the gate has not been observed in a live DSH session.

---

## Pre-execution guard

`guardLiveMutation` can only scan tool calls that already happened: it discloses a dangerous mutation in the final answer, after the damage. `guardPreExecute` (default `true`) moves the same rule set to the host's `tools/pre-execute` waterfall, which `@deepseek-ai/dsh-tools` runs before a tool body executes (`prepareExecution` → `guardReason` → `Error: <reason>`; a `{kind:'ask'}` decision is routed through the host's ApprovalService). Consequences:

- a dangerous live mutation (live `.dsh` writes, live `pnpm install`, install script, recursive delete, process/service/registry changes) returns `ask`, so the host shows a permission prompt even when the session policy would otherwise auto-approve;
- with no approval channel or an explicit `never` policy, the gate returns `deny` and the tool body never runs;
- ordinary repository edits and read-only commands are untouched; the pre-execute decision never overrides another guard's deny/ask.

Honest limits: the gate only recognizes the patterns in `liveMutationPaths` + the command rules; it cannot judge whether an operation is *backed by evidence*, only whether it is a live-host mutation. The final-answer review remains the layer for unsupported claims. Verified in `test/host.test.mjs` against the real `ToolRuntime` (dangerous call denied before its body runs; ordinary `node --version` allowed) and in `test/guard.test.mjs` for ask/deny/allow and the `never`/no-seam paths.

`reviewNotice` (default `short`) controls the trailing text when final-answer review does not complete: `banner` keeps the full notice with the reviewer's issues, `short` appends one line, `off` appends nothing. The review result is still logged internally; the setting only changes what the user sees.

`reviewMaterialOnly` (default `true`) skips the reviewer LLM call entirely when the draft contains no actionable claim at all (no version/path/command/number/backticked identifier/state assertion); such drafts are released deterministically. Set it to `false` to force model review on every answer. This is a token-cost control, not a correctness guarantee: the detector is a deliberately conservative regex list, and any draft mentioning a concrete claim still goes to the reviewer.

## Step-by-step provenance table (0.7.0–0.8.3)

This table records the evidence for every claim introduced by the 0.7.0–0.8.3 changes. **Sourced** means a locally verifiable artifact (host source path + line, version number, or command output produced in this repository); **unsourced** means engineering judgement or inference and is kept on purpose. This section introduces no external URLs; the rows below were mechanically checked on 2026-10-18 (local file reads, `npm run doctor`, `npm test`, live tool outputs).

| # | Step / assertion | Evidence | Category |
|---|---|---|---|
| 1 | The host runs `tools/pre-execute` before the tool body and consumes `{kind:'allow'\|'ask'\|'deny'}` | Host bundle `%TEMP%\dsh-asar\dsh\node_modules\@deepseek-ai\dsh-tools\lib\types\index.js:885` (`ctx.waterfall(carrier,'tools/pre-execute',…)`) and `:1102` (`serviceAsk`); line content read | sourced |
| 2 | `ask` is routed through the ApprovalService; missing channel or policy `never` → deny | Same host file `:1102`; live denial text “approval 缺失或策略为 never … 已拒绝执行” | sourced |
| 3 | Defaults: `guardPreExecute: true`, `reviewNotice: 'short'` | `src/config.ts:64,67,124,125`; `normalizeConfig({})` → `reviewNotice=short guardPreExecute=true` | sourced |
| 4 | Repository version is 0.8.3 in both manifests | `package.json` / `dsh-plugin.json` read → `0.8.3` / `0.8.3` | sourced |
| 5 | Live installation is 0.8.2 (0.8.3 not installed yet) | `C:\Users\Example\.dsh\plugins\dsh-doubt\package.json` → `installed-live=0.8.2`; `npm run doctor` reports `installed-version: repo=0.8.3 installed=0.8.2` until the next offline upgrade | sourced |
| 6 | 0.8.0 recursive-delete rule (temp roots allowed; system/live/drive-root/unknown conservative) | `src/guard.ts:166` (`dangerousDeleteTarget`); `test/guard.test.mjs` cases; `npm test` exit 0 | sourced |
| 7 | 0.8.1 write-direction rule; rule id `live-path-shell-mutation` | `src/guard.ts:198` (`writeDestination`), `:241`, `:246`; guard tests; live copy-out `copy-out-executed=True`, `copied-version=0.8.1` | sourced |
| 8 | 0.8.2 `deleteTargets` path-like-token filter; symbol `targets.some(...)` | `src/guard.ts:142`, `:231`, `:236`, `:237`; new guard tests; `npm test` 11 files OK | sourced |
| 9 | 0.8.3 `reviewMaterialOnly` default `true`; reviewer skipped only for drafts with no material claim | `src/config.ts:71,130,227`; `src/completion.ts:17,26,747`; `test/operations.test.mjs` new cases (throwing reviewer never called for `你好。`; state assertion still reviewed) | sourced |
| 10 | 0.8.3 release chain | `tsc --noEmit`=0, build=0, 11 test files OK, smoke OK, audit 13 items, `host.test` Loaded 0.8.3, host-loop 4 modes PASS | sourced |
| 11 | Token saving magnitude of 0.8.3 | Not measured per-call; only the reviewer call is removed for non-material drafts (packet is bounded by `reviewMaxChars`). | unsourced (inference / not measured) |
| 9 | Rule id `install-local-script` | `src/guard.ts:231` | sourced |
| 10 | Live write into `.dsh/plugins/**` is denied by the gate | Live tool output: “危险变更闸门 … live-path-shell-mutation … 已拒绝执行” | sourced |
| 11 | On 0.8.1 a literal temp `Remove-Item -Recurse` was still denied (`recursive-delete`) | Live tool output: “recursive-delete … 已拒绝执行” | sourced |
| 12 | Upgrade 0.7.0→0.8.1 ran build, backup, copy, `pnpm install --offline`, 48-file hash check and restarted DSH | `_diag\upgrade-console.log` 2026-10-18 17:00:25 lines (`installed version: 0.8.1  lib files: 48  diffs: 0`, `OK: 升级完成`, `started DeepSeek Harness`) | sourced |
| 13 | 0.8.1 temp-delete refusal was caused by `deleteTargets` treating trailing `Write-Host`/message tokens as targets | Code path + new test reproduce the classification difference, but the old 0.8.1 build was not re-run under instrumentation against the identical command | **unsourced (inference)** |
| 14 | The session-launched watcher is terminated when DSH exits | Two observations only (log contains only the start line; process absent after restart); no process-tree or host-log evidence | **unsourced (inference)** |
| 15 | The rollback commands are executable | Backups verified to exist (`install-backup-20261018-133825` → 0.6.3; `offline-upgrade-backup-20261018-170025` → 0.7.0), but the copy/`pnpm` commands were not executed | **unsourced (not run)** |

Note: the command outputs cited in rows 7, 8 and 12 are session measurements; only the upgrade log in row 12 is persisted in this repository — rerun `npm test` / `test/guard.test.mjs` to reproduce the others.

## Provenance gate

Claim-level verification is nearly useless on prose documents: measured on a real 46k-character
deployment manual, the mechanical oracles covered 21 assertions — 20 unjudgeable and 1 was a false
refutation. But when the same model was asked *"does every deployment step have a basis?"* it
produced a 42-item / 9-category provenance table on its own. **The capability exists; the trigger
did not.** So this gate does not judge the document, it demands one concrete artifact.

- Fires when a turn **writes a delivered document** (`.md`/`.txt`/…, excluding `logs/`, `tmp/`, …)
  whose body has no provenance heading, and the scanner finds enough specific assertions.
- Injects a request for a step-by-step provenance table: every item either **sourced** (link, doc
  title, version) or **unsourced**, with unsourced items kept and labelled.
- Off-switch is the artifact itself: once the document carries a provenance section
  (`溯源|出处|逐步骤|参考文献|来源总表|未验证项`), it is never asked again.
- Noise control: **once per document path**, own budget of 4 per human turn (independent of
  `maxRounds`), and it never runs on the claim-level path.

Measured on real sessions: a 126-turn document-heavy session produced **6 asks — one per delivered
document, not one per write**; an 11-turn code/analysis session produced **0**; the manual above
produced **1 ask before** the provenance appendix existed and **0 after**.

---

## Noise guards

1. **Claim-level checks stay silent without a positive refutation**: only `refuted`, `inconclusive` with contradicting sources, or a Tier C vote split trigger an injection. Operation evidence and document provenance have separate triggers.
2. **Tool use is not verification.** A tool name no longer exempts an entire turn; failures, unrelated reads and pre-change checks cannot prove completion.
3. **Short answers skip claim-level scanning only.** Final review resets per host turn; legacy followup budgets reset on human input.
4. **State guard**: post-turn checks wait for idle; final review runs inside the current request.

---

## Security boundary

- **Commands in the answer are not executed by default.** With `executeAnswerCommands: false` only PATH existence is checked. Command lines containing pipes / redirections / `&&` / command substitution are **refused for parsing** and marked `unverifiable` — never guessed.
- **No shell**: `argv` goes straight to `spawn`; on Windows `.cmd`/`.bat` targets are wrapped with `cmd.exe /d /s /c` with per-argument escaping.
- **Denylist**: `rm`, `del`, `format`, `diskpart`, `dd`, `reg`, `schtasks`, `vssadmin`, `wevtutil`, …
- **Timeout**: 15 s default, then `SIGKILL`, reported honestly.
- **Output cap**: 4000 characters.
- **`expr` runs in an empty `vm` context**: no `require`, `process` or `globalThis`.
- **Network behaviour**: registry queries send extracted package names; probes use `probeUrls`. Default final review additionally sends human requests, drafts and current-turn tool arguments/text results to the current model provider and consumes model usage. Disable `requireOperationEvidence` to stop this call. Unavailable review reports incomplete. Tier C also uses host model capabilities; registry connectivity status is not a global no-network switch.

It does **not** go through DSH's sandbox/approval chain — a known plugin-layer limitation. Tighten `denyBinaries`, or set `verifyTool: false`.

---

## Development

```bash
pnpm install            # online
pnpm install --offline  # with a warm pnpm store
npm run host:unpack     # unpack the installed app's app.asar for the host oracles (auto-detects the install; --app <dir> overrides)
npm run doctor          # is the installed plugin aligned with this checkout, and is it actually running? (see below)
npm run verify          # typecheck + build + 11 test suites + smoke + 13 repository checks + host suites + independent oracles
# The two host suites and the independent oracles need the installed desktop app.
# They auto-detect it and print SKIP (exit 0) when it is absent instead of failing.
npm run verify:host
npm run verify:host-loop
# Optional live review; consumes selected account usage, synthetic cases only:
npm run eval:review -- --app <DSH-install-directory> --account-home <DSH_HOME> --model deepseek-flash
```

`npm run verify:independent` exists because "the tests pass" is weak evidence when the tests
were written together with the code. It judges the project only with outside references:

| Check | Oracle |
|---|---|
| the plugin row actually reaches the composed profile | the real `dsh` CLI (`--dump-config` on a throwaway profile) |
| `rangeSatisfied` is right | the real `semver` package, ~500 range/version pairs |
| the plugin registers under the host's service-injection rule | the real `@deepseek-ai/cordis`, on a context where reading `ctx.tools` on the *outer* context throws |
| the provenance gate fires once per delivered document | this machine's own session logs, replayed through the real loop |
| no `expr` payload can kill or hang the host | each payload in its own child process |
| the silence-only guards never invent a refutation | a genuinely local missing path must still be refuted |

`npm run doctor` answers a different question: **is the installed plugin aligned with this
checkout and actually running?** It is modelled on the `doctor` subcommand of the ecosystem's
`dsh-verdict` plugin (static facts only; the loader itself is left to a live session). It checks,
and prints PASS/FAIL for: repo vs installed version and manifest version; byte-identical `lib/`
between repo, the live install directory and the profile link; the profile dependency and bundle
row; the installed `cordis.patch.yml` being a top-level `- insert:` array that declares
`guardLiveMutation` / `reviewReasoningEffort` / `segmentedReview`; the composed `cordis.yml`
row; and the Node engine range. It then reads this machine's newest session store (the
`session.v4.jsonl.zstd` file is a sequence of independent zstd frames) and reports runtime
evidence without failing on it: whether the injected prompt section (the 0.6.x guard section)
appears in a stored `system/message`, how many stored final answers carried the
"未经完整审核" banner (`banner,banner,…,clean` shows the last six), and how many live
`verify_claims`/`doubt_review` calls the session recorded. A banner-free answer after an
install/restart is behavioural evidence that the reviewer completed; it is not proof that the
review was correct. `npm run doctor -- --json` emits the same data as JSON.

Items needing the unpacked host app report `SKIP` with the reason when it is absent, **stale or
incomplete**: run `npm run host:unpack` after a desktop update, or point `DSH_ASAR_DIR` at an
existing unpack. A half-extracted asar is reported as `SKIP`, never as `FAIL`, because a missing
module in the host copy says nothing about this plugin.

| File | Responsibility |
|---|---|
| [src/index.ts](src/index.ts) | entry: tool, prompt section, evidence loop, connectivity |
| [src/scanner.ts](src/scanner.ts) | risk scanner (pure) |
| [src/completion.ts](src/completion.ts) | Buffered review, evidence contract, receipts and fail-closed handling |
| [src/operations.ts](src/operations.ts) | Tool-call/result correlation and execution states |
| [src/guard.ts](src/guard.ts) | live-mutation detection and the rollback/confirmation/health-check assessment (pure) |
| [src/claims.ts](src/claims.ts) | claims → executable checks (safe parsing) |
| [src/local.ts](src/local.ts) | Tier A local oracles |
| [src/evidence.ts](src/evidence.ts) | Tier A/B orchestration + verdict rules |
| [src/factored.ts](src/factored.ts) | Tier C re-derivation + majority vote |
| [src/network.ts](src/network.ts) | connectivity probe with TTL cache |
| [src/verify.ts](src/verify.ts) | generic check executor |
| [src/loop.ts](src/loop.ts) | `agent/status` → verify → `agent.followup` |
| [src/prompts.ts](src/prompts.ts) | evidence injection text and prompt section (zh/en) |
| [src/config.ts](src/config.ts) | config + StandardSchemaV1 |

Host extension points: `ctx.tools.register()`, `ctx.systemPrompt.section()`, `ctx.on('agent/status', …, {global:true})`, `agent.session.snapshotEvents()`, `agent.followup()`, `ctx.subagents.start()` (Tier C, degrades gracefully).

---

## Measured: does it actually help?

The harness lives in `eval/` and is reproducible (`npm run eval:corpus` → `eval:extract` → `eval:sample` → manual ground truth → `eval:score` / `eval:delta`):

- **Corpus**: **152 real assistant answers** from this machine's own session store (multi-frame zstd, 19852 events, 185 turns). No invented prompts, no self-answering.
- **Ground truth**: 44 stratified claims verified by **independent means** (`Test-Path`, cross-repo grep, npm registry, the host's `d.ts`) — never by the plugin's own oracles.
- **The metric is not "accuracy"** but the two dangerous error rates: false refutation (calling a correct claim wrong, which pushes the model to "fix" correct answers) and false confirmation (blessing a hallucination).

| Metric | v0.2 (before) | v0.3 (after) |
|---|---|---|
| Extraction faithfulness | 24/44 = 54.5% | — |
| Refutations emitted (full corpus) | 645 / 1345 | **8 / 1162** |
| Refutation precision (each verified independently) | **0/13 = 0%** | **5/8 = 62.5%** (5/5 excluding examples quoted in my own messages) |
| False confirmations | 0/12 | 0 |
| Answers it spoke on | **152/152 = 100%** | **7/152 = 4.6%** |
| Claims mechanically judgeable at all | — | 86/1162 = **7.4%** |

Before the fixes it was **net negative**: it interrupted every single answer while its refutation channel had zero measured precision — a tool that fabricates rebuttals is worse than no tool. After them it is a **narrow net**: it speaks on 4.6% of answers, and 5 of those 8 were genuine catches (files the answer asserted exist but that do not).

The last row is the one to remember: **only ~7% of the claims in real answers are mechanically judgeable on this machine**. This is not a general hallucination cure; it is a small net for files / packages / commands / versions. Everything else still needs verification tools and external sources.

---

## Proven vs not proven

**Measured (covered by tests)**: local oracle correctness (PATH, installed versions, version claims, definition sites), verdict rules (source counts, conflicts, weak-evidence neutrality), safety constraints in claim translation, Tier C voting and split handling, loop budget and noise guards, and that what gets injected is evidence rather than a request.

**Not measured**: the end-to-end error-rate delta of plugin-on vs plugin-off. The literature supports the **mechanism** (external feedback works, intrinsic self-correction does not), not this plugin's specific effect. Judging it requires comparing four arms at equal inference cost: baseline / prompt section only / Tier A+B / Tier A+B+C.

**Known failure modes**:
- The scanner is heuristic: it misses things and produces false positives. Bare identifiers such as `2402.06380` are now caught as version-like claims and marked `unverifiable`, but errors **without a numeric shape** (a misremembered function name or invented field name written in prose without backticks) still slip through.
- Tier A only judges what this machine can judge; factual claims ("this paper says X") fall back to Tier C when offline.
- Tier C needs host subagent capability; it degrades honestly when absent.
- Extra model calls and tokens; tune `minScore` and `maxRounds`.

---

## Provenance of the claims in this README

This project's whole thesis is that a claim should carry its basis. So the README is held to
its own standard: every load-bearing claim below is either **sourced** (verifiable from a file
in this repo, a host source line, or a command you can run) or **unsourced** (my own
measurement or engineering judgement), and the unsourced ones are kept and labelled rather
than quietly dropped.

| # | Claim in this README | Basis | Where to check it / why it cannot be checked |
|---|---|---|---|
| 1 | 11 test suites + smoke, plus 13 repository checks | **sourced** | `package.json`'s `test` script chains 11 `node test/*.test.mjs`; rerun with `npm run verify` |
| 2 | Version 0.8.3, consistent in `package.json` and `dsh-plugin.json` | **sourced** | `npm run audit` prints `版本一致：0.8.3` |
| 3 | The bundle row **must** use a top-level `insert:`, or the host never mounts it | **sourced** | host source `@deepseek-ai/dsh-app-boot` (`applyEntryPatches` starts from an empty list); reproducible with `dsh --profileX --dump-config` on a throwaway profile — without `insert:` stdout is 2 bytes and stderr says `patch: entry "dsh-doubt" not found`, with it stdout is 461 bytes containing `- id: dsh-doubt` (`npm run verify:independent`, item 1) |
| 4 | Services resolve only through `ctx.inject`; reading them on the outer context throws | **sourced** | `@deepseek-ai/cordis/src/reflect.ts:144` = `lib/index.js:676`: `cannot get property "${prop}" without inject`; `npm run verify:independent` item 3 registers under the real cordis |
| 5 | The session working directory is `exec.agent.session.header.cwd` | **sourced** | host source, two independent packages: `dsh-tool-fs/lib/index.js:173` and `dsh-tool-bash/lib/index.js:294` |
| 6 | `verify_claims` registers six check kinds | **sourced** | `src/tool.ts` `CHECK_KINDS`; live call returns `workspace: { cwd, source }` |
| 7 | Claim-level injection fires only on a positive refutation, not on "couldn't verify" | **sourced (by tests)** | `test/loop.test.mjs` covers the budget and the silence conditions |
| 8 | Evaluated corpus: 152 answers, 19852 events; refutations 645/1345 → 8/1162; precision 0/13 → 5/8 = 62.5%; answers spoken on 152/152 → 7/152 = 4.6% | **UNSOURCED — not reproducible from this repo** | the artifacts live in `eval/out/`, which is **deliberately not committed** (they are extracted from this machine's real sessions and contain answer text, local paths and a LAN address). The generating scripts are committed (`eval/*.mjs`), so you can rebuild an equivalent corpus from *your* sessions, but you cannot re-derive these particular figures. Also: one re-measurement of that corpus gave **19879** events, not 19852, and I could not reconcile the difference — treat the exact counts as approximate. |
| 9 | The provenance gate fires once per delivered document, not once per write | **sourced (by tests)** | `test/loop.test.mjs` (same path twice → one ask; different case → one ask); a real 3-turn session containing **41 writes** to one file produced exactly **1** ask |
| 10 | "126-turn document session → 6 asks", "11-turn code session → 0 asks", "manual before the audit → 1, after → 0" | **UNSOURCED — my own replay, script not kept** | driven through the real loop over this machine's session logs; the harness was a scratch script and was deleted, so it cannot be re-run. An independent verifier re-checked only the "same path 3× → 1 ask" property, not these totals. The "before the audit" manual was a **reconstruction** (I deleted appendices A/B/E to recreate the pre-audit state), not a real historical file |
| 11 | ~98.6% of turns are suppressed by the "already verified" gate | **UNSOURCED — my own count** | measured on this machine's session logs with a scratch script, now deleted |
| 12 | Refutations on the real 46k-character manual: `{"refuted":1,"unverifiable":20}` → `{"unverifiable":21}` after fixes | **UNSOURCED — my own measurement** | same deleted harness; the one refutation was `npu-smi info`, which was itself wrong (device CLIs belong to the target machine) |
| 13 | End-to-end error-rate delta (plugin on vs off) | **UNSOURCED — not measured** | stated as not measured in "Proven vs not proven" above; would need four arms at equal inference cost |
| 14 | The header icon `assets/icon.png` is a 512×512 PNG; there is also a 256×256 PNG and a multi-size `.ico` | **sourced** | read back with Pillow 12.3.0: `icon.png → (512, 512)`, `icon-256.png → (256, 256)`, `icon.ico → {16, 24, 32, 48, 64, 128, 256}` |
| 15 | The icon is generated by `assets/make-icon.py` (Pillow, 4× supersampling, LANCZOS downscale) | **sourced** | the committed script contains `from PIL import Image, ImageDraw`, `SS = 4` and `LANCZOS` (three separate greps, all `True`); the PNG/ICO are committed, so re-running it reproduces them |
| 16 | `package.json`'s `files` ships the three icon files | **sourced** | `node -e "console.log(require('./package.json').files)"` prints `["lib","cordis.patch.yml","dsh-plugin.json","assets/icon.png","assets/icon-256.png","assets/icon.ico","README.md","README.zh-CN.md","CHANGELOG.md","LICENSE"]` |
| 17 | The clone URL in this README points at `github.com/Yangxingyu789/dsh-doubt` | **sourced** | the placeholder `<你的GitHub账号>` was replaced in exactly 5 places (README.md 1, README.zh-CN.md 1, package.json 3) and 0 remain; `git remote -v` shows the same URL for `origin` |
| 18 | That repository exists and was **private** when this table was written | **sourced** | loaded with this machine's logged-in browser session: HTTP 200, title `Yangxingyu789/dsh-doubt: …`, page carries `svg.octicon-lock` and the word `Private`, and no `Public`; independently, anonymous `GET https://api.github.com/repos/Yangxingyu789/dsh-doubt` returns **404** |
| 19 | It is still an empty repository (nothing has been pushed) | **sourced** | the same page renders GitHub's empty-repository onboarding (`…or push an existing repository`); the local commit `7e3d42b` exists but a push has not completed |
| 20 | `npm run verify` covers the host suites and the independent oracles, not just typecheck/tests/audit | **sourced** | `package.json`'s `verify` script now chains `verify:host && verify:host-loop && verify:independent`; the previous revision (`git show HEAD:package.json`) stopped at `npm run audit`, which is why all three could be red while `verify` stayed green |
| 21 | The host suites locate the installed desktop app without `--app` | **sourced** | `scripts/host-app.mjs` probes `--app`, `DSH_APP_DIR`, the running `DeepSeek Harness` process and the standard install locations; measured here: `npm run verify:host` and `npm run verify:host-loop` passed with no flag after this change |
| 22 | A stale or half-extracted host unpack is reported as `SKIP`, never `FAIL` | **sourced** | `scripts/verify-independent.mjs` `hostUnpackProblem()` checks the CLI, `dsh-app-boot/package.json` and the `.unpacked.json` marker against the current `app.asar`; the marker is written by `scripts/unpack-host.mjs` (`npm run host:unpack`) |
| 23 | The unpack found on this machine was stale and incomplete: 87 of 287 packages had no `package.json` | **sourced (measured before re-unpacking; that state no longer exists)** | measured: `dsh-asar` dated 2026-10-16 21:01 while `app.asar` was 2026-10-17 12:49, and 87/287 packages lacked `package.json`, which produced `ERR_MODULE_NOT_FOUND` for `dsh-app-boot/index.js`. `npm run host:unpack` then wrote 16711 packed + 1583 unpacked files (18294 = the asar header's own count) and the oracle went to 6 PASS / 0 FAIL / 0 SKIP |
| 24 | A busy turn used to exceed `reviewMaxChars` and the guard withheld the whole final answer as `INPUT_LIMIT` | **sourced (measured on this machine's own session log)** | rebuilt the packet with the plugin's own `buildReviewPacket` from that session's tool events: turn 6 had **77 calls / 209,267 chars** of result text and produced a **216,921-char** payload against the 120,000 limit; the same turn now produces **119,735** chars |
| 25 | Oversized tool results are clipped with an explicit marker, never silently dropped, and every current-turn call is kept | **sourced (source + tests)** | `src/completion.ts` `clipRecord()` appends `[dsh-doubt] result truncated: kept N of M chars` and sets `truncated`; `test/operations.test.mjs` flood case (77 × 2,700 chars) asserts payload ≤ limit, all 77 records kept, `truncatedCalls > 0`, and that a quote from the retained prefix still validates |
| 26 | `npm run verify` now runs all four host-loop scenarios | **sourced** | `package.json` `verify:host-loop` chains default, `--exhausted`, `--reviewer-error` and `--history`; measured: `--exhausted` failed before the notice fix (assertion expected 自动取证轮数已用尽) and all four pass after it |
| 27 | Optional history padded most review requests to ~119.7k chars | **sourced (measured)** | rebuilt every turn with the plugin's own `buildReviewPacket` from this machine's session log: turns 1–7 produced 81,757 / 119,724 / 119,570 / 119,738 / 119,713 / 119,706 / 119,668 chars against the then-current 120,000 limit |
| 28 | That padding made review calls exceed the 60 s deadline, so the answer was withheld as `REVIEW_TIMEOUT` | **sourced** | the guard's own notice on the affected turn read `插件审核服务出错（REVIEW_TIMEOUT）`; the fix sets `reviewMaxChars` to 48,000, caps history at a quarter of the budget, raises the deadline to 120,000 ms and retries once without history |
| 29 | The history cap and the timeout retry are covered by tests | **sourced (by tests)** | `test/operations.test.mjs`: the 120-record history case asserts payload < 80% of the 48,000 budget while current-turn evidence still wins; the timeout case asserts exactly one cheaper retry and that the draft is then released |
| 30 | The reviewer's output budget was exhausted twice (`max-tokens`) on a long answer, so the draft was withheld | **sourced (measured on this machine's session log)** | this session's own log records `插件审核服务出错（max-tokens）` on turn 8; the same log records `INPUT_LIMIT` on turn 6 and `REVIEW_TIMEOUT` on turn 7 |
| 31 | Draft parts are grouped into ~400-char units and the truncation retry uses 12000→24000 tokens and drops history | **sourced (source + tests)** | `src/completion.ts` `draftParts()` grouping and the `finish === 'max-tokens'` retry branch; `test/operations.test.mjs` asserts 200 short lines merge into ≤30 parts with the exact draft preserved, and that the retry sees 24000 tokens with only current-turn records |
| 32 | `INVALID_REVIEW` is raised only by `validateReview`'s `fail()` branches, and it occurred once in this session | **sourced (source + session log)** | `src/completion.ts` `fail()` returns `failure.code = 'INVALID_REVIEW'`; this session's log records exactly one occurrence: turn 12 at 17:09:34 local |
| 33 | A contract violation or malformed JSON is now retried once with the validator's reason, mixed `partIds`/`text` is accepted when text coverage matches, and the notice carries the reason | **sourced (source + tests)** | `src/completion.ts` `repair()`/`repairNote` and the relaxed coverage branch; `test/operations.test.mjs` asserts the repair retry carries "rejected by the output validator" and `partIds 0..0`, that invalid JSON is retried, that mixed representation approves, and that `{partIds:[0,2]}` reports a `partId` detail |
| 34 | The live-mutation gate rejects a turn that mutates the live host environment unless rollback, user confirmation and an independent post-action health check are all disclosed | **sourced (by tests)** | `test/guard.test.mjs`: the incident timeline (install script → live-profile `pnpm install` → no later call) is rejected as `verify` with zero reviewer calls; the all-present case proceeds to review; `guardLiveMutation: false` takes the old path |
| 35 | The 2026-10-17 incident: installing into the live profile while DSH was running was followed by every tool failing with `cannot get required service "sessionProjections" in inactive context`; a restart restored them | **UNSOURCED — no host log** | recorded in the handover notes and the session timeline; the hot-reload root cause is an inference, and the gate's effect in a real host session has not been measured |
| 36 | The repeated `max-tokens` banner came from reviewer thinking consuming the whole output budget; sending `reasoningEffort` explicitly fixes it | **sourced (live replay of a recorded session packet)** | replayed the stored turn-4 review packet (52,672 chars, 7 parts) through the real installed host `LlmRuntime` + DeepSeek adapter: attempt 1 (12,000 tokens) returned `outputTokens=12000`, `rawChars=0` and finish `max-tokens`; the same packet with `reasoningEffort="off"` returned a verdict in 2.9 s / 325 output tokens. Session evidence: the recorded system message (seq 706, turn 4) also contains the guard section, while turn 1's does not |

If you want items 8, 10, 11 or 12 to become sourced, the honest options are: (a) commit a
**sanitised** corpus (session IDs and paths stripped) so the numbers can be rebuilt, or (b)
re-derive them and state the commit they were measured at.

---

## License

MIT
## Step-by-step provenance table (0.8.3 documentation revision)

Checked on 2026-10-19 before being written. This section has no external URLs, so no HTTP status applies; every local claim is grounded in a file read, a `Select-String` search, or command output produced in this repository.

| # | Item | Claim | Evidence | Class |
|---|---|---|---|---|
| 1 | Live installation | `0.8.2` | `[System.IO.File]::ReadAllText('C:\Users\Example\.dsh\plugins\dsh-doubt\package.json')` → `0.8.2` (read this turn) | sourced |
| 2 | Repository version | `0.8.3` | `C:\work\dsh-doubt\package.json` → `0.8.3`; `dsh-plugin.json` → `0.8.3`; `npm run audit` → `版本一致：0.8.3` | sourced |
| 3 | Historical mentions `0.8.1` / `0.8.2` was | those were the live versions at the time | CHANGELOG 0.8.1/0.8.2 entries and the handoff document; the historical host state cannot be re-observed now | unsourced (historical record, not re-verified) |
| 4 | `scanAnswer(draft)` | symbol exists | `src/scanner.ts:240` → `export function scanAnswer(text: string, options: ScanOptions = {}): ScanResult {` | sourced |
| 5 | `hasMaterialClaim(draft)` | symbol exists | `src/completion.ts:26` → `export function hasMaterialClaim(text: string): boolean {` | sourced |
| 6 | `hasMaterialClaims` (plural) | does not exist; docs use the singular | `Select-String` over `src/**` and `test/**` for `hasMaterialClaims` → 0 matches (this turn; the docs mention it only to record that it does not exist) | sourced (negative check) |
| 7 | 0.8.3 test chain | 11 suites, audit 13 items, host loads 0.8.3, host-loop 4 modes | `npm test` exit 0 with 11 `.test OK` lines; `node scripts/audit.mjs` → 13 checks and `版本一致：0.8.3`; `test/host.test.mjs` → `Loaded 0.8.3`; four `host-loop.test.mjs` modes exit 0 | sourced |
| 8 | 0.8.3 runtime behaviour | not verified | 0.8.3 is not installed in the live profile yet (live is 0.8.2) | unsourced (unverified) |
