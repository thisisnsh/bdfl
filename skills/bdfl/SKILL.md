---
name: bdfl
description: Manage BDFL orchestration, models, plans, tasks, and agents through native host controls. Use only when the user explicitly invokes $bdfl, optionally with on, off, models, plans, tasks, agents, or help.
---

# BDFL

Parse the argument as one of `on`, `off`, `models`, `plans`, `tasks`, `agents`, or `help`; no argument means `on`. Call the BDFL MCP `bdfl` tool exactly once with that command and the absolute active Git project root. Do not call a similarly described tool or construct a choice list yourself.

If `plans` returns `needsPlanBackfill: true`, find the most recent `<proposed_plan>` in the current conversation, call `bdfl` with `capture-plan` and that exact Markdown, then immediately call `bdfl` with `plans` again. If no proposed plan exists, report `No plans.`

While BDFL is active, call `capture-plan` with the exact Markdown whenever you create or revise a `<proposed_plan>`, before returning it to the user. One run owns one versioned plan.

For execution, call MCP `dispatch` with readable task titles, the exact prompt each provider must receive, atomic allowed paths, dependencies, exact model, inherited permission mode, validation commands, and completion criteria. Use at least two independent tasks unless the user explicitly requests an agent. Route waiting questions through `bdfl` command `inbox`.

Never infer recovery, approval, permission, or integration choices. Never merge an agent branch directly into `main`. Read [references/orchestration.md](references/orchestration.md) before dispatch or integration.
