# Installation

BDFL requires Node.js 20+ and at least one supported host: Claude Code or Codex. Ollama support is coming soon.

## Bootstrap

macOS, Linux, or WSL:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/install.sh | bash
```

Windows installation is coming soon.

The bootstrap downloads the latest release archive and `checksums.txt`, verifies SHA-256 before extraction, and runs `bin/install.js` from the verified archive. Set `BDFL_VERSION` (without the leading `v`) to pin a specific release.

The installer displays detected hosts, installation scope, and every planned path before writing. Global installation is the default. It installs the native BDFL plugin and bundled MCP server for every detected host. Restart each installed host before invoking `/bdfl:bdfl` in Claude Code or `$bdfl:bdfl` in Codex.

To install only for the current project:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/install.sh | bash -s -- --local
```

Claude Code uses its native local plugin scope and `.claude/settings.local.json`. Codex uses the repository marketplace under `.agents/plugins/`. Local installation files and the receipt are rooted in the current project.

## Options

```text
--dry-run             Print every mutation without writing
--list                List detected hosts and target paths
--only claude         Install only Claude Code when detected
--only codex          Install only Codex when detected
--force               Replace an existing unmanaged BDFL path
--uninstall           Remove BDFL and restore recorded settings
--local               Use current-project scope instead of global scope
--purge               With uninstall, also delete current-project .bdfl state
--no-color            Disable installer colors
--non-interactive     Never prompt
```

Pass shell options after `bash -s --`, for example:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/install.sh | bash -s -- --dry-run --only codex
```

For a source checkout, run `node bin/install.js --dry-run`, inspect every path, then rerun without `--dry-run`.

## Paths and settings

The installer prints all paths before use. Defaults are:

| Host | Files |
|---|---|
| Claude Code, global | `~/.claude/plugins/marketplaces/bdfl`, `~/.claude/settings.json` |
| Codex, global | `~/.agents/plugins/plugins/bdfl`, `~/.agents/plugins/marketplace.json` |
| Claude Code, local | `<project>/.bdfl/install/claude`, `<project>/.claude/settings.local.json` |
| Codex, local | `<project>/.agents/plugins/plugins/bdfl`, `<project>/.agents/plugins/marketplace.json` |
| BDFL | Platform config directory `install.json` receipt and `settings.json` |

Environment overrides: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `AGENTS_HOME`, and `BDFL_CONFIG_HOME`.

## Update and verify

Rerun the latest installer to update. Managed files update in place while the original pre-BDFL host settings stay in the installation receipt for uninstall. Use `--force` only when adopting an existing unmanaged target.

```bash
node bin/install.js --list
node bin/install.js --dry-run
npm test
npm run validate
unzip -t dist/bdfl.skill
```

## Uninstall

Global installation:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/uninstall.sh | sh
```

Windows uninstallation is coming soon.

Project-local installation:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/uninstall.sh | sh -s -- --local
```

The original installer remains usable directly:

```bash
node bin/install.js --uninstall
```

The uninstaller removes exact receipt-owned plugin files, native registrations, marketplace entries, and settings for the selected scope. Project `.bdfl/` directories contain recoverable state and remain by default. Add `--purge` only when that state and recovery data should be permanently deleted.

## Troubleshooting

- “Neither Claude Code nor Codex was detected”: install a host and ensure its executable is on `PATH`.
- “Existing unmanaged path requires --force”: inspect the printed target; rerun with `--force` only if BDFL may replace it.
- “Checksum verification failed”: stop. Redownload from the release page; do not bypass verification.
- BDFL commands are missing in Claude Code: run `claude plugin list`, confirm `bdfl@bdfl` is enabled, restart Claude Code, then invoke `/bdfl:bdfl`.
- Model preflight failures: check host authentication, exact allowlisted model, and effort support.
- Unfinished state prompt: choose resume, inspect, archive, or cancel. Removing files manually can destroy recovery information.
