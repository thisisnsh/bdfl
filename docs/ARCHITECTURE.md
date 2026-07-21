# Architecture

BDFL means Benevolent Delegator for LLMs. The runtime under `src/` is canonical; `plugins/bdfl/runtime/` is its generated mirror. `scripts/package.js` builds deterministic release artifacts, and `npm run package:check` rejects drift.

## Runtime flow

1. A management or dispatch call copies a verbatim request that explicitly names BDFL.
2. Dispatch rejects planning-only authorization, fewer than two useful tasks, and unresolved durable work, then creates its run automatically.
3. State recovery checks `.bdfl/state.json` and pauses for an explicit choice when unfinished records exist.
4. Host hooks write immutable plan revisions to `.bdfl/plans/` only while that host's MCP process is live. Approval never authorizes execution.
5. The compiler validates exact models, permissions, dependency acyclicity, allowed paths, commands, and completion criteria.
6. The scheduler forms parallel waves while serializing overlapping path ownership.
7. Each attempt receives a `.bdfl/worktrees/` Git worktree and `bdfl/<task>-<attempt>` branch.
8. Provider JSONL is normalized and persisted. Questions and permission requests pause only their agent and surface automatically as attention events.
9. Each completion creates a validated checkpoint commit constrained to declared paths, followed by View/Accept/Decline review.
10. Approved commits are combined in a separate integration worktree. Batch validation and explicit final acceptance precede any main-worktree change.

The parent session is never wrapped. The parent worktree is never used for agent execution, and agent branches never merge directly into `main`.

## Durable data

Runtime state uses schema version 1 and atomic temporary-file rename. Records include runs, tasks, agents, durable unanswered events, integration attempts, and append-only provider events. Plan metadata and Markdown bodies live in the separate atomic `.bdfl/plans/` store. Decline preserves the prior attempt and creates a fresh one.

## Host bridges

Claude Code and Codex use one directly configured stdio MCP server; no BDFL command skill is installed. The server exposes `bdfl` for guided management, `dispatch` to start and wait, and `continue` for native event decisions. Host/PID presence records gate startup notices and plan capture. Session-start and plan hooks are merged surgically. Claude receives a composed command-backed status line that preserves the user's command; Codex's fixed footer is unchanged.
