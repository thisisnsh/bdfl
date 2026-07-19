---
name: plans
description: Open BDFL plans, versions, diffs, and approval actions only when explicitly invoked.
disable-model-invocation: true
---

# BDFL Plans

Immediately call the bundled BDFL MCP server's `plans` tool. If it reports no plans, respond exactly `No plans.` and stop. Otherwise treat the MCP-selected plan version as authoritative. Never call Bash, AskUserQuestion, build a choice list, or select a plan version automatically. Preserve native plan approval.
