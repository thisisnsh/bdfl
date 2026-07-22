<p align="center">
  <img src="docs/assets/bdfl-mark.svg" alt="BDFL" width="128" height="128">
</p>

<h1 align="center">BDFL</h1>

<p align="center"><strong>One architect. A crew of builders. One clean commit.</strong></p>

<p align="center">
  Put Claude Code or Codex in the lead, send approved work to isolated workers,<br>
  and watch the whole plan move through one terminal.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@thisisnsh/bdfl"><img src="https://img.shields.io/npm/v/%40thisisnsh%2Fbdfl?color=facc15" alt="npm version"></a>
  <a href="https://github.com/thisisnsh/bdfl/actions/workflows/ci.yml"><img src="https://github.com/thisisnsh/bdfl/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/thisisnsh/bdfl"><img src="https://img.shields.io/badge/node-%3E%3D20-42ba75" alt="Node 20+"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/thisisnsh/bdfl" alt="MIT license"></a>
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#the-workflow">Workflow</a> ·
  <a href="#why-bdfl">Why BDFL</a> ·
  <a href="#inside-the-terminal">Terminal</a> ·
  <a href="#safety-model">Safety</a> ·
  <a href="RELEASE.md">Releasing</a>
</p>

---

BDFL is a foreground terminal supervisor for serious multi-agent coding. The delegator stays read-only: it talks with you, studies the repository, and produces the smallest useful dependency graph. Workers do the writing in isolated Git worktrees. BDFL owns scheduling, validation, review, consolidation, and recovery.

No daemon. No invisible swarm. No model-generated management noise.

```text
You + read-only delegator
            │
            ▼
     approve clean plan
            │
     ┌──────┴──────────┐
     ▼                 ▼
 worker: API      worker: UI        capacity is a ceiling,
     │                 │             never a worker quota
     └──────┬──────────┘
            ▼
   consolidate → verify → review → one commit
```

## Quick start

Requires macOS or Linux, Node.js 20+, Git, and at least one authenticated CLI: `claude` or `codex`.

```bash
npm install --global @thisisnsh/bdfl
cd your-repository
bdfl
```

The first-run wizard asks for a delegator, a worker profile, and worker capacity from 1–5. Claude can lead Codex workers, Codex can lead Claude workers, or either provider can run both roles.

> [!TIP]
> Press `Ctrl+]` to move between BDFL chrome and the active provider. While provider content has focus, arrow keys and `Ctrl+C` pass straight through.

Want the build from the latest `main` push?

```bash
npm install --global @thisisnsh/bdfl@staging
```

## The workflow

1. **Choose the lead.** Start a session with planning-agent and worker model profiles.
2. **Shape the plan.** BDFL injects `bdfl-plan` only into the read-only delegator. It defines shared decisions, owned paths, real dependencies, locks, local checks, and global validation.
3. **Approve what matters.** Review clean native Markdown section by section. Approvals bind the exact section SHA. Targeted revisions preserve unrelated approvals.
4. **Run only eligible work.** Roots start first. Dependents wait for accepted predecessor commits. Capacity limits active PTYs; it never invents filler chunks.
5. **Review real changes.** BDFL checks actual paths and deterministic commands, then shows the chunk, diff, checks, and commit metadata.
6. **Verify the whole.** A fresh read-only worker sees the consolidated result and runs global validation.
7. **Integrate once.** If the original target is still clean and unchanged, BDFL creates one integration commit.

## Why BDFL

| The usual multi-agent failure | BDFL's answer |
|---|---|
| The coordinator burns context reprinting plans and logs | Native plan, graph, diff, session, and review panes use zero LLM tokens |
| Parallel agents overwrite the same files | Owned paths are validated; unsafe concurrent overlap is rejected |
| “Parallel” tasks secretly need each other's code | `dependsOn` makes accepted commits part of the child's base |
| A four-worker setting creates four nonsense tasks | Capacity is only a scheduler ceiling |
| The planner quietly starts coding | Delegators are read-only; workers own every code change and repair |
| A crash erases the working session | Provider IDs, launch profiles, worktrees, branches, and terminal snapshots persist |
| Integration turns into an opaque merge | Results apply in dependency order and finish as one reviewable commit |

## Inside the terminal

```text
┌─ bdfl 0.1.0 ───────── [New] [Plans] [Sessions] [Review] [Close] [Quit] ┐
│                                                                       │
│                Delegator / Worker / Native pane                       │
│                                                                       │
│                                                                       │
│                                                                       │
│                                                                       │
│                                                                       │
│                                                                       │
└─[Claude 1]-(W 1)-(W 2*) [Codex 1]-(W 1)───────────────────────────────┘
  UI shell — Build the native rail        Tip: Press Ctrl+] to toggle focus between agents and BDFL.
```

- Planning agents and workers share one bottom navigation rail. Use Left/Right to wrap across every badge; Enter or `Ctrl+]` focuses the selected agent.
- `*` marks the exact agent that needs attention. Selection preserves it; only giving that provider focus clears it.
- Planning agents are named `Claude 1`, `Codex 1`, and so on. Workers are numbered independently within their workstream as `W 1`, `W 2`, and so on. **Sessions** can rename either kind of agent.
- The footer shows the selected agent's latest task without repeating its name, and keeps it visible across BDFL/provider focus changes. It stays empty until a task exists. Its right side alternates between the focus shortcut and the GitHub star reminder.
- The terminal tab title follows the selected planning workstream, or the active native New, Plans, Sessions, or Review page. A selected worker keeps its parent planning name in the title.
- **Close** gracefully stops every provider PTY in the active session and hides it without deleting provider resume IDs, models, effort, custom args, or history.
- **Sessions** keeps workstreams grouped and lists every planning and worker agent with its provider, status, and attention marker. A saved task appears only when one exists. Selecting a closed row restores its parent workstream through each provider's resume command.
- **Quit** gracefully stops all provider PTYs but leaves open sessions eligible for automatic restoration the next time `bdfl` starts.
- Wheel and trackpad scrolling works over the visible agent pane even while BDFL owns keyboard focus. Codex uses inline terminal scrollback; mouse-aware Claude Code panes retain their native scrolling behavior and configured speed.
- Startup and fatal failures restore the terminal and show a stable error code, readable message, environment versions, and the GitHub issue link instead of a raw JavaScript stack.
- The alternate screen restores your previous terminal scrollback on exit.

## Safety model

- `.bdfl/` is local, ignored, and may contain sensitive prompts, task snippets, agent names, plans, snapshots, and diffs.
- BDFL never launches a shell for custom profiles. It stores validated argv arrays beginning with `claude` or `codex`.
- Shell operators, environment prefixes, arbitrary executables, headless flags, and BDFL-owned session/MCP/settings flags are rejected. Duplicate model, effort, or permission flags are accepted, then replaced with one canonical BDFL role profile: planning is Claude `plan` or Codex `read-only`; workers are Claude `acceptEdits` or Codex `workspace-write`.
- A single workspace lock prevents two supervisors from writing durable state concurrently.
- Worker results outside approved ownership fail mechanical validation.
- Conflicts go to an isolated integration worker—not the delegator and not the target branch.
- Final integration stops if the original branch, HEAD, or worktree changed.

Read [Permissions](docs/PERMISSIONS.md), [Recovery](docs/RECOVERY.md), [Architecture](docs/ARCHITECTURE.md), and the [Security policy](SECURITY.md) for the deeper contract.

## Commands and channels

```bash
bdfl                 # open the foreground supervisor
bdfl status          # summarize saved sessions and active agents
bdfl --version       # print the installed version
bdfl help            # terminal controls and usage
```

`latest` is the stable npm channel. Every successful `main` push publishes an immutable prerelease to `staging` without moving `latest`. See [RELEASE.md](RELEASE.md) for complete maintainer setup and release steps.

## Coming soon

Ollama and local models · native Windows · Aider · OpenCode · Goose · Gemini CLI · Qwen Code · remote peers and sessions · profile management UI · tiled worker monitoring.

---

<p align="center">
  <strong>Keep the plan thoughtful. Keep the workers accountable.</strong><br>
  <a href="CONTRIBUTING.md">Contribute</a> · <a href="SUPPORT.md">Support policy</a> · <a href="CODE_OF_CONDUCT.md">Code of conduct</a> · <a href="LICENSE">MIT</a>
</p>
