# Install BDFL

## Requirements

- macOS or Linux. Native Windows support is planned.
- Node.js 20 or newer.
- Git.
- At least one agent path: Claude Code or Codex installed and authenticated, or Ollama 0.18+ running with a current Codex CLI installed.

For a small Ollama smoke test:

```bash
npm install --global @openai/codex
ollama pull qwen3:4b
```

Start the Ollama app, or run `ollama serve` in another terminal on Linux. Then launch BDFL, choose **Ollama**, and enter `qwen3:4b` manually for the planning or worker model.

## Stable channel

```bash
npm install --global @thisisnsh/bdfl
bdfl --version
cd /path/to/a/git-repository
bdfl
```

## Staging channel

Every successful `main` build publishes an immutable prerelease under the npm `staging` tag:

```bash
npm install --global @thisisnsh/bdfl@staging
npm view @thisisnsh/bdfl dist-tags
```

Staging does not move `latest`. Return to stable with `npm install --global @thisisnsh/bdfl@latest`.

## Update or remove

```bash
npm update --global @thisisnsh/bdfl
npm uninstall --global @thisisnsh/bdfl
```

Uninstalling the package does not delete repository-local `.bdfl/` state. Remove that directory manually only after confirming that its plans, sessions, worktrees, and recovery data are no longer needed.

## Troubleshooting

- `bdfl: command not found`: inspect `npm prefix --global` and ensure its binary directory is on `PATH`.
- Provider fails to start: run `claude --version`, `codex --version`, or `ollama --version`. For Ollama, also confirm the service is running, Codex is current, and `ollama run <model-id>` succeeds.
- Another supervisor owns the workspace: close the other BDFL process before retrying. Remove a stale lock only after confirming no BDFL process is alive.
- Old unreleased state is detected: export anything needed, then use the reset path shown by BDFL. The v1 supervisor does not guess migrations from the old architecture.
- Startup is offline: update checks are nonblocking; the terminal should still open.
