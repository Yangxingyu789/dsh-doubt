# Compatibility

## Tested with

| Component | Version |
|---|---|
| DeepSeek Harness desktop runtime | `0.2.1-rc.2` |
| DSH plugin target declared in `package.json` | `0.2.0-rc.2` |
| Node.js | `^22.19` or `>=24` |
| Primary platform | Windows (PowerShell, path/argv edge cases) |
| CI platforms | Windows and Ubuntu |
| Model used for live validation | `deepseek-flash` (DeepSeek-V4.1-Flash-1017) |

DSH is a developer preview: plugin contracts can change between releases. Pin the DSH
version you tested with, and pin the plugin release you deploy. The repository records the
DSH target in `package.json` (`dshTarget`) and the tested runtime in this table.

## DSH profile install

The supported discovery convention is the GitHub topic **`dsh-plugin`**. The official
plugin installer is:

```bash
dsh plugin --profile web add github:Yangxingyu789/dsh-doubt#v0.1.5
```

After installing, restart the harness and refresh the UI; the plugin is managed under
**Settings → Plugins** and can be enabled/disabled there. Pin a commit/tag instead of a
moving branch for reproducible installs.

For the Windows desktop offline installer, see the main README.

## Limits

- The live-mutation gate is heuristic and not a security boundary.
- Host integration checks require a DSH installation; upstream CI skips them.
- Review checks evidence, not semantic correctness or user intent.
- Public `0.1.x` configuration keys may change while DSH is in preview.
