<img src="docs/assets/bdfl-logo.png" alt="BDFL logo" width="100">

# BDFL - Benevolent Delegator for LLMs

**Plan deliberately. Build in parallel. Stay in control.**

BDFL is a terminal supervisor for Codex, Claude Code, and Ollama-backed Codex sessions. Work with a planning agent, compare and approve versioned plans or parts of it, then let isolated worker agents implement the approved work while BDFL handles scheduling, checks, review, verification, integration, and recovery.

_BDFL also stands for [Benevolent Dictator for Life](https://en.wikipedia.org/wiki/Benevolent_dictator_for_life). In this project, BDFL delegates the work to LLMs. Hence the name!_

## Index

- [Quick start](#quick-start)
- [Features](#features)
- [Terminal tour](#terminal-tour)
- [Suggested workflow](#suggested-workflow)
- [Commands](#commands)
- [Project docs](#project-docs)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

<a id="quick-start"></a>
## ⚡ Quick start

You need macOS or Linux _(Windows Soon)_, Node.js 20+, Git, and at least one supported agent CLI installed and authenticated.

```bash
npm install --global @thisisnsh/bdfl
cd your-git-repository
bdfl
```

The **New** screen lets you choose separate planning and worker agents, models, effort levels, optional CLI arguments, and a worker capacity from 1–5.

### Use with Codex

Install the [Codex CLI](https://developers.openai.com/codex/cli), run it once to sign in, then start BDFL in your Git repository:

```bash
npm install --global @openai/codex
codex
bdfl
```

In **New**, choose **Codex** for the planning agent, worker agent, or both. Each role can use a different model and effort level.

### Use with Claude Code

Install [Claude Code](https://code.claude.com/docs/en/getting-started), run it once to sign in, then start BDFL in your Git repository:

```bash
curl -fsSL https://claude.ai/install.sh | bash
claude
bdfl
```

In **New**, choose **Claude Code** for the planning agent, worker agent, or both. You can also mix Claude Code with Codex or Ollama.

### Use open models with Ollama

Install and start [Ollama](https://ollama.com/download), install Codex, and sign in to Ollama Cloud if you want to use a cloud model:

```bash
npm install --global @openai/codex
ollama signin
bdfl
```

On Linux, run `ollama serve` in another terminal if the service is not already running. In **New**, choose **Ollama** and enter a model ID such as `gpt-oss:120b-cloud`. BDFL uses [Ollama's Codex integration](https://docs.ollama.com/integrations/codex), so a current Codex CLI is required. Cloud models do not require a powerful local GPU; local models stay available through the same setup.

<details>
<summary>Want to use the main branch build?</summary>

Every successful `main` build is published under the npm `staging` tag without moving `latest`.

```bash
npm install --global @thisisnsh/bdfl@staging
```

</details>

<a id="features"></a>
## ✨ Features

- **Mix planning and worker agents.** Use Codex, Claude Code, or Ollama independently for each role, including different models, reasoning effort, and safe extra CLI arguments. BDFL remembers the complete setup as **Last used**.
- **Create deliberate, versioned plans.** Plans have immutable versions, clean shared decisions, worker chunks, and global validation. Compare adjacent versions, approve individual sections, preserve unchanged approvals, unlock sections for revision, and execute any fully approved version.
- **Run dependency-aware work in isolation.** Every worker gets a private Git branch, worktree, and focused context. Independent chunks can run in parallel up to the 1–5 worker limit; prerequisites and named locks keep dependent or conflicting work in order.
- **Enforce the approved scope.** BDFL rejects unsafe overlapping ownership, verifies actual changed paths, and runs deterministic per-chunk checks before a result can be accepted.
- **Review before anything lands.** Inspect each worker's summary, diff, changed paths, checks, and commit metadata. Accept the result or send feedback to the same worker, then review the consolidated result after global checks and a fresh read-only verifier.
- **Integrate cautiously.** Accepted commits are combined in dependency order. Conflicts go to an isolated repair worker, and final integration stops if the original branch, HEAD, or worktree changed.
- **Manage everything in one terminal.** Native **New**, **Plans**, **Sessions**, and **Review** pages sit beside live agent terminals. Attention markers show which agent is waiting, while **Close** and **Quit** preserve recoverable session state.
- **Resume durable workstreams.** Provider identities, profiles, plan lineages, execution state, worktrees, terminal snapshots, agent names, and task context survive restarts under the repository-local `.bdfl/` directory.
- **Keep roles constrained with skills and MCP.** Only the planning session receives the `bdfl-plan` skill. A session-scoped MCP bridge exposes the tools allowed for each role; planning and verification stay read-only while workers can edit only their isolated worktrees.

See [Model providers](docs/MODEL-PROVIDERS.md), [Permissions](docs/PERMISSIONS.md), and [Recovery](docs/RECOVERY.md) for the complete contracts.

<a id="terminal-tour"></a>
## 🖥️ Terminal tour

Press `Ctrl+]` to switch between BDFL controls and the selected agent. When an agent has focus, its arrow keys and `Ctrl+C` work normally.

### Top bar

<img src="docs/assets/bdfl-top-bar.svg" alt="BDFL top bar with New, Plans, Sessions, Review, Close, and Quit actions" width="900">

The top bar provides **New**, **Plans**, **Sessions**, **Review**, **Close**, and **Quit** actions. Availability follows the current workspace: for example, **Plans** and **Review** appear when there is something to open. Use the arrow keys and Enter to navigate.

### Bottom bar

<img src="docs/assets/bdfl-bottom-bar.svg" alt="BDFL bottom bar with planning and worker agent badges" width="900">

The bottom rail holds every open planning agent and worker. Square badges identify planning agents, round badges identify workers, and `*` marks the exact agent waiting for attention. The footer shows the selected agent's last prompt alongside rotating controls and tips.

### New

<img src="docs/assets/bdfl-new-screen.svg" alt="BDFL New screen for configuring planning and worker agents" width="900">

Create a workstream by selecting independent planning and worker providers, models, effort levels, optional arguments, and maximum worker count. Reuse **Last used** or customize a fresh setup; worker access is always limited to edits inside isolated worktrees.

### Plans

<img src="docs/assets/bdfl-plans-screen.svg" alt="BDFL Plans screen with versions and section approvals" width="900">

Browse every durable plan and version, read individual sections, compare a version with its predecessor, approve or unlock exact sections, and execute a fully approved version. An older approved version can still run after an explicit confirmation.

### Sessions

<img src="docs/assets/bdfl-sessions-screen.svg" alt="BDFL Sessions screen with saved planning and worker agents" width="900">

Open running workstreams or resume closed ones with their saved provider identity and configuration. Sessions can be renamed or permanently deleted, and each row shows its provider, state, attention marker, and latest task context.

### Review

Review worker and combined results without leaving the terminal. Worker results can be accepted or returned with feedback; a consolidated result can be integrated only after checks and read-only verification pass.

<details>
<summary>Local state and safety</summary>

- `.bdfl/` is repository-local, ignored by Git, and may contain sensitive prompts, plans, snapshots, diffs, and worktrees. Never commit it.
- A workspace lock prevents two supervisors from mutating the same durable state.
- Custom profile commands cannot use arbitrary executables, shell operators, environment prefixes, headless flags, or BDFL-owned flags.
- **Close** stops and hides the selected workstream without deleting its identity or history. **Quit** gracefully stops all provider processes and restores open workstreams the next time BDFL starts.
- The alternate screen restores your previous terminal scrollback on exit. Startup and fatal failures restore the terminal before printing a stable error code and readable message.

</details>

<a id="suggested-workflow"></a>
## Suggested workflow

`Talk → Plan → Review → Approve → Build → Review → Verify → Integrate`

1. **Talk** with a planning agent that can inspect the repository but cannot edit it.
2. **Plan** shared decisions, owned paths, dependencies, locks, local checks, and global validation.
3. **Review** plan versions, compare diffs, and request revisions where needed.
4. **Approve** exact sections you want to lock. Execution remains blocked until every section in the chosen version is approved.
5. **Build** eligible chunks in isolated branches and worktrees, in parallel where the approved dependency graph allows it.
6. **Review** each worker's actual diff and checks. Accept it or send feedback to that worker.
7. **Verify** the consolidated result with global checks and a fresh read-only agent.
8. **Integrate** only after final review and only while the frozen target remains unchanged and clean.

<a id="commands"></a>
## Commands

```bash
bdfl                 # open the foreground supervisor
bdfl status          # count saved sessions and active agents
bdfl --version       # print the installed version
bdfl help            # show usage and terminal controls
```

<a id="project-docs"></a>
## Project docs

- [Installation](INSTALL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Model providers](docs/MODEL-PROVIDERS.md)
- [Permissions](docs/PERMISSIONS.md)
- [Recovery](docs/RECOVERY.md)
- [Release guide](RELEASE.md)
- [Security policy](SECURITY.md)

<a id="roadmap"></a>
## Roadmap

Planned providers, platform support, measurement work, and UX improvements live in [TODO.md](TODO.md).

[Support](SUPPORT.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [MIT License](LICENSE)

<a id="contributing"></a>
## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, testing, documentation, and pull request guidance.
