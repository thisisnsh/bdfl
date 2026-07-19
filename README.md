<p align="center"><img src="docs/assets/terminal-demo.gif" alt="BDFL plan, agent, inbox, and integration workflow" width="760"></p>

<h1 align="center">BDFL — Benevolent Dictator For Life</h1>
<p align="center"><strong>BDFL is commanding...</strong></p>
<p align="center">Protect your main context while managed agents work in isolated branches, return questions to you, and integrate only after review and validation.</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-facc15"></a>
  <a href="https://github.com/thisisnsh/bdfl/releases"><img alt="latest release" src="https://img.shields.io/github/v/release/thisisnsh/bdfl"></a>
  <img alt="Claude Code and Codex" src="https://img.shields.io/badge/hosts-Claude_Code_%7C_Codex-25262b">
  <a href="https://github.com/thisisnsh/bdfl/actions/workflows/ci.yml"><img alt="tests" src="https://github.com/thisisnsh/bdfl/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="last commit" src="https://img.shields.io/github/last-commit/thisisnsh/bdfl">
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#use-cases">Use cases</a> ·
  <a href="#try-it-now">Try it now</a> ·
  <a href="#commands">Commands</a> ·
  <a href="#models">Models</a> ·
  <a href="docs/ARCHITECTURE.md">Architecture</a> ·
  <a href="INSTALL.md">Installation guide</a>
</p>

## Install

Installation is global by default, so BDFL is available in every project for detected hosts.

```bash
# macOS, Linux, WSL, Git Bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/install.sh | bash
```

```powershell
# Windows PowerShell
irm https://github.com/thisisnsh/bdfl/releases/latest/download/install.ps1 | iex
```

Install only for the current project with `--local`:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/install.sh | bash -s -- --local
```

```powershell
& ([scriptblock]::Create((irm https://github.com/thisisnsh/bdfl/releases/latest/download/install.ps1))) --local
```

The installer detects Claude Code and Codex, verifies the release archive checksum, installs each detected native plugin, and prints every path and setting before mutation. Use `--only claude`, `--only codex`, or `--dry-run` to narrow or preview it. See [INSTALL.md](INSTALL.md) for all options.

## Use cases

| When your task looks like this | What BDFL does |
|---|---|
| A feature spans API, UI, tests, and docs | Splits independent ownership into parallel isolated worktrees. |
| A long task keeps crowding the main conversation | Moves execution details and provider streams out of the parent context. |
| Several agents may touch nearby files | Detects overlap and serializes conflicting ownership. |
| An agent needs clarification or wider permission | Suspends it and returns the request to Inbox for your decision. |
| A plan changes after review | Records every revision and lets you choose the version to execute. |
| Completed branches need a safe landing path | Reviews per task, validates the batch on a temporary branch, then asks before integration. |
| A previous run crashed or was interrupted | Offers resume, inspect, archive, or cancel without choosing automatically. |

## Try it now

Start from a clean Git worktree. BDFL never activates automatically.

### Claude Code

```text
/bdfl:activate
Build the API and CLI in separate tasks, then validate them together.
/bdfl:list
```

Choose Claude explicitly:

```text
/bdfl:activate claude:sonnet:medium
Refactor authentication while a separate agent updates deterministic tests.
```

### Codex

```text
$bdfl:activate
Split the provider implementation, tests, and documentation into safe parallel tasks.
$bdfl:list
```

Choose Codex explicitly:

```text
$bdfl:activate codex:gpt-5.6-sol:medium
Add the migration, rollback test, and operator documentation.
```

### Ollama

Ollama runs through the current host's supported local-model harness. Tags containing colons are preserved exactly.

Claude Code:

```text
/bdfl:activate ollama:qwen3.5:9b:medium
Audit this module and add focused regression tests.
```

Codex:

```text
$bdfl:activate ollama:qwen3.5:9b:medium
Audit this module and add focused regression tests.
```

With no model argument, BDFL defaults to `claude:sonnet:medium` when Claude is installed. If Claude is unavailable and Codex is installed, it uses `codex:gpt-5.6-sol:medium`. An explicit configured or command-line model always wins.

## Commands

| Action | Claude Code | Codex |
|---|---|---|
| Activate with an optional exact model | `/bdfl:activate [provider:model:effort]` | `$bdfl:activate [provider:model:effort]` |
| Open Runs, Plans, Tasks, Agents, Inbox, and Models | `/bdfl:list` | `$bdfl:list` |
| Show commands, keys, models, permissions, and recovery | `/bdfl:help` | `$bdfl:help` |
| Deactivate after active agents are resolved | `/bdfl:off` | `$bdfl:off` |

Plugin skills are intentionally explicit and namespaced by the host. There is no BDFL plan command: enter and leave the host's native plan mode normally.

## What you get

| Capability | Guarantee |
|---|---|
| Context protection | Agents use BDFL's shared process protocol rather than the host's parent-session subagent interface. |
| Isolated work | Every attempt gets a `.bdfl/` worktree and branch. |
| Versioned planning | Every revision is retained; you select the execution version. |
| Explicit boundaries | Questions, permissions, recovery, approval, and integration wait for you. |
| Safe scheduling | Dependency cycles fail early and overlapping paths are serialized. |
| Batch integration | Approved work is validated on a temporary integration branch before it is offered. |
| Exact models | Provider, exact model, and effort pass through without silent fallback. |

## Plans, agents, and keys

Plan detail uses up/down to select a revision and left/right to switch between colored diff and full text. Press `a` to select a version. BDFL compiles an execution manifest with objective, context, allowed paths, dependencies, exact model, permission mode, validation commands, and completion criteria for every atomic task.

```text
pending → running → waiting → running → review → approved → validating → integrated
                    ↘ failed / cancelled / rewound → fresh attempt
```

| Key | Action |
|---|---|
| `x` | Stop the highlighted agent. |
| `r` | Rewind from the last safe checkpoint. |
| `f` | Add corrective instructions in a fresh attempt. |
| `a` | Approve the highlighted plan version or completed task. |
| `i` | Integrate a successfully validated batch. |
| `o` | Open the full diff or log. |
| `?` | Show contextual help. |

Left/right changes tabs, up/down selects rows, Enter opens details, and Esc returns. Available keys remain visible in the bottom row.

## Models

Model specifications use `provider:exact-model:exact-effort`. BDFL parses the first and final colon, so `ollama:qwen3.5:9b:medium` passes `qwen3.5:9b` unchanged.

```json
{
  "version": 1,
  "defaultModel": "claude:sonnet:medium",
  "models": [
    "claude:sonnet:medium",
    "claude:opus:medium",
    "claude:haiku:medium",
    "codex:gpt-5.6-sol:medium",
    "ollama:qwen3.5:9b:medium"
  ],
  "maxAgents": 4,
  "ollamaBaseUrl": "http://localhost:11434"
}
```

Preflight checks the executable, authentication surface, exact allowlisted model, endpoint, and effort. A failure becomes a visible task state; BDFL never silently substitutes another model. See [Model providers](docs/MODEL-PROVIDERS.md).

## Permission and recovery guarantees

- Parent permissions are preserved; parent plan mode maps to ordinary default execution permissions.
- Agents cannot infer answers or broaden permission.
- A dirty main worktree blocks dispatch until you clean it, authorize a recoverable snapshot, or cancel.
- Unfinished state always offers `resume`, `inspect`, `archive`, or `cancel`.
- Rewind retains prior branches, logs, events, checkpoints, and session IDs.
- Agent work never merges directly into `main`.

Read [Permissions](docs/PERMISSIONS.md) and [Recovery](docs/RECOVERY.md) for the full contract.

## How it works

```text
host request → plan revisions → selected plan → execution manifest
             → isolated task worktrees → inbox/review → integration branch
             → batch validation → explicit integration
```

Canonical runtime code lives in `src/` and canonical command skills live in `skills/`. Deterministic packaging mirrors them into `plugins/bdfl/`; CI fails when packaged files drift.

## Status, privacy, and limitations

Claude Code's yellow status line appears only while BDFL is active and refreshes once per second, the host's fastest supported interval. Its verb follows durable work state: commanding, strategizing, delegating, orchestrating, executing, awaiting, reviewing, validating, or integrating. Codex cannot accept arbitrary permanent plugin footer text, so it shows the same animated yellow banner during activation and in BDFL's terminal UI without patching or wrapping Codex.

BDFL stores local run state, worktrees, normalized events, and logs under gitignored `.bdfl/`. Provider prompts and code go only through the configured Claude, Codex, or local Ollama harness. BDFL runs no telemetry service and does not copy authentication tokens into project state. Real-provider smoke tests are opt-in, and no benchmark or reliability claim is published without reproducible measurements.

## Uninstall

Remove the global installation and restore recorded host settings:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/uninstall.sh | sh
```

```powershell
irm https://github.com/thisisnsh/bdfl/releases/latest/download/uninstall.ps1 | iex
```

For a project-local installation, append `--local`. Add `--purge` only when you also want to permanently delete the current project's `.bdfl/` run state and recovery worktrees. Uninstall removes only receipt-owned plugin files and restores settings captured during installation.

## Project

[Contributing](CONTRIBUTING.md) · [Documentation](docs/ARCHITECTURE.md) · [Release guide](RELEASE.md) · [Open an issue](https://github.com/thisisnsh/bdfl/issues) · [Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [MIT license](LICENSE)
