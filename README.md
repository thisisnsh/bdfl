# BDFL

## Benevolent Delegator for LLMs

**Plan deliberately. Build in parallel. Stay in control.**

BDFL is a foreground terminal supervisor for Claude Code, Codex, and Ollama-backed Codex sessions. You work with one read-only planning agent, approve the plan, and let isolated workers implement it while BDFL handles scheduling, checks, review, integration, and recovery.

### 🙂 BDFL also stands for [Benevolent Dictator for Life](https://en.wikipedia.org/wiki/Benevolent_dictator_for_life)

That open-source title is the joke. In this project, BDFL is the **delegator**: it coordinates work but does not quietly write code or overrule your approvals.

## 🧭 Index

- [Quick start](#-quick-start)
- [How it works](#-how-it-works)
- [Why BDFL](#-why-bdfl)
- [Choose your agents](#-choose-your-agents)
- [Inside the terminal](#-inside-the-terminal)
- [Safety](#-safety-by-default)
- [Sessions and recovery](#-sessions-that-survive-restarts)
- [Commands](#-commands)
- [Project docs](#-project-docs)
- [Roadmap](#-roadmap)

## ⚡ Quick start

You need macOS or Linux, Node.js 20+, Git, and either an authenticated `claude` or `codex` CLI, or Ollama 0.18+ with a current Codex CLI.

```bash
npm install --global @thisisnsh/bdfl
cd your-git-repository
bdfl
```

The first-run wizard lets you choose the planning agent, worker agent, models, effort levels, optional CLI arguments, and a worker capacity from 1–5.

### Try a small local Ollama model

Install and start [Ollama](https://ollama.com/download), then install Codex and pull a compact test model:

```bash
npm install --global @openai/codex
ollama pull qwen3:4b
bdfl
```

On Linux, run `ollama serve` in another terminal if the service is not already running. In **New**, choose **Ollama** for either agent role and enter `qwen3:4b` as the model ID. BDFL intentionally does not ship an Ollama model list; any local or Ollama Cloud model ID can be entered manually.

`qwen3:4b` is about 2.5 GB and is useful for checking the integration on modest hardware. Treat it as a smoke-test model, not the quality baseline for multi-step planning and implementation.

> [!TIP]
> Press `Ctrl+]` to switch between BDFL controls and the selected agent. When an agent has focus, its arrow keys and `Ctrl+C` work normally.

<details>
<summary>Use the latest staging build</summary>

Every successful `main` build is published under the npm `staging` tag without moving `latest`.

```bash
npm install --global @thisisnsh/bdfl@staging
```

</details>

## 🧠 How it works

`Talk → Plan → Approve → Build → Review → Verify → Integrate`

1. **Talk** with a planning agent that can inspect the repository but cannot edit it.
2. **Plan** with shared decisions, owned paths, dependencies, locks, local checks, and global validation.
3. **Approve** clean Markdown sections in BDFL. Each approval is bound to that section's exact version and SHA.
4. **Build** only the eligible chunks. Each worker gets an isolated Git branch, worktree, and focused context.
5. **Review** the actual diff, changed paths, checks, and commit metadata. Accept it or send feedback to the same worker.
6. **Verify** the consolidated result with global checks and a fresh read-only verifier.
7. **Integrate** only if the original branch, HEAD, and worktree are still unchanged.

## 🎯 Why BDFL

- **The planner stays a planner.** All implementation and repair work belongs to workers.
- **Parallelism follows the plan.** Capacity is a ceiling, not a request to invent filler tasks.
- **Dependencies are real.** A dependent worker starts from accepted predecessor work.
- **File ownership is enforced.** Unsafe overlapping work is rejected before execution; out-of-scope changes fail validation.
- **Management stays native.** Plans, sessions, diffs, checks, and reviews live in the terminal UI instead of being repeatedly narrated by a model.
- **Recovery is built in.** Provider resume IDs, profiles, worktrees, terminal snapshots, and execution state persist locally.

## 🧑‍💻 Choose your agents

Claude, Codex, and Ollama-backed Codex sessions can be mixed independently between planning and worker roles. Any provider can also fill both roles.

Planning and worker profiles are independent, and each can use a built-in choice or a custom model ID. Worker access is fixed to workspace-write inside its isolated worktree; planning and verification remain read-only.

<details>
<summary>What BDFL adds to an agent session</summary>

- The `bdfl-plan` skill is injected only into the planning session.
- A session-scoped MCP bridge exposes only the tools allowed for that role.
- BDFL owns model, effort, permission, resume, MCP, provider/profile, hook, and role flags.
- Extra CLI arguments are parsed as argv without launching a shell.

See [Model providers](docs/MODEL-PROVIDERS.md) and [Permissions](docs/PERMISSIONS.md) for the complete contract.

</details>

## 🖥️ Inside the terminal

The terminal keeps planning agents, workers, and native pages on one navigation rail. You can move among **New**, **Plans**, **Sessions**, **Review**, **Close**, and **Quit** without leaving the foreground supervisor.

<details>
<summary>Navigation and attention</summary>

- Use Left/Right to move across agent badges and Enter to focus the selection.
- `*` marks the exact agent waiting for attention; focusing that agent clears it.
- Planning agents are named `Claude 1`, `Codex 1`, `Ollama 1`, and so on. Their workers are `W 1`, `W 2`, and so on.
- Sessions can rename agents and reopen closed workstreams.
- Mouse-wheel input scrolls only the focused provider. Hold your terminal's mouse-bypass modifier, usually Shift, to select text.

</details>

<details>
<summary>Close, quit, and terminal behavior</summary>

- **Close** stops every live provider in the selected workstream and hides it without deleting its saved identity or history.
- **Quit** gracefully stops all provider processes and restores them when BDFL starts again.
- The alternate screen restores your previous terminal scrollback on exit.
- Startup and fatal failures restore the terminal before printing a stable error code and readable message.

</details>

## 🛡️ Safety by default

- `.bdfl/` is repository-local, ignored by Git, and may contain sensitive prompts, plans, snapshots, diffs, and worktrees.
- A workspace lock prevents two supervisors from mutating the same durable state.
- Custom profile commands cannot use arbitrary executables, shell operators, environment prefixes, headless flags, or BDFL-owned flags.
- Worker results are checked against approved paths and deterministic argv-based commands.
- Integration conflicts go to an isolated worker, never to the planning agent or target branch.
- Final integration stops when the original target has changed or become dirty.

## 🔄 Sessions that survive restarts

BDFL is a foreground process, but the work is durable. Native plan and review pages rebuild from local files, while provider sessions resume through their saved Claude or Codex identity. Ollama sessions retain the underlying Codex identity and resume it through the Ollama launcher.

<details>
<summary>What is saved under .bdfl/</summary>

Workspace configuration, session records, immutable plan versions, approvals, executions, worker contexts, events, branches, worktrees, and terminal snapshots.

Treat this directory as sensitive. Never commit it, and inspect its recovery data before deleting it manually.

</details>

Read [Recovery](docs/RECOVERY.md) before removing local state or repairing an interrupted session.

## ⌨️ Commands

```bash
bdfl                 # open the foreground supervisor
bdfl status          # count saved sessions and active agents
bdfl --version       # print the installed version
bdfl help            # show usage and terminal controls
```

## 🧰 Project docs

- [Installation](INSTALL.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Permissions](docs/PERMISSIONS.md)
- [Recovery](docs/RECOVERY.md)
- [Model providers](docs/MODEL-PROVIDERS.md)
- [Security policy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Release guide](RELEASE.md)

## 🚧 Roadmap

Planned providers, platform support, measurement work, and UX improvements live in [TODO.md](TODO.md).

[Support](SUPPORT.md) · [Code of Conduct](CODE_OF_CONDUCT.md) · [MIT License](LICENSE)
