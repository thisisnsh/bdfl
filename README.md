<h1 align="center">BDFL - Benevolent Dictator For Life</h1>
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

Windows installation is coming soon.

Install only for the current project with `--local`:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/install.sh | bash -s -- --local
```

The installer detects Claude Code and Codex, verifies the release archive checksum, installs one standalone `bdfl` skill per host, registers the shared MCP server directly, and prints every path and setting before mutation. Use `--only claude`, `--only codex`, or `--dry-run` to narrow or preview it. See [INSTALL.md](INSTALL.md) for all options.

## Use cases

| When your task looks like this | What BDFL does |
|---|---|
| A feature spans API, UI, tests, and docs | Splits independent ownership into parallel isolated worktrees. |
| A long task keeps crowding the main conversation | Moves execution details and provider streams out of the parent context. |
| Several agents may touch nearby files | Detects overlap and serializes conflicting ownership. |
| An agent needs clarification or wider permission | Suspends it and returns the request to Inbox for your decision. |
| A plan changes after review | Records every revision and lets you choose the version to execute. |
| Completed branches need a safe landing path | Reviews per task, validates the batch on a temporary branch, then asks before integration. |
| A previous run crashed or was interrupted | Offers Continue, Manage tasks, Archive run, or Cancel run without choosing automatically. |

## Try it now

Start from a clean Git worktree. BDFL never activates automatically.

### Claude Code

```text
/bdfl
Build the API and CLI in separate tasks, then validate them together.
/bdfl agents
```

Choose Claude explicitly, then turn BDFL on:

```text
/bdfl models
/bdfl
Refactor authentication while a separate agent updates deterministic tests.
```

### Codex

```text
$bdfl
Split the provider implementation, tests, and documentation into safe parallel tasks.
$bdfl plans
```

Choose Codex explicitly:

```text
$bdfl models
$bdfl
Add the migration, rollback test, and operator documentation.
```

### Ollama

Ollama support is coming soon.

Without a model selection, BDFL defaults to `claude:sonnet:medium`. A choice made through `models` persists for future runs.

## Commands

| Action | Claude Code | Codex |
|---|---|---|
| Turn BDFL on; `on` is the default | `/bdfl [on]` | `$bdfl [on]` |
| Turn BDFL off after active agents resolve | `/bdfl off` | `$bdfl off` |
| List and choose an exact run model | `/bdfl models` | `$bdfl models` |
| Review plan versions, diffs, and approvals | `/bdfl plans` | `$bdfl plans` |
| Inspect and act on tasks | `/bdfl tasks` | `$bdfl tasks` |
| Inspect and act on agents and attempts | `/bdfl agents` | `$bdfl agents` |

There is one command and one skill: `bdfl`. Its optional argument selects a guided management view. Native host planning remains native.

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

## Native management dialogs

Models, Plans, Tasks, Agents, and Inbox use a small MCP server to request structured input from the host. Claude Code and Codex render those requests with their native controls; BDFL does not ask the model to write a numbered list or depend on a standalone terminal UI.

- `/bdfl models` or `$bdfl models` renders the complete configured model list.
- `/bdfl plans` or `$bdfl plans` renders captured plan versions, or `No plans.`
- `/bdfl tasks` or `$bdfl tasks` renders readable task titles and statuses.
- `/bdfl agents` or `$bdfl agents` renders agents using their task titles, or `No agents.`
- Agent questions with options render as a selector; free-form questions render as text input; permission requests render explicit Approve/Deny choices.

BDFL compiles the selected plan into an execution manifest with a readable title, exact provider prompt, objective, context, allowed paths, dependencies, exact model, permission mode, validation commands, and completion criteria for every atomic task.

```text
pending → running → waiting → running → review → approved → validating → integrated
                    ↘ failed / cancelled / rewound → fresh attempt
```

## Models

Model specifications use `provider:exact-model:exact-effort`.

Run `/bdfl models` or `$bdfl models`. The MCP tool passes the complete configured list to the host-native selector, so it is not limited by Claude Code's four-option question-tool schema.

```json
{
  "version": 1,
  "defaultModel": "claude:sonnet:medium",
  "models": [
    "claude:sonnet:medium",
    "claude:opus:medium",
    "claude:haiku:medium",
    "codex:gpt-5.6-sol:medium"
  ],
  "maxAgents": 4
}
```

Preflight checks the executable, authentication surface, exact allowlisted model, endpoint, and effort. A failure becomes a visible task state; BDFL never silently substitutes another model. See [Model providers](docs/MODEL-PROVIDERS.md).

## Permission and recovery guarantees

- Parent permissions are preserved; parent plan mode maps to ordinary default execution permissions.
- Agents cannot infer answers or broaden permission.
- A dirty main worktree blocks dispatch until you clean it, authorize a recoverable snapshot, or cancel.
- Unfinished state always offers Continue, Manage tasks, Archive run, or Cancel run.
- Rewind retains prior branches, logs, events, checkpoints, and session IDs.
- Agent work never merges directly into `main`.

Read [Permissions](docs/PERMISSIONS.md) and [Recovery](docs/RECOVERY.md) for the full contract.

## How it works

```text
host request → plan revisions → selected plan → execution manifest
             → isolated task worktrees → inbox/review → integration branch
             → batch validation → explicit integration
```

Canonical runtime code lives in `src/` and the canonical Codex skill lives in `skills/bdfl/`. Deterministic packaging keeps release artifacts in sync; CI fails when packaged files drift.

## Privacy and limitations

BDFL has no persistent status line or session-start hook. It stores local run state, worktrees, normalized events, and logs under gitignored `.bdfl/`. Provider prompts and code go only through the configured Claude or Codex harness. BDFL runs no telemetry service and does not copy authentication tokens into project state. Real-provider smoke tests are opt-in, and no benchmark or reliability claim is published without reproducible measurements.

## Uninstall

Remove the global installation and restore recorded host settings:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/uninstall.sh | sh
```

Windows uninstallation is coming soon.

For a project-local installation:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/uninstall.sh | sh -s -- --local
```

Add `--purge` only when you also want to permanently delete the current project's `.bdfl/` run state and recovery worktrees. Uninstall removes only receipt-owned skills, runtime files, and MCP registrations, then restores replaced paths and settings captured during installation.

## Project

[Contributing](CONTRIBUTING.md) · [Documentation](docs/ARCHITECTURE.md) · [Release guide](RELEASE.md) · [Open an issue](https://github.com/thisisnsh/bdfl/issues) · [Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [MIT license](LICENSE)
