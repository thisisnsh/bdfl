# Installation

BDFL — Benevolent Delegator for LLMs — requires Node.js 20+ and at least one supported host: Claude Code or Codex. Ollama support is coming soon.

## Bootstrap

macOS, Linux, or WSL:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/install.sh | bash
```

Windows installation is coming soon.

The bootstrap downloads the latest release archive and `checksums.txt`, verifies SHA-256 before extraction, and runs `bin/install.js` from the verified archive. Set `BDFL_VERSION` (without the leading `v`) to pin a specific release.

The installer displays detected hosts, installation scope, and every planned path before writing. Global installation is the default. It registers one shared MCP server directly and surgically merges startup and plan-completion hooks. Claude's existing command-backed status line is composed with BDFL and restored exactly on uninstall; Codex's footer is unchanged. Restart each installed host, then ask “BDFL status.” Codex presents a one-time hook trust review after installation.

Enable or disable BDFL persistently through the host's MCP settings for the `bdfl` server. BDFL has no `on` or `off` commands. When the host's MCP is disabled, startup notices and plan capture are silent.

To install only for the current project:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/install.sh | bash -s -- --local
```

Local runtime files and the receipt are rooted in the current project.

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
| Claude Code, global | `~/.claude/settings.json` |
| Codex, global | `~/.codex/hooks.json` |
| Claude Code, local | `<project>/.claude/settings.local.json` |
| Codex, local | `<project>/.codex/hooks.json` |
| BDFL | Platform config directory `runtime/`, `install.json` receipt, and `settings.json` |

Environment overrides: `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, `AGENTS_HOME`, and `BDFL_CONFIG_HOME`.

## Update and verify

Rerun the latest installer to update. Managed files update in place while the original pre-BDFL host settings stay in the installation receipt for uninstall. Use `--force` only when adopting an existing unmanaged target.

```bash
node bin/install.js --list
node bin/install.js --dry-run
npm test
npm run validate
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

The uninstaller removes runtime files, MCP registrations, receipt-owned legacy skills, and BDFL hook entries, cleans verified legacy plugin entries, and restores recorded settings without removing unrelated hooks. Project `.bdfl/` directories contain recoverable state and remain by default. Add `--purge` only when that state and recovery data should be permanently deleted.

## Troubleshooting

- “Neither Claude Code nor Codex was detected”: install a host and ensure its executable is on `PATH`.
- “Existing unmanaged path requires --force”: inspect the printed target; rerun with `--force` only if BDFL may replace it.
- “Checksum verification failed”: stop. Redownload from the release page; do not bypass verification.
- Codex hook trust prompt: review the displayed BDFL hook command once; the hook remains disabled until trusted.
- Model preflight failures: check host authentication, exact allowlisted model, and effort support.
- Unfinished state prompt: choose Continue, Manage tasks, Archive run, or Cancel run. Removing files manually can destroy recovery information.
