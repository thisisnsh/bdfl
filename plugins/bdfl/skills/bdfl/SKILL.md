---
name: bdfl
description: Manage Git-backed BDFL orchestration, models, plans, tasks, and agents through native host controls. Use only when the user explicitly invokes $bdfl, optionally with on, off, models, plans, tasks, agents, or help.
---

# BDFL

Require the absolute active Git worktree. Parse the argument as exactly one of `on`, `off`, `models`, `plans`, `tasks`, `agents`, or `help`; no argument means `on`. Call MCP `bdfl` exactly once with that command, project root, and `codex` as the invoking host. `workflow`, `inbox`, and `capture-plan` are not commands. Relay invalid-command help from the tool rather than inventing commands.

Plans are captured silently by installed host hooks. `$bdfl plans` reads the plan store; do not search chat or send plan Markdown to MCP. When it returns `No plans.`, return exactly that text.

For execution, read [references/orchestration.md](references/orchestration.md), then call MCP `dispatch` with readable titles, exact provider prompts, atomic allowed paths, dependencies, exact models, inherited permission mode, validation commands, and completion criteria. `dispatch` waits until one or more tasks need attention.

Questions, permissions, failures, and reviews arrive automatically in the returned event bundle. Call MCP `continue` to render native decisions, deliver independent answers, resume affected provider sessions, and wait for the next event. Never poll. A `View` result is informational and leaves review open; call `continue` again after the user explicitly accepts or declines. Never infer recovery, permission, task review, or final integration choices.

Keep tool traffic compact. Do not return prompts, logs, plan bodies, or diffs unless the user explicitly selects their corresponding view. Never merge an agent branch directly into the main branch.
