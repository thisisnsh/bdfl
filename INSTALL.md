# Installation

BDFL requires Node.js 20+ and at least one supported host: Claude Code or Codex. Ollama is optional.

## Bootstrap

macOS, Linux, WSL, or Git Bash:

```bash
curl -fsSL https://raw.githubusercontent.com/thisisnsh/bdfl/main/install.sh | bash
```

Windows PowerShell:

```powershell
irm https://raw.githubusercontent.com/thisisnsh/bdfl/main/install.ps1 | iex
```

Both bootstraps download a pinned release archive and `checksums.txt`, verify SHA-256 before extraction, and run `bin/install.js` from the verified archive.

## Options

```text
--dry-run             Print every mutation without writing
--list                List detected hosts and target paths
--only claude         Install only Claude Code when detected
--only codex          Install only Codex when detected
--force               Replace an existing unmanaged BDFL path
--uninstall           Remove BDFL and restore recorded settings
--no-color            Disable installer colors
--non-interactive     Never prompt
```

Pass shell options after `bash -s --`, for example:

```bash
curl -fsSL https://raw.githubusercontent.com/thisisnsh/bdfl/main/install.sh | bash -s -- --dry-run --only codex
```

For a source checkout, run `node bin/install.js --dry-run`, inspect every path, then rerun without `--dry-run`.

## Paths and settings

The installer prints all paths before use. Defaults are:

| Host | Files |
|---|---|
| Claude Code | `~/.claude/plugins/marketplaces/bdfl`, `~/.claude/settings.json` status line and enabled plugin entry |
| Codex | `~/.agents/plugins/plugins/bdfl`, `~/.agents/plugins/marketplace.json` personal entry |
| BDFL | Platform config directory `install.json` receipt and `settings.json` |

Environment overrides: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `AGENTS_HOME`, and `BDFL_CONFIG_HOME`.

## Update and verify

Rerun the same pinned installer. Managed files update in place while the original pre-BDFL host settings stay in the installation receipt for uninstall. Use `--force` only when adopting an existing unmanaged target.

```bash
node bin/install.js --list
node bin/install.js --dry-run
npm test
npm run validate
unzip -t dist/bdfl.skill
```

## Uninstall

```bash
node bin/install.js --uninstall
```

The installer removes only the exact managed plugin paths and restores the host JSON captured before the first installation. Project `.bdfl/` directories contain recoverable run state and are intentionally not deleted.

## Troubleshooting

- “Neither Claude Code nor Codex was detected”: install a host and ensure its executable is on `PATH`.
- “Existing unmanaged path requires --force”: inspect the printed target; rerun with `--force` only if BDFL may replace it.
- “Checksum verification failed”: stop. Redownload from the release page; do not bypass verification.
- Model preflight failures: check host authentication, exact allowlisted model, effort support, and `ollamaBaseUrl`.
- Unfinished state prompt: choose resume, inspect, archive, or cancel. Removing files manually can destroy recovery information.

