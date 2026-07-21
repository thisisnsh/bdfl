# BDFL

**Benevolent Delegator for LLMs** — explicit, reviewable delegation for Claude Code and Codex.

[![latest release](https://img.shields.io/github/v/release/thisisnsh/bdfl)](https://github.com/thisisnsh/bdfl/releases)
[![tests](https://github.com/thisisnsh/bdfl/actions/workflows/ci.yml/badge.svg)](https://github.com/thisisnsh/bdfl/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

BDFL turns one explicit delegation request into isolated agent work, native decisions, validated integration, and a final review:

```text
You explicitly ask BDFL
  → BDFL validates two or more atomic tasks
  → agents work in isolated Git worktrees
  → you answer questions and review each result
  → BDFL validates an integration worktree
  → you accept the final integration
```

Plan approval, task complexity, and an apparently splittable request never start BDFL. “BDFL plan this” authorizes planning only. Execution requires a separate request such as “BDFL execute the approved plan.”

## Install

BDFL requires Node.js 20+, Git, and Claude Code or Codex. On macOS, Linux, or WSL:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/install.sh | bash
```

The installer verifies the release checksum, registers the BDFL MCP server with each detected host, and adds host hooks for startup visibility and automatic plan capture. Restart the host after installation. Codex may ask you to trust the installed hooks once.

BDFL availability follows the host’s persistent MCP setting. Use the host’s MCP settings to enable or disable the `bdfl` server; there are no BDFL `on` or `off` commands. When enabled, a new session says:

```text
BDFL — Benevolent Delegator for LLMs — is enabled and ready. It acts only when you explicitly ask BDFL.
```

When disabled or unavailable, BDFL emits no startup notice and captures no plans. Claude Code also shows a composed [`BDFL · ready` status-line segment](https://code.claude.com/docs/en/statusline) while its MCP is live and workflow verbs while work is active. The installer preserves the existing Claude status-line command and options. [Codex’s fixed footer is not modified](https://github.com/openai/codex/issues/20244).

## Ask naturally

No slash command or dollar-prefixed skill is installed. Address BDFL in ordinary language:

```text
BDFL execute the approved plan.
BDFL do this and split it safely between agents.
BDFL plans.
BDFL status.
```

The copied request must contain `BDFL` as a standalone term. Naming BDFL authorizes evaluation, not needless delegation: a small single-stream task stays in the parent host. Dispatch requires at least two useful atomic tasks and automatically creates one workflow run.

Plan capture remains automatic while that host’s BDFL MCP is live. Capturing or approving a plan does not authorize execution.

## Safe delegation

Each task declares an exact prompt, model, permission mode, owned paths, dependencies, validation commands, and completion criteria. Independent tasks may run together; overlapping paths and dependencies are serialized.

Agents never work in the parent worktree. Every attempt gets a dedicated branch and `.bdfl/worktrees/` worktree. Completion is checkpointed, restricted to declared paths, validated, and presented for View, Accept, or Decline. Accepted task commits are combined and validated in a separate integration worktree. Nothing changes the main worktree until you explicitly accept the final integration.

Git is mandatory. BDFL requires an existing absolute Git worktree and never runs `git init` for you.

<details>
<summary>Management requests</summary>

Use natural requests such as:

| Request | Result |
|---|---|
| `BDFL status` | Inspect unfinished work and choose recovery when needed |
| `BDFL models` | Choose an exact discovered model and effort |
| `BDFL plans` | Review captured plans, versions, diffs, and approval |
| `BDFL tasks` | Inspect or cancel tasks |
| `BDFL agents` | Inspect or cancel agents |
| `BDFL help` | Show the authoritative management set |

The MCP management commands are `status`, `models`, `plans`, `tasks`, `agents`, and `help`. The unadvertised `bdfl` executable supports compatible inspection and help only.

</details>

<details>
<summary>Recovery</summary>

If a run is unfinished, `BDFL status` offers Continue, Manage tasks, Archive run, and Cancel run. BDFL never chooses for you and never mixes new dispatch into unresolved work.

Once you explicitly start a workflow, that authorization remains valid through its later questions, permissions, retries, task reviews, and final integration review. You do not need to repeat “BDFL” in every answer. Durable prompts, attempts, events, branches, commits, and worktrees remain available after cancellation or host shutdown.

</details>

<details>
<summary>Models</summary>

BDFL discovers models from installed Claude Code and Codex hosts. Specifications use `provider:exact-model:exact-effort`; no provider, model, endpoint, or effort fallback is invented after discovery or preflight failure.

Ollama provider code exists in the repository, but user-facing Ollama setup remains coming soon.

</details>

<details>
<summary>Local data</summary>

Project state lives under `.bdfl/` and is excluded through `.git/info/exclude`. It includes workflow state, captured Markdown plan versions, provider events, attempt worktrees, and recovery records. Never commit it.

Global runtime, settings, process-presence records, and the installation receipt live in the platform BDFL config directory. Override it with `BDFL_CONFIG_HOME`.

</details>

<details>
<summary>Advanced install options</summary>

Install only for the current project:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/install.sh | bash -s -- --local
```

Preview changes or restrict host detection:

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/install.sh | bash -s -- --dry-run --only codex
```

Supported options include `--dry-run`, `--list`, `--only claude`, `--only codex`, `--force`, `--local`, `--no-color`, and `--non-interactive`. Set `BDFL_VERSION` without a leading `v` to pin a release. Windows installation is coming soon.

See [INSTALL.md](INSTALL.md) for paths and troubleshooting.

</details>

<details>
<summary>Uninstall</summary>

```bash
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/uninstall.sh | sh
```

For a project-local installation, add `-s -- --local`. The uninstaller removes MCP registrations, runtime files, BDFL hook entries, and receipt-owned legacy skills. It restores the exact prior Claude status-line configuration and preserves unrelated host settings. Project `.bdfl/` recovery data remains unless you explicitly add `--purge`.

</details>

## Development

`src/` is the canonical runtime. `plugins/bdfl/runtime/` is generated:

```bash
npm run package
npm test
npm run validate
```

See [ARCHITECTURE.md](docs/ARCHITECTURE.md), [PERMISSIONS.md](docs/PERMISSIONS.md), [RECOVERY.md](docs/RECOVERY.md), and [CONTRIBUTING.md](CONTRIBUTING.md).
