# Architecture

The command skills under `skills/` and runtime under `src/` are canonical. `scripts/package.js` mirrors them into `plugins/bdfl/` and builds a deterministic activation skill archive at `dist/bdfl.skill`; `npm run package:check` rejects drift.

## Runtime flow

1. Host command activates BDFL without changing native plan mode.
2. State recovery checks `.bdfl/state.json` and pauses for an explicit choice when unfinished records exist.
3. Plan revisions are immutable. An approved version feeds the manifest compiler.
4. The compiler validates exact models, permissions, dependency acyclicity, allowed paths, commands, and completion criteria.
5. The scheduler forms parallel waves while serializing overlapping path ownership.
6. Each attempt receives a `.bdfl/worktrees/` Git worktree and `bdfl/<task>-<attempt>` branch.
7. Provider JSONL is normalized and persisted. Questions and permission requests suspend the process and enter Inbox.
8. Approved commits are applied to `bdfl/integration-<run>` by explicit path. Batch validation must pass before `i` is offered.

The parent session is never wrapped. The parent worktree is never used for agent execution, and agent branches never merge directly into `main`.

## Durable data

State uses schema version 1 and atomic temporary-file rename. Records include runs, plans, tasks, agents, inbox items, and append-only events. Rewind marks the prior attempt and creates a fresh attempt from an explicit safe checkpoint.

## Host bridges

Claude Code uses the native marketplace command and plugin installer. Its custom status-line script reads the host's workspace JSON and durable project state, selects a process verb, and animates in yellow at Claude Code's minimum supported one-second refresh interval. Set `BDFL_STATUS_NO_COLOR=1` only when plain status output is required. Codex uses the same dynamic banner at activation and inside the shared TUI at 500 ms; no footer patch or parent wrapper is installed.
