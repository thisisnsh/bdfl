---
name: plans
description: Open BDFL's plan list to inspect versions, switch between colored diffs and full text, and explicitly approve a version for execution. Use only when the user explicitly invokes the BDFL plans skill.
---

# BDFL Plans

Immediately call the bundled BDFL MCP server's `plans` tool. The tool owns the native plan-version selector and persistence.

If it reports no plans, respond exactly `No plans.` and stop. Otherwise treat its selected plan and version as authoritative.

Never build a choice question yourself, print terminal key instructions, select a version automatically, or bypass native host plan approval.
