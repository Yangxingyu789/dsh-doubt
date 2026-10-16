# dsh-doubt

**Tiered evidence gathering instead of asking "are you sure?".**

A model's first answer is often sloppy: the command was never run, the path was never confirmed, the version came from memory, the API signature was invented. So you ask "are you sure?" several times — and every time it actually checks, it finds a problem.

`dsh-doubt` automates this, but **not** by asking the model to think again: after each turn the plugin **itself** verifies the answer's assertions against deterministic local sources (and, when online, multiple independent sources), then injects the **measured evidence** into the next turn.

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

So: **"are you sure?" is the harmful kind of re-checking. Independent re-derivation with voting is the useful kind.** This plugin only does the latter.

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
git clone https://github.com/YOUR_NAME/dsh-doubt.git
cd dsh-doubt
pnpm install --offline
node scripts/install-local.mjs --dry
node scripts/install-local.mjs
cd "$DSH_HOME/profiles/desktop" && pnpm install --offline
# restart the DSH host
```

---

## Configuration

Override in your profile's `cordis.patch.yml` (later layers win):

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch |
| `verifyTool` | `true` | Register `verify_claims` |
| `promptSection` | `true` | Inject the tiered-verification rules and hard bans |
| `autoVerify` | `true` | Plugin runs Tier A/B itself and injects evidence |
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
| `workspace` | `process.cwd()` | Where local oracles start looking |
| `maxRounds` | `2` | Injection budget (reset by a new human message) |
| `minScore` | `6` | Trigger threshold |
| `maxFindings` | `8` | Max assertions listed |
| `minAnswerChars` | `240` | Skip short answers |
| `detectors` | `{}` | Per-detector on/off |
| `verificationTools` | see source | Tool calls that count as "already verified" |
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

1. **Silent unless there is a positive refutation**: only `refuted`, `inconclusive` with contradicting sources, or a Tier C vote split trigger an injection. Plain "couldn't verify" stays **silent** — the v0.2 rule ("speak unless everything is confirmed") measured as injecting on 100% of answers, i.e. pure noise.
2. **Already verified → left alone.**
3. **Short answers skipped**; **round budget** `maxRounds`, reset by a new human message.
4. **State guard**: nothing injected while `running` or the inbox is busy.

---

## Security boundary

- **Commands in the answer are not executed by default.** With `executeAnswerCommands: false` only PATH existence is checked. Command lines containing pipes / redirections / `&&` / command substitution are **refused for parsing** and marked `unverifiable` — never guessed.
- **No shell**: `argv` goes straight to `spawn`; on Windows `.cmd`/`.bat` targets are wrapped with `cmd.exe /d /s /c` with per-argument escaping.
- **Denylist**: `rm`, `del`, `format`, `diskpart`, `dd`, `reg`, `schtasks`, `vssadmin`, `wevtutil`, …
- **Timeout**: 15 s default, then `SIGKILL`, reported honestly.
- **Output cap**: 4000 characters.
- **`expr` runs in an empty `vm` context**: no `require`, `process` or `globalThis`.
- **Network behaviour**: only GETs to the public registries listed in `registryUrls`. **Note**: the URL path contains the **package name extracted from the answer** (`/registry/<pkg>`), so package names do leave the machine; nothing else is transmitted. Connectivity probes hit `probeUrls` with no parameters. Offline mode never touches the network.

It does **not** go through DSH's sandbox/approval chain — a known plugin-layer limitation. Tighten `denyBinaries`, or set `verifyTool: false`.

---

## Development

```bash
pnpm install            # online
pnpm install --offline  # with a warm pnpm store
npm run verify          # typecheck + build + 6 test suites + smoke + 13 repository checks
npm run verify:independent  # check the claims against oracles that are NOT this project
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

Items needing the unpacked host app report `SKIP` with the reason when it is absent (set
`DSH_ASAR_DIR` to point at it).

| File | Responsibility |
|---|---|
| [src/index.ts](src/index.ts) | entry: tool, prompt section, evidence loop, connectivity |
| [src/scanner.ts](src/scanner.ts) | risk scanner (pure) |
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

## License

MIT
