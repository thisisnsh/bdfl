# Publishing BDFL

BDFL publishes only to the public npm registry. `main` produces staging builds; a published GitHub Release produces the stable `latest` build. GitHub Packages is intentionally unused.

## One-time npm setup

1. Use an npm account with two-factor authentication enabled and publish access to the `@thisisnsh` scope.
2. Confirm that the package belongs to the maintainer:

   ```bash
   npm login
   npm whoami
   npm view @thisisnsh/bdfl name version dist-tags
   ```

3. On npmjs.com, open **@thisisnsh/bdfl → Settings → Trusted Publisher → GitHub Actions** and configure:

   | Field | Value |
   |---|---|
   | Organization or user | `thisisnsh` |
   | Repository | `bdfl` |
   | Workflow filename | `release.yml` |
   | Environment | leave blank so the same workflow can publish both channels |

   Under **Allowed actions**, enable **Allow `npm publish`** and leave **Allow `npm stage publish`** disabled. BDFL's staging channel is an immediately installable prerelease dist-tag, not npm's manual staged-publishing queue.

4. Under **Publishing access**, select **Require two-factor authentication and disallow tokens**. OIDC trusted publishers continue to work, while long-lived and granular access tokens cannot publish.

The workflow requests `id-token: write`, uses Node 24 with npm 11.15.0, and publishes with provenance. See npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers/), [staged publishing](https://docs.npmjs.com/staged-publishing/), and [provenance](https://docs.npmjs.com/generating-provenance-statements/) documentation.

## One-time GitHub setup

1. In **Repository settings → Environments**, create `production`.
2. Add required reviewers. Optionally restrict deployment branches/tags according to the repository's release policy.
3. Protect `main`: require CI, prevent force pushes, and require review for changes to `.github/workflows/release.yml`.
4. No `NPM_TOKEN` secret is required. The workflow uses GitHub's OIDC identity.

GitHub documents environment reviewers and protection rules in [Managing environments for deployment](https://docs.github.com/actions/deployment/targeting-different-environments/managing-environments-for-deployment).

## Staging releases

Every successful push to `main` runs tests and publishes:

```text
0.1.0-staging.<run-number>.<run-attempt>.<short-sha>
```

The version receives the npm `staging` tag. `latest` is untouched. The tarball and SHA-256 report remain as GitHub Actions artifacts for 14 days; no staging GitHub Release is created.

Verify a staging publication:

```bash
npm view @thisisnsh/bdfl dist-tags
npm view @thisisnsh/bdfl@staging version --json
npm install --global @thisisnsh/bdfl@staging
bdfl --version
```

## Production release

The GitHub Release tag is the only production version source. Do not edit `package.json` or `package-lock.json`, create a version commit, or run `npm publish` locally.

Once the desired code and documentation are already on `main`, create a **published** GitHub Release targeting that exact commit. Choose the stable version only in the `v`-prefixed tag:

   ```bash
   gh release create v0.2.0 --target main --title "BDFL 0.2.0" --generate-notes
   ```

Approve the `production` environment deployment after checking the tag, target commit, and generated notes. That is the entire recurring release procedure.

The workflow then:

1. Validates that the release tag is stable `v`-prefixed SemVer and that its commit is reachable from `main`.
2. Derives `0.2.0` from `v0.2.0`.
3. Ephemerally stamps both `package.json` and `package-lock.json` inside each Actions runner. No generated version change returns to Git.
4. Tests the stamped package on Node 20/22/current.
5. Waits for the protected `production` approval.
6. Packs and publishes that exact derived version under npm `latest` with provenance.
7. Attaches:

- npm tarball
- SHA-256 report
- CycloneDX SBOM
- support policy

## Post-release verification

```bash
npm view @thisisnsh/bdfl version dist-tags time --json
npm view @thisisnsh/bdfl@latest dist.integrity dist.shasum --json
npm install --global @thisisnsh/bdfl@latest
bdfl --version
gh release view v0.2.0
```

Confirm that `latest` changed only for the production release and that the previous `staging` build is still addressable.

## Failure and rollback

- **Checks fail:** fix forward on `main`; do not publish manually around CI.
- **Environment approval denied:** the npm package remains unchanged; correct the release/tag and publish a new GitHub Release.
- **npm publish fails:** use the same workflow run only if npm confirms the version was not published. npm versions are immutable.
- **Bad stable release:** publish a corrected patch version. Deprecate the bad version through an authenticated maintainer session if needed; BDFL stores no separate deprecation token.
- **GitHub assets fail after npm succeeds:** rerun or attach evidence without republishing the immutable npm version.

Never rewrite an existing release tag or reuse a published npm version. To ship another build, create a new GitHub Release with a new stable version tag.
