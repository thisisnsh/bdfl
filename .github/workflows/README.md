# GitHub Actions

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | Push and pull request | Tests Node 20, 22, and current; verifies the generated runtime mirror |
| `sync-plugin.yml` | Pull requests changing canonical or mirrored runtime files | Rejects drift between `src/` and `plugins/bdfl/runtime/` |
| `release.yml` staging job | Successful `main` push | Publishes an immutable npm prerelease under `staging` and retains evidence for 14 days |
| `release.yml` production job | Published GitHub Release | Waits for `production` approval, tests supported Node versions, publishes npm `latest`, and attaches release evidence |

The workflow uses npm trusted publishing through GitHub OIDC. It does not require `NPM_TOKEN` and does not publish to GitHub Packages. Complete registry, environment, release, verification, and failure-recovery instructions live in [RELEASE.md](../../RELEASE.md).
