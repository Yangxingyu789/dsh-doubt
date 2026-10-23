# Architecture

`dsh-doubt` is a bundle plugin for DeepSeek Harness. It does not replace the agent;
it adds two checkpoints around the agent's existing tool loop.

![Request flow](../assets/architecture.svg)

## Boundaries

1. **Tool boundary — `tools/pre-execute`**
   A dangerous live-host mutation (writes under `.dsh/profiles` / `.dsh/plugins`,
   process/service/registry changes, recursive deletes, system directories, and common
   wrapped/encoded forms) is classified before the tool body runs. With an approval
   channel the host may ask; without one, or under a `never` policy, the call is denied.

2. **Answer boundary — `llm/stream`**
   The plugin buffers the final assistant stream. It extracts actionable claims
   (commands, paths, versions, package names, symbols, measured numbers, completion
   assertions) and has a tool-less reviewer compare them with this turn's actual tool
   calls and results. A rejected draft is not emitted as the final answer.

3. **Token-loop boundary**
   Internal `doubt_review` receipts are hidden from the model tool list but remain
   executable by the host. Model-authored receipt calls from stale transcripts are
   intercepted: mixed responses keep their real tools; receipt-only responses stop with
   an explicit incomplete-verification notice. This prevents "invent a receipt →
   `invalid` → invent another" loops.

## Review outcome

The reviewer can return:

- **approve** — actionable claims are grounded; the draft is released.
- **verify** — concrete gaps or contradictions; the author gets one bounded evidence
  round, then the draft is reviewed again.
- **unavailable** — review could not complete (for example, a provider failure). The
  draft is released fail-open with a recorded status; review is not a correctness
  guarantee.

Review packets are bounded (`reviewMaxChars`) and long drafts are segmented. A review
attempt logs character counts, elapsed time, finish reason, failure code and
provider-reported usage counters when available; prompt text, tool payloads and
credentials are not logged.

## Security model

The scanner and gate are heuristics, **not a security boundary**. They cover common
Windows/PowerShell wrappers, archive/ACL tools, `cmd /c`, encoded PowerShell and local
Node `fs` writes, but arbitrary code execution or unusual encoding can still evade them.
The answer reviewer checks evidence, not user intent or semantic correctness. Reports of
gate evasions are still useful as hardening work; see [SECURITY.md](../SECURITY.md).
