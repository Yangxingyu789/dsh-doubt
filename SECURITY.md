# Security Policy

## Supported versions

The public `0.1.x` release series is supported for security reports. Pre-public `0.7.x`
and `0.8.x` tags are historical and are not maintained.

## Reporting a vulnerability

Please do not open a public issue for a vulnerability.

Use GitHub's **private vulnerability reporting** for this repository
(`Security` tab → `Report a vulnerability`). Include:

- affected version and platform
- the exact command, payload or session shape that triggers the issue
- whether the issue can cause a live-host mutation, credential exposure, review bypass,
  unbounded token/step use, or a false success claim
- a minimal reproduction and the observed versus expected behavior

Do not include real tokens, credentials, private session logs or personal paths unless
they are essential to the report; redact them first.

## Scope

Security-relevant areas include:

- bypasses of the pre-execution live-mutation gate
- approval or review-bypass paths
- leakage of prompts, tool payloads, credentials or session content through logs
- receipt/ticket replay across sessions or turns
- infinite or unbounded review loops

The pre-execution gate and scanner are documented as heuristics, not a security
boundary. Reports about commands that evade them are still useful, but they are treated
as hardening work rather than a promise of complete coverage.

## Disclosure

We will acknowledge a report, investigate it, and coordinate a fix and disclosure. Please
allow time for a release before publishing details.
