# GitHub Actions Workflows

The repository uses three workflows:

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | Every push and pull request | Runs the test suite and manifest/package validation on Node.js 20 and 22, then checks the packaged skill archive. |
| `sync-plugin.yml` | Pull requests that change canonical or packaged sources | Fails when `plugins/bdfl/` or `dist/bdfl.skill` has drifted from canonical `src/` and `skills/` sources. |
| `release.yml` | SemVer tags such as `v1.2.3`, or a manual run from a tag | Reads the version from the tag, stamps manifests, rebuilds packages, validates, and publishes checksummed install and uninstall assets. |

## Releasing

Create and push a SemVer tag from a validated commit:

```bash
git tag v1.2.3
git push origin v1.2.3
```

The release job publishes stable asset names so documentation can always use GitHub's latest-release URLs:

- `install.sh`
- `install.ps1`
- `uninstall.sh`
- `uninstall.ps1`
- `bdfl.tar.gz`
- `bdfl.zip`
- `bdfl.skill`
- `checksums.txt`

Source manifests carry the non-release version `0.0.0-development`. Release artifacts never use that value: `scripts/set-release-version.js` validates the triggering tag and replaces every distributable manifest version before packaging. The workflow fails before publishing if the tag is not valid SemVer or any test, package drift check, or manifest validation fails.

Manual release runs must target an existing SemVer tag. Running `release.yml` from a branch is expected to fail version validation and cannot publish a branch-named release.
