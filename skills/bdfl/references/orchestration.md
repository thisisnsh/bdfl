# Orchestration contract

Compile a manifest only after plan approval/version selection or, outside plan mode, after every material question is resolved. Every task must declare a readable title, exact provider prompt, objective, context, allowed paths, dependencies, exact model, permission mode, validation commands, and completion criteria.

Reject dependency cycles. Treat paths as overlapping when they are equal or one path contains the other. Schedule independent tasks up to `maxAgents`; serialize overlapping ownership.

Create a fresh branch and worktree under `.bdfl/worktrees/` for each attempt. Normalize provider output into events and persist each event before presenting it. A question or permission event moves the agent to `waiting` and creates an Inbox item.

Review each completion. Apply approved changes by explicit path to a temporary integration branch. Run all task and batch validations. Present conflicts and failures; do not integrate until the user requests `i` after successful validation.

Rewind creates a new attempt from the last safe checkpoint. Preserve previous branches, worktrees when useful for inspection, logs, and events.
