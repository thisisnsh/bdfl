---
name: bdfl
description: Manage BDFL orchestration, models, plans, tasks, and agents only when explicitly invoked.
disable-model-invocation: true
argument-hint: "[on|off|models|plans|tasks|agents|help]"
---

# BDFL

Parse the argument as `on`, `off`, `models`, `plans`, `tasks`, `agents`, or `help`; no argument means `on`. Call the BDFL MCP `bdfl` tool with that command and the absolute active Git project root. Never call Bash or construct a choice list.

If `plans` returns `needsPlanBackfill: true`, capture the most recent `<proposed_plan>` from this conversation with MCP command `capture-plan`, preserving its exact Markdown, then call `plans` again. If none exists, report `No plans.` While BDFL is active, capture each new or revised proposed plan before returning it.

Use MCP `dispatch` for validated tasks. Each task must have a readable title and the exact provider prompt. Route waiting questions with command `inbox`. Never infer recovery, approval, permission, or integration choices.
