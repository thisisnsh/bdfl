<img src="docs/assets/bdfl-logo.png" alt="BDFL logo" width="100">

# BDFL - Benevolent Delegator for LLMs

**Plan deliberately. Build in parallel. Stay in control.**

BDFL is a terminal supervisor for Codex, Claude Code, and Ollama-backed Codex sessions. Work with a planning agent, compare and approve versioned plans or individual sections, then let isolated worker agents implement the approved work while BDFL handles scheduling, checks, review, verification, integration, and recovery.

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

You need macOS or Linux _(Windows support is planned)_, Node.js 20+, Git, and at least one supported agent CLI installed and authenticated.

```bash
npm install --global @thisisnsh/bdfl
cd your-git-repository
bdfl
```

Next, choose separate planning and worker agents, models, effort levels, optional CLI arguments, and a worker capacity to begin planning and delegating. You need a Git repository before BDFL can execute the plan.

<details>
<summary>Want to use the main branch build?</summary>

Every successful `main` build is published under the npm `staging` tag without moving `latest`.

```bash
npm install --global @thisisnsh/bdfl@staging
```

</details>

### Use with Codex or Claude Code

Install the [Codex CLI](https://developers.openai.com/codex/cli) or [Claude Code](https://code.claude.com/docs/en/getting-started), run it once to sign in, then start BDFL in your Git repository.

Choose **Codex** or **Claude Code** for the planning agent, worker agent, or both. Each role can use a different model and effort level. You can also mix Codex with Claude Code or Ollama.

### Use open models with Ollama

Install and start [Ollama](https://ollama.com/download), install Codex, and sign in to Ollama Cloud if you want to use a cloud model:

```bash
ollama signin
# Pull a local model if you want to use one
ollama pull <model>
bdfl
```

Choose **Ollama** and select an installed model, or enter a model ID such as `gpt-oss:120b-cloud`. BDFL uses [Ollama's Codex integration](https://docs.ollama.com/integrations/codex), so a current Codex CLI is required.

Run `ollama ps` in another terminal to see which models are currently loaded.


<a id="features"></a>
## ✨ Features

#### **Multiple agent configuration**

Use Codex, Claude Code, or Ollama independently for planning and worker roles.

- Configure different models, reasoning-effort levels, and safe additional CLI arguments for each role.

#### **Deliberate, versioned planning**

Plans use immutable versions with shared decisions, worker chunks, and global validation.

- Compare adjacent versions.
- Approve individual sections while preserving approvals for unchanged sections.
- Unlock sections for revision.
- Execute any fully approved plan version.

#### **Dependency-aware, isolated execution**

Each worker receives an isolated, and focused context.

- Independent chunks can run in parallel within the configured worker limit.
- Prerequisites and named locks keep dependent or conflicting work in the correct order.

#### **Review before integration**

Inspect each worker’s summary, diff, changed paths, checks, and commit metadata.

- Accept the result or send feedback to the same worker for revision.
- Review the consolidated result after global checks and a fresh verification pass.

#### **Constrained roles with skills and MCP**

BDFL gives each session role-specific `bdfl` MCP tools, while planning sessions also receive the `bdfl-plan` skill.

- A session-scoped MCP bridge exposes only the tools permitted for each role.
- Planning and verification agents are instructed not to edit; Claude defaults to `manual`, while Codex and Ollama default to a read-only sandbox.
- Workers can edit only their isolated worktrees.

#### **Local state and safety**

BDFL does not publish its local runtime state, metrics, analytics, or logs. Provider traffic still follows the agent and model you choose; use Ollama with a local model for a fully local setup.

- Each repository owns its `.bdfl/` runtime state, which stores session metadata, plans, snapshots, diffs, and worktrees. _Never commit it._
- A parent launch aggregates repository-owned state; it does not move plans or worktrees into the parent directory.
- Coordinator and repository locks prevent two supervisors from mutating the same durable state.
- Custom profile commands cannot use arbitrary executables, shell operators, environment prefixes, headless flags, or BDFL-owned lifecycle flags. Safe provider permission options may override BDFL's role defaults; dangerous access requires `bdfl --dangerous`.

See [Model providers](docs/MODEL-PROVIDERS.md), [Permissions](docs/PERMISSIONS.md), and [Recovery](docs/RECOVERY.md) for the complete contracts.

<a id="terminal-tour"></a>
## 🖥️ Terminal tour

#### Top bar

<img src="docs/assets/bdfl-top-bar.svg" alt="BDFL top bar with New, Plans, Sessions, Review, Close, and Quit actions" width="900">

The top bar provides **New**, **Plans**, **Sessions**, **Review**, **Close**, and **Quit** actions. Availability follows the current workspace: for example, **Plans** and **Review** appear when there is something to plan or review. Use the arrow keys and Enter to navigate.

#### Bottom bar

<img src="docs/assets/bdfl-bottom-bar.svg" alt="BDFL bottom bar with planning and worker agent badges" width="900">

The bottom rail holds every open planning agent and worker. Square badges identify planning agents, round badges identify workers, and `*` marks the exact agent waiting for attention. The footer shows the selected agent's last prompt alongside rotating controls and tips.

#### New Session

<img src="docs/assets/bdfl-new-screen.svg" alt="BDFL New screen for configuring planning and worker agents" width="900">

Create a session by selecting its repository, then independent planning and worker providers, models, effort levels, optional arguments, and maximum worker count. Only Git repositories with at least one commit are selectable. Reuse that repository's **Last used** setup or customize a fresh one; worker access is always limited to edits inside isolated worktrees in the selected repository.

You can also start `bdfl` from a non-Git parent and it discovers committed Git repositories up to two directory levels. The parent view aggregates sessions, plans, and reviews from those repositories. Starting BDFL anywhere inside a repository instead scopes the view to that repository's Git top level.


#### Plans

<img src="docs/assets/bdfl-plans-screen.svg" alt="BDFL Plans screen with versions and section approvals" width="900">

Browse every durable plan and version, read individual sections, compare a version with its predecessor, approve or unlock exact sections, and execute a fully approved version. An older approved version can still run after an explicit confirmation.

#### Sessions

<img src="docs/assets/bdfl-sessions-screen.svg" alt="BDFL Sessions screen with saved planning and worker agents" width="900">

Open running sessions or resume closed ones with their saved provider identity and configuration. Sessions can be renamed or permanently deleted, and each row shows its provider, state, attention marker, and latest task context.

#### Review

Review worker and combined results without leaving the terminal. Worker results can be accepted or returned with feedback; a consolidated result can be integrated only after checks and a fresh verification pass.


<a id="suggested-workflow"></a>
## Suggested workflow

`Talk → Plan → Review → Approve → Build → Review → Verify → Integrate`

1. **Talk** with a planning agent that can inspect the repository but cannot edit it.
2. **Plan** shared decisions, owned paths, dependencies, locks, local checks, and global validation.
3. **Review** plan versions, compare diffs, and request revisions where needed.
4. **Approve** exact sections you want to lock. Execution remains blocked until every section in the chosen version is approved.
5. **Build** eligible chunks in isolated branches and worktrees, in parallel where the approved dependency graph allows it.
6. **Review** each worker's actual diff and checks. Accept it or send feedback to that worker.
7. **Verify** the consolidated result with global checks and a fresh non-implementing agent.
8. **Integrate** only after final review and only while the frozen target remains unchanged and clean.

<a id="commands"></a>
## Commands

```bash
bdfl                 # open the foreground supervisor
bdfl --dangerous     # open with provider approvals and sandboxes bypassed
bdfl status          # count saved sessions and active agents
bdfl --version       # print the installed version
bdfl help            # show usage and terminal controls
```

`--dangerous` applies to every Claude, Codex, and Ollama-backed Codex agent launched or restored during that supervisor run. It passes the provider's native bypass flag, is not persisted, and should be used only in an externally isolated environment. Dangerous provider flags and full-access permission values are rejected from per-agent options.

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

<a id="contributing"></a>
## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, testing, documentation, and pull request guidance.

[Support](SUPPORT.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [MIT License](LICENSE)
