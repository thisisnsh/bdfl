# Releasing BDFL

Releases are built by [the release workflow](.github/workflows/release.yml) from an immutable, `v`-prefixed SemVer tag such as `v1.2.3`. The workflow takes the version from that tag, stamps the package and plugin manifests, rebuilds packaged sources, validates the repository, and publishes checksummed assets to GitHub Releases.

Do not edit release versions in source manifests. They intentionally use `0.0.0-development` between releases.

## 1. Choose the version

Use [Semantic Versioning](https://semver.org/):

- Patch, `v1.2.3`: backward-compatible fixes.
- Minor, `v1.3.0`: backward-compatible functionality.
- Major, `v2.0.0`: incompatible behavior or installation changes.
- Prerelease, `v2.0.0-rc.1`: release candidate or other preview.

Set a shell variable without the leading `v`:

```bash
bdfl_release_version=1.2.3
```

Confirm that the tag is not already published:

```bash
git fetch origin --tags
git tag --list "v${bdfl_release_version}"
git ls-remote --tags origin "refs/tags/v${bdfl_release_version}"
```

Both tag checks should print nothing.

## 2. Prepare `main`

Release only a reviewed commit already on `origin/main`:

```bash
git switch main
git pull --ff-only origin main
git status --short
```

The tracked worktree must be clean. Do not include local runtime state, agent worktrees, credentials, or unrelated files in a release commit.

Review the commits and user-facing changes since the previous release:

```bash
git describe --tags --abbrev=0
git log --oneline "$(git describe --tags --abbrev=0)..HEAD"
```

For the first release, inspect the full history instead:

```bash
git log --oneline --reverse
```

## 3. Run the release checks

Use Node.js 20 or newer, then rebuild canonical package mirrors and run every local gate:

```bash
node --version
npm run package
git diff --exit-code
npm test
npm run validate
sh -n install.sh
sh -n uninstall.sh
```

`npm run package` must leave no diff. If it changes tracked files, review and commit those changes before continuing.

Optionally verify what the tag-stamping step will accept without changing the repository:

```bash
node -e "const { normalizeVersion } = require('./scripts/set-release-version'); console.log(normalizeVersion('v${bdfl_release_version}'))"
```

## 4. Create and push the tag

Confirm that `HEAD` exactly matches the remote branch, then create an annotated tag:

```bash
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git tag -a "v${bdfl_release_version}" -m "BDFL v${bdfl_release_version}"
git show --no-patch "v${bdfl_release_version}"
git push origin "v${bdfl_release_version}"
```

Pushing the tag starts `.github/workflows/release.yml`. Do not move or recreate a published release tag.

## 5. Monitor the workflow

Open the release workflow in GitHub Actions or use GitHub CLI:

```bash
gh run list --workflow release.yml --limit 5
bdfl_release_run_id="$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
gh run watch "$bdfl_release_run_id" --exit-status
```

The workflow must complete all of these stages:

1. Read and validate the SemVer tag.
2. Stamp package and plugin manifest versions.
3. Rebuild the packaged plugin runtime.
4. Run tests and repository validation.
5. Build archives and SHA-256 checksums.
6. Publish the GitHub release and assets.

If a job fails before publishing, fix the underlying commit and issue a new version. Do not force-update the failed tag unless it was never shared or published.

## 6. Verify the published release

Confirm the release points to the intended commit and contains every expected asset:

```bash
gh release view "v${bdfl_release_version}"
gh release view "v${bdfl_release_version}" --json tagName,targetCommitish,url,assets
```

Expected assets:

- `install.sh`
- `install.ps1`
- `uninstall.sh`
- `uninstall.ps1`
- `bdfl.tar.gz`
- `bdfl.zip`
- `checksums.txt`

Download and verify all assets in a temporary directory:

```bash
bdfl_release_dir="$(mktemp -d)"
gh release download "v${bdfl_release_version}" --dir "$bdfl_release_dir"
(cd "$bdfl_release_dir" && shasum -a 256 -c checksums.txt)
unzip -t "$bdfl_release_dir/bdfl.zip"
```

Check that the archive contains the tag-derived version:

```bash
tar -xOf "$bdfl_release_dir/bdfl.tar.gz" ./package.json \
  | node -e "let value=''; process.stdin.on('data', chunk => value += chunk).on('end', () => console.log(JSON.parse(value).version))"
```

The printed value must equal `$bdfl_release_version`, never `0.0.0-development`.

## 7. Smoke-test installation

Run the pinned installer in dry-run mode on at least one detected host:

```bash
curl -fsSL "https://github.com/thisisnsh/bdfl/releases/download/v${bdfl_release_version}/install.sh" \
  | BDFL_VERSION="$bdfl_release_version" bash -s -- --dry-run
```

On Windows PowerShell:

```powershell
$BdflReleaseVersion = "1.2.3"
$env:BDFL_VERSION = $BdflReleaseVersion
& ([scriptblock]::Create((irm "https://github.com/thisisnsh/bdfl/releases/download/v$BdflReleaseVersion/install.ps1"))) --dry-run
Remove-Item Env:BDFL_VERSION
```

Verify that the latest-release links resolve to the same release:

```bash
curl -fsSIL https://github.com/thisisnsh/bdfl/releases/latest/download/install.sh
curl -fsSIL https://github.com/thisisnsh/bdfl/releases/latest/download/checksums.txt
```

## 8. Finish the release

Review the generated GitHub release page and add concise notes covering:

- User-visible changes.
- Installation or configuration changes.
- Compatibility or migration requirements.
- Fixed security issues, without disclosing unpatched exploit details.
- Known limitations.

Then confirm the release badge, latest installer links, and release page in [README.md](README.md) resolve correctly.

## Failed or bad releases

- Build failure before publication: fix forward on `main`, choose a new version, and tag the corrected commit.
- Missing or corrupt asset: keep the release unavailable until all checksums and downloads pass; rerun only from the original immutable tag.
- Functional regression after publication: document the problem on the release, publish a corrected patch release, and direct users to it.
- Compromised artifact or credential: follow [SECURITY.md](SECURITY.md), remove unsafe assets from public access, rotate affected credentials, and publish a clean replacement release.

Never silently move a published tag to another commit. Release tags and checksums are part of the software supply-chain record.

For workflow-specific behavior and asset details, see [.github/workflows/README.md](.github/workflows/README.md).
