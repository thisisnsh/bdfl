# GitHub Actions

| Workflow | Trigger | Purpose |
|---|---|---|
| `ci.yml` | Push and pull request | Tests Node 20, 22, and current; verifies the generated runtime mirror |
| `sync-plugin.yml` | Pull requests changing canonical or mirrored runtime files | Rejects drift between `src/` and `plugins/bdfl/runtime/` |
| `release.yml` staging job | Successful `main` push | Prefixes an immutable npm prerelease with the latest GitHub Release version, publishes it under `staging`, and retains evidence for 14 days |
| `release.yml` production jobs | Published GitHub Release | Derive the package version from the stable release tag, test supported Node versions, wait for `production` approval, publish npm `latest`, and attach evidence |

The workflow uses npm trusted publishing through GitHub OIDC. It does not require `NPM_TOKEN`, a local version edit, or a version commit, and it does not publish to GitHub Packages. Complete registry, environment, release, verification, and failure-recovery instructions live in [RELEASE.md](../../RELEASE.md).
