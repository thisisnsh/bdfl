---
name: bdfl
description: Turn BDFL orchestration on or off for substantial coding work with managed agents, versioned plans, isolated Git worktrees, explicit approvals, and validated integration. Use only when the user explicitly invokes the main BDFL skill, optionally with on or off.
---

# BDFL

## Core workflow

1. Immediately run BDFL's bundled executable at `../../bin/bdfl` relative to this `SKILL.md`; never call bare `bdfl` and do not announce the tool call first. With no argument or `on`, pass exactly `on`. With `off`, pass exactly `off`. Reject every other argument and direct model changes to the Models skill. If the bundled executable is missing, report a broken plugin installation; do not search npm or install a global package.
2. Activate without changing the host's native planning mode.
3. Inspect `.bdfl/` for unfinished state. Ask the user to resume, inspect, archive, or cancel; make no automatic recovery choice.
4. Refuse dispatch from a dirty main worktree until the user cleans it or authorizes a recoverable snapshot.
5. Capture every plan revision. Preserve the host's normal plan approval, then let the user select a BDFL plan version.
6. Compile atomic tasks containing objective, context, allowed paths, dependencies, exact model, permission mode, validation commands, and completion criteria.
7. Dispatch only with at least two independent tasks or an explicit user request for agents. Serialize overlapping paths.
8. Route agent questions and permission requests to the Inbox. Suspend the agent until the user answers; never infer an answer or broaden permission.
9. Review and approve completed tasks individually. Stage approved work on a temporary integration branch, validate the batch, and only then offer integration.

## Safety invariants

- Keep BDFL inside Claude Code or Codex; do not wrap the parent session.
- Give each attempt a dedicated `.bdfl/` worktree and branch.
- Preserve parent permissions. Map parent plan mode to the host's default execution mode.
- Reject malformed or unlisted model specifications before dispatch; never substitute a model.
- Preserve failed and rewound attempts, logs, checkpoints, and session IDs.
- Never merge an agent branch directly into `main`.

Read [references/orchestration.md](references/orchestration.md) before dispatch or integration, and [references/state-schema.md](references/state-schema.md) when reading or changing persisted state.
