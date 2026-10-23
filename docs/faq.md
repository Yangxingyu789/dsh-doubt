# FAQ

## The plugin is installed but does nothing

1. Install into the intended profile:
   `dsh plugin --profile <profile> add github:Yangxingyu789/dsh-doubt#v0.1.5`
2. Restart the harness and refresh the UI.
3. Check **Settings → Plugins** and enable the plugin.
4. Run `dsh --profile <profile> --dump-config` and look for `- id: dsh-doubt`.

## Why does a GitHub install not need a build?

Because the built `lib/` is committed. `dsh plugin add github:` installs the repository as-is
and does not run `npm run build`; committing `lib/` is the common DSH plugin release pattern.

## What happens if review fails?

The default is fail-open: the draft is released and the failure is logged. Set
`reviewNotice` to `banner` or `short` if users need a visible warning. Review is an evidence
check, not a correctness guarantee.

## Why was my answer blocked?

The reviewer found an actionable claim that contradicts this turn's tool evidence, or a
material claim with no evidence. Add real tool results or explicitly mark the claim as
unverified. Do not retry internal receipt ids.

## What is `doubt_review`?

It is the plugin's internal receipt tool. It is hidden from the model's tool list. Model-authored
receipt calls from stale transcripts are intercepted so they cannot spin the turn.

## Is the gate a security boundary?

No. It is heuristic: it covers common Windows/PowerShell wrappers, archives, ACL tools and local
Node writes, but arbitrary code execution or unusual encodings can evade it. Report bypasses via
[SECURITY.md](../SECURITY.md).

## How expensive is review?

Each review adds one model call containing the request, draft and this turn's tool evidence, bounded
by `reviewMaxChars`. The `审核用量` log records character counts and provider usage; missing usage
is unknown, not zero. `reviewMaterialOnly` skips drafts with no actionable claims.

## Which platforms/versions are supported?

Windows is primary; Linux/macOS are supported for development and CI. See
[compatibility](compatibility.md). DSH itself is a developer preview and plugin contracts may change.
