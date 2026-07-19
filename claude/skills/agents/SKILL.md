---
name: agents
description: Open and manage BDFL agents, attempts, questions, permissions, logs, and diffs only when explicitly invoked.
disable-model-invocation: true
---

# BDFL Agents

Immediately call the bundled BDFL MCP server's `agents` tool. If it reports no agents, respond exactly `No agents.` and stop. Otherwise treat the MCP-selected agent details as authoritative. Never call Bash, AskUserQuestion, build a choice list, stop, rewind, answer, broaden permission, or start a follow-up automatically.
