# Configuration reference

All options live under the plugin's `config:` block. The defaults below match
[`cordis.patch.yml`](../cordis.patch.yml). An override **replaces the whole config
object**, not a deep merge; include every key you want to keep.

```yaml
- id: dsh-doubt
  config:
    enabled: true
    # ...
```

## Core

| Key | Default | Meaning |
|---|---:|---|
| `enabled` | `true` | Load and run the plugin |
| `verifyTool` | `true` | Register the `verify_claims` tool |
| `promptSection` | `true` | Add the evidence rules to the system prompt |

## Evidence collection

| Key | Default | Meaning |
|---|---:|---|
| `autoVerify` | `true` | Collect evidence for material claims after a turn |
| `requireSources` | `2` | Sources needed before an online claim is treated as confirmed |
| `onlineTimeoutMs` | `8000` | Timeout for online probe/registry checks |
| `factored` | `true` | Enable independent re-derivation for inconclusive claims |
| `factoredVotes` | `3` | Number of independent votes |
| `factoredProvider` | `spawn` | Subagent provider used for votes |
| `executeAnswerCommands` | `false` | Execute commands quoted in the answer instead of only checking availability |
| `strictLabeling` | `true` | Require explicit verified/unverified labels |

## Final-answer review

| Key | Default | Meaning |
|---|---:|---|
| `requireOperationEvidence` | `true` | Review the final answer against this turn's tool evidence |
| `reviewMaterialOnly` | `true` | Skip the reviewer when a draft has no actionable claim |
| `reviewMaxChars` | `120000` | Maximum review packet size in characters |
| `segmentedReview` | `true` | Split long drafts into bounded segments |
| `reviewTimeoutMs` | `120000` | Reviewer timeout |
| `reviewReasoningEffort` | `off` | `off`, `low`, `high`, `max`, or `default` (omit the field) |
| `reviewNotice` | `off` | Trailing notice when review is incomplete: `banner`, `short`, `off` |
| `maxRounds` | `2` | Maximum evidence repair rounds per turn |
| `minScore` | `6` | Risk-score threshold for the legacy evidence loop |
| `maxFindings` | `8` | Maximum findings sent back to the author |
| `minAnswerChars` | `240` | Minimum answer length considered by the legacy loop |
| `language` | `auto` | Prompt language: `auto`, `en`, or `zh` |

## Provenance

| Key | Default | Meaning |
|---|---:|---|
| `requireProvenance` | `true` | Require a provenance table for annotation-free deliverables |

## Live mutations

| Key | Default | Meaning |
|---|---:|---|
| `guardPreExecute` | `true` | Ask/deny dangerous live mutations before the tool body runs |
| `guardLiveMutation` | `true` | Require backup + rollback + post-action health check after a live mutation |
| `liveMutationPaths` | `.dsh/profiles`, `.dsh/plugins`, `program files`, `programdata`, `c:/windows` | Path prefixes considered live-host state |

## Operation evidence

| Key | Default | Meaning |
|---|---:|---|
| `operationMaxRounds` | `3` | Evidence-collection budget for long answers |
| `probeUrls` | built-in list | Optional online reachability probes |

## Practical notes

- Keep `reviewReasoningEffort: off` unless the provider reliably supports reasoning and
  the review budget is large; thinking tokens can consume the reviewer output budget.
- `reviewMaxChars` bounds the reviewer input. Raising it increases token cost; lowering
  it increases `EVIDENCE_CONTEXT_LIMIT` / unavailable outcomes.
- `reviewNotice` controls visibility, not safety. Review failure is fail-open by design;
  use `banner` if users need a visible warning.
- The pre-execution gate and scanner are heuristics. See [architecture](architecture.md)
  and [SECURITY.md](../SECURITY.md).
