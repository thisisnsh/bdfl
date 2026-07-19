---
name: bdfl
description: Coordinate substantial coding work with managed parallel agents, versioned plans, isolated Git worktrees, explicit approvals, and validated integration. Use when a user invokes /bdfl, asks BDFL to manage a run, wants independent tasks delegated without consuming the main context, or needs to inspect BDFL runs, plans, tasks, agents, inbox items, or models.
---

# BDFL

## Core workflow

1. Activate without changing the host's native planning mode.
2. Inspect `.bdfl/` for unfinished state. Ask the user to resume, inspect, archive, or cancel; make no automatic recovery choice.
3. Refuse dispatch from a dirty main worktree until the user cleans it or authorizes a recoverable snapshot.
4. Capture every plan revision. Preserve the host's normal plan approval, then let the user select a BDFL plan version.
5. Compile atomic tasks containing objective, context, allowed paths, dependencies, exact model, permission mode, validation commands, and completion criteria.
6. Dispatch only with at least two independent tasks or an explicit user request for agents. Serialize overlapping paths.
7. Route agent questions and permission requests to the Inbox. Suspend the agent until the user answers; never infer an answer or broaden permission.
8. Review and approve completed tasks individually. Stage approved work on a temporary integration branch, validate the batch, and only then offer integration.

## Safety invariants

- Keep BDFL inside Claude Code or Codex; do not wrap the parent session.
- Give each attempt a dedicated `.bdfl/` worktree and branch.
- Preserve parent permissions. Map parent plan mode to the host's default execution mode.
- Reject malformed or unlisted model specifications before dispatch; never substitute a model.
- Preserve failed and rewound attempts, logs, checkpoints, and session IDs.
- Never merge an agent branch directly into `main`.

## Commands

- `/bdfl [provider:model:effort]`: activate and optionally select a listed run model.
- `/bdfl list`: open Runs, Plans, Tasks, Agents, Inbox, and Models.
- `/bdfl help`: show commands, keys, models, permissions, and recovery.
- `/bdfl off`: resolve running agents, then deactivate.

Read [references/commands.md](references/commands.md) before handling interactive commands, [references/orchestration.md](references/orchestration.md) before dispatch or integration, and [references/state-schema.md](references/state-schema.md) when reading or changing persisted state.
