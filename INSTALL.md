# Install BDFL

## Requirements

- macOS or Linux. Native Windows support is planned.
- Node.js 20 or newer.
- Git.
- tmux 3.2 or newer, installed by the operating system package manager.
- At least one agent path: Claude Code or Codex installed and authenticated, or Ollama 0.18+ running with a current Codex CLI installed.

For Ollama Cloud:

```bash
npm install --global @openai/codex
ollama signin
```

Start the Ollama app, or run `ollama serve` in another terminal on Linux. Then launch BDFL, choose **Ollama**, select **Type a model ID…**, and enter `gpt-oss:20b-cloud` for the planning or worker model. It runs on Ollama's free cloud tier without downloading a local model.

Install tmux before BDFL. On macOS use `brew install tmux`. On Debian or Ubuntu use `sudo apt install tmux`; on Fedora use `sudo dnf install tmux`; use the equivalent system package on other Linux distributions. Confirm the installed version with `tmux -V`. See the [official tmux installation guide](https://github.com/tmux/tmux/wiki/Installing) for other platforms and package managers.

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
- `TMUX_REQUIRED` or `TMUX_TOO_OLD`: install tmux 3.2 or newer with the platform command above. BDFL never joins or changes your normal tmux server.
- Provider fails to start: run `claude --version`, `codex --version`, or `ollama --version`. For Ollama, also confirm the service is running, Codex is current, and `ollama run <model-id>` succeeds.
- Another supervisor owns the workspace: close the other BDFL process before retrying. Remove a stale lock only after confirming no BDFL process is alive.
- Old unreleased state is detected: export anything needed, then use the reset path shown by BDFL. The v1 supervisor does not guess migrations from the old architecture.
- Startup is offline: update checks are nonblocking; the terminal should still open.
