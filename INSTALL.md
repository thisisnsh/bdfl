# Install BDFL

## Requirements

- macOS or Linux. Native Windows support is planned.
- Node.js 20 or newer.
- Git.
- Claude Code, Codex, or both, installed and authenticated with their native CLI.

## Stable channel

```bash
npm install --global bdfl
bdfl --version
cd /path/to/a/git-repository
bdfl
```

## Staging channel

Every successful `main` build publishes an immutable prerelease under the npm `staging` tag:

```bash
npm install --global bdfl@staging
npm view bdfl dist-tags
```

Staging does not move `latest`. Return to stable with `npm install --global bdfl@latest`.

## Update or remove

```bash
npm update --global bdfl
npm uninstall --global bdfl
```

Uninstalling the package does not delete repository-local `.bdfl/` state. Remove that directory manually only after confirming that its plans, sessions, worktrees, and recovery data are no longer needed.

## Troubleshooting

- `bdfl: command not found`: inspect `npm prefix --global` and ensure its binary directory is on `PATH`.
- Provider fails to start: run `claude --version` or `codex --version`, then check authentication with that provider.
- Another supervisor owns the workspace: close the other BDFL process before retrying. Remove a stale lock only after confirming no BDFL process is alive.
- Old unreleased state is detected: export anything needed, then use the reset path shown by BDFL. The v1 supervisor does not guess migrations from the old architecture.
- Startup is offline: update checks are nonblocking; the terminal should still open.
