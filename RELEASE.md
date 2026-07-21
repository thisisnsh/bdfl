# Release process

`main` publishes `0.1.0-staging.<run>.<attempt>.<short-sha>` to npm under `staging` and retains package evidence for 14 days. It never creates a GitHub Release or moves `latest`.

Publish a GitHub Release whose tag is exactly `v<package.json version>`. The release commit must be reachable from `main`. After protected `production` approval, the workflow tests Node 20, 22, and current, publishes to public npm using OIDC trusted publishing, and attaches the tarball, SHA-256, CycloneDX SBOM, and support policy. BDFL does not publish to GitHub Packages.
