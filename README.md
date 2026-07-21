```text
██████╗ ██████╗ ███████╗██╗
██╔══██╗██╔══██╗██╔════╝██║
██████╔╝██║  ██║█████╗  ██║
██╔══██╗██║  ██║██╔══╝  ██║
██████╔╝██████╔╝██║     ███████╗
╚═════╝ ╚═════╝ ╚═╝     ╚══════╝
```

<h1 align="center"><a href="https://en.wikipedia.org/wiki/Benevolent_dictator_for_life">Benevolent Dictator For Life</a></h1>
<p align="center">The coordinator that strengthens plans and directs isolated agents through explicit review.</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-facc15"></a>
  <a href="https://github.com/thisisnsh/bdfl/releases"><img alt="latest release" src="https://img.shields.io/github/v/release/thisisnsh/bdfl"></a>
  <img alt="Claude Code and Codex" src="https://img.shields.io/badge/hosts-Claude_Code_%7C_Codex-25262b">
  <a href="https://github.com/thisisnsh/bdfl/actions/workflows/ci.yml"><img alt="tests" src="https://github.com/thisisnsh/bdfl/actions/workflows/ci.yml/badge.svg"></a>
</p>

## Explanation

BDFL turns an approved plan or a clear request into a dependency-aware task manifest. Each task gets an isolated Git branch and worktree, an exact model and permission mode, owned paths, validation commands, and completion criteria. Agents can run concurrently when their paths and dependencies allow it.

Questions do not wait in an Inbox. They appear automatically through the host's native controls as soon as an agent needs attention. The same event-driven flow handles permission requests, recoverable failures, task review, and final integration review. Only the affected agent pauses; unrelated work continues.

Git is mandatory. Every BDFL command requires an absolute existing Git worktree. BDFL never runs `git init` for you. Activation adds `.bdfl/` to `.git/info/exclude`, keeping local state, captured plans, attempt worktrees, and recovery records out of commits.

## Install

Global installation for macOS, Linux, WSL, or Git Bash:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/install.sh | bash
```

Project-local installation:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/install.sh | bash -s -- --local
```

The installer verifies the release checksum, detects installed Claude Code and Codex hosts, installs one command skill per host, registers the three-tool MCP server, and merges silent plan-completion hooks with existing host configuration. It installs no status line and no `SessionStart` hook. Codex asks for a one-time trust review when it first sees the hook.

Use `--dry-run`, `--only claude`, or `--only codex` to preview or narrow installation. See [Installation](INSTALL.md) for paths and all options. Windows installation is coming soon.

## Quick start

Open an existing repository, or initialize one yourself:

```bash
git init
```

Then activate BDFL and describe the outcome.

Claude Code:

```text
/bdfl on
Build the API and CLI as independent tasks, then validate them together.
```

Codex:

```text
$bdfl on
Split the provider implementation, tests, and documentation into safe tasks.
```

Native host planning stays native. When a plan is completed, BDFL's silent hook captures it under `.bdfl/plans/`. Rejected proposals and later revisions remain available; leaving and re-entering plan mode starts another plan episode.

## Scheduling lifecycle

```text
request → manifest → isolated task attempts → automatic attention events
        → View / Accept / Decline → newly unblocked dependencies
        → isolated batch integration → View / Accept / Decline → main
```

`dispatch` validates the manifest, starts eligible agents, and waits until one or more need attention. `continue` presents all current events in one native form with independent answers and then resumes only the affected sessions.

- Questions use generated choices when available, otherwise free text.
- Permission requests use explicit Approve/Deny choices.
- Completion reviews use View/Accept/Decline.
- View returns file names, diffstat, and a paginated patch without resolving review.
- Accept approves the task and schedules newly unblocked dependencies immediately.
- Decline requires feedback, preserves the old attempt, and starts a fresh attempt.

After every task is accepted, BDFL combines approved checkpoint commits in a separate integration worktree and runs batch validation. Nothing reaches the main worktree until the final integration review is explicitly accepted.

## Commands

There is one public command skill. No argument means `on`.

| Purpose | Claude Code | Codex |
|---|---|---|
| Activate | `/bdfl on` | `$bdfl on` |
| Deactivate after active work resolves | `/bdfl off` | `$bdfl off` |
| Choose a discovered model and effort | `/bdfl models` | `$bdfl models` |
| Review captured plans and versions | `/bdfl plans` | `$bdfl plans` |
| Inspect or cancel tasks | `/bdfl tasks` | `$bdfl tasks` |
| Inspect or cancel agents | `/bdfl agents` | `$bdfl agents` |
| Show authoritative help | `/bdfl help` | `$bdfl help` |

Runnable Claude Code examples:

```text
/bdfl on
/bdfl off
/bdfl models
/bdfl plans
/bdfl tasks
/bdfl agents
/bdfl help
```

Runnable Codex examples:

```text
$bdfl on
$bdfl off
$bdfl models
$bdfl plans
$bdfl tasks
$bdfl agents
$bdfl help
```

`tasks` and `agents` are on-demand inspection and cancellation views, not polling commands. Agent questions appear automatically. `workflow`, `inbox`, and `capture-plan` are not commands; help returns the real command list if one is attempted.

## Models

Model selection is runtime-discovered and two-step: choose the model first, then one of its supported effort levels.

- Codex models and efforts come from visible entries in `codex debug models`.
- Claude honors configured `availableModels`; otherwise it uses documented built-in aliases and effort levels exposed by the installed CLI.
- Claude-only installations show Claude models, Codex-only installations show Codex models, and dual installations show both.
- Discovery failure invents no fallback. An existing selection is retained only while available; otherwise the invoking host's discovered default is selected.
- User-added model specifications remain in settings separately from discovered entries.

Model specifications use `provider:exact-model:exact-effort`. Provider implementations for Ollama remain in the repository, but Ollama support and setup are coming soon; fresh settings contain no Ollama model.

## Safety and recovery

- Each attempt checkpoints only its allowed paths and runs its task validation before review.
- Main-worktree dirt blocks dispatch instead of being silently captured or overwritten.
- Provider session IDs are retained, and answers resume through supported Claude/Codex continuation commands rather than signals or stdin protocols.
- MCP cancellation or host shutdown marks live processes interrupted and preserves state.
- The next activation offers Continue, Manage tasks, Archive run, or Cancel run. BDFL never chooses recovery for you.
- Prompts, logs, plan bodies, and patches stay out of compact tool results unless their view is explicitly requested.
- Agent branches never merge directly into `main`; accepted work goes through isolated batch integration and validation.

Read [Permissions](docs/PERMISSIONS.md), [Recovery](docs/RECOVERY.md), and [Architecture](docs/ARCHITECTURE.md) for the detailed contracts.

## Uninstall

Global uninstall:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/uninstall.sh | sh
```

Project-local uninstall:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/uninstall.sh | sh -s -- --local
```

The uninstaller removes receipt-owned skills, runtime files, MCP registrations, and only BDFL's hook entries, restoring recorded host configuration while preserving unrelated hooks. `.bdfl/` recovery data remains by default. Add `--purge` only when you intend to permanently delete it.

Windows uninstallation is coming soon.

[Contributing](CONTRIBUTING.md) · [Release guide](RELEASE.md) · [Security](SECURITY.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [MIT license](LICENSE)
