# Architecture

The runtime under `src/` is canonical; `plugins/bdfl/runtime/` is its generated mirror. `scripts/package.js` builds deterministic release artifacts, and `npm run package:check` rejects drift.

## Runtime flow

1. Host command activates BDFL without changing native plan mode.
2. State recovery checks `.bdfl/state.json` and pauses for an explicit choice when unfinished records exist.
3. Silent host hooks write immutable plan revisions to `.bdfl/plans/`. An approved version feeds the manifest compiler.
4. The compiler validates exact models, permissions, dependency acyclicity, allowed paths, commands, and completion criteria.
5. The scheduler forms parallel waves while serializing overlapping path ownership.
6. Each attempt receives a `.bdfl/worktrees/` Git worktree and `bdfl/<task>-<attempt>` branch.
7. Provider JSONL is normalized and persisted. Questions and permission requests pause only their agent and surface automatically as attention events.
8. Each completion creates a validated checkpoint commit constrained to declared paths, followed by View/Accept/Decline review.
9. Approved commits are combined in a separate integration worktree. Batch validation and explicit final acceptance precede any main-worktree change.

The parent session is never wrapped. The parent worktree is never used for agent execution, and agent branches never merge directly into `main`.

## Durable data

Runtime state uses schema version 1 and atomic temporary-file rename. Records include runs, tasks, agents, durable unanswered events, integration attempts, and append-only provider events. Plan metadata and Markdown bodies live in the separate atomic `.bdfl/plans/` store. Decline preserves the prior attempt and creates a fresh one.

## Host bridges

Claude Code and Codex load one standalone skill and one directly configured stdio MCP server. The server exposes `bdfl` for guided management, `dispatch` to start and wait, and `continue` for native event decisions. Plan-completion hooks are merged surgically; BDFL installs no session-start hook, status line, footer patch, or parent wrapper.
