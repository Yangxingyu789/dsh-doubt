# dsh-doubt

**Turns "are you sure?" into an automatic DSH action.**

A model's first answer is often sloppy: the command was never run, the path was never confirmed, the version came from memory, the API signature was invented. So you end up asking "are you sure?" several times — and every time it actually checks, it finds a problem.

`dsh-doubt` automates that loop: **any assertion in an answer that could be checked against external evidence but came with none is detected by the plugin, which queues a recheck turn and hands the model a tool that really executes the check.**

[中文](README.zh-CN.md) | English

---

## What it does

1. **Risk scanner** (pure functions, 9 detectors) — commands, paths, versions, API symbols, package names, numbers, code blocks, absolute wording, retractions.
2. **Automatic recheck turn** — when the risk score crosses the threshold and the turn never called a verification tool, the plugin queues a follow-up: *"these 6 assertions have no evidence; verify each one, then give a corrected conclusion and state explicitly what you got wrong."*
3. **`verify_claims` tool** — the model submits executable checks (`command` / `fileExists` / `fileMatch` / `httpStatus` / `expr` / `textEquals`); the plugin runs them on the machine and returns exit codes, measured output, and a verdict.

The third part is the point: **the fix is not "ask another model to doubt it", it is external execution.** Introspection is unreliable; a measured exit code is not.

---

## Install

```bash
dsh plugin --profile desktop add dsh-doubt
```

Offline (no network):

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

```yaml
- id: dsh-doubt
  name: "dsh-doubt"
  config:
    enabled: true
    autoRecheck: true
    maxRounds: 2
    minScore: 6
    minAnswerChars: 240
    detectors:
      number: false
```

| Field | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch |
| `verifyTool` | `true` | Register `verify_claims` |
| `promptSection` | `true` | Inject the "verify before asserting" prompt section |
| `autoRecheck` | `true` | Automatic recheck loop |
| `maxRounds` | `2` | Recheck rounds per session (reset by a new human message) |
| `minScore` | `6` | Risk threshold; raise it for less interruption |
| `maxFindings` | `8` | Max assertions listed in the recheck message |
| `minAnswerChars` | `240` | Skip answers shorter than this |
| `detectors` | `{}` | Per-detector on/off |
| `verificationTools` | see source | Tool calls that count as "already verified" |
| `denyBinaries` | `rm/del/format/…` | Binaries `verify_claims` refuses to run |
| `timeoutMs` | `15000` | Per-check timeout |
| `language` | `auto` | Injected text language |

---

## Detectors

| kind | weight | catches | asks the model to |
|---|---|---|---|
| `command` | 2 | command lines in shell blocks | run it, paste exit code and output |
| `path` | 1 | `C:\…` / `/a/b/c` | confirm it exists |
| `version` | 2 | `v1.2.3`, `^4.0.4` | check `package.json` / `--version` |
| `symbol` | 2 | `` `foo.bar()` `` signatures | read the definition or types |
| `package` | 2 | package names in backticks | check the registry / `node_modules` |
| `number` | 1 | `30 s`, `12 MB`, `47%` | state how it was measured |
| `code` | 2 | non-shell code blocks | compile/run it once |
| `absolute` | 2 | "definitely", "guaranteed", "100%" | replace with sourced claims |
| `reversal` | 3 | "sorry, I was wrong earlier" | re-verify the refuted conclusion |

Score = sum of weights, **capped at 3 hits per kind** — long answers don't trigger by default, and "ok, got it" never does.

---

## Noise guards

1. **Already verified → left alone**: a turn that called `bash` / `pwsh` / `read` / `grep` / `web_search` / `verify_claims` is not interrupted.
2. **Short answers skipped.**
3. **Round budget** `maxRounds`, reset by a new human message.
4. **State guard**: nothing is injected while the agent is `running` or its inbox is busy.

---

## Security boundary

`verify_claims` executes commands, so the limits are hard-coded:

- **No shell**: `argv` goes straight to `spawn` — no pipes, redirections or `&&`, hence no shell-injection surface. On Windows, `.cmd`/`.bat` targets are wrapped with `cmd.exe /d /s /c` with per-argument msvcrt-style escaping.
- **Denylist**: `rm`, `del`, `format`, `diskpart`, `dd`, `reg`, `schtasks`, `vssadmin`, `wevtutil`, … are refused.
- **Timeout**: 15 s per check by default, then `SIGKILL`, reported honestly.
- **Output cap**: 4000 characters, so huge outputs never enter context.
- **`expr` runs in an empty `vm` context**: no `require`, `process` or `globalThis`.

It does **not** go through DSH's sandbox/approval chain — a known limitation of plugin-level tools. Tighten `denyBinaries`, or set `verifyTool: false` and keep only the recheck loop.

---

## Development

```bash
pnpm install            # online
pnpm install --offline  # with a warm pnpm store
npm run verify          # typecheck + build + 4 test suites
```

| File | Responsibility |
|---|---|
| [src/index.ts](src/index.ts) | entry: tool registration, prompt section, recheck loop |
| [src/scanner.ts](src/scanner.ts) | risk scanner (pure, host-independent) |
| [src/verify.ts](src/verify.ts) | check executor |
| [src/loop.ts](src/loop.ts) | `agent/status` → `agent.followup` loop |
| [src/tool.ts](src/tool.ts) | `verify_claims` definition (plain JSON Schema, no host imports) |
| [src/prompts.ts](src/prompts.ts) | injected text and prompt section (zh/en) |
| [src/config.ts](src/config.ts) | config types + StandardSchemaV1 validator |

Host extension points used: `ctx.tools.register()`, `ctx.systemPrompt.section()`, `ctx.on('agent/status', …, { global: true })`, `agent.session.snapshotEvents()`, `agent.followup()`.

---

## Known limitations

- The scanner is heuristic: it decides *"this is checkable"*, not *"this is correct"*. Execution decides correctness.
- A recheck round costs one extra model call. Tune `minScore` and `maxRounds`.
- Only final answer text is scanned, not tool results.

---

## License

MIT
