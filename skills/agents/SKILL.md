---
name: agents
description: Open BDFL's agent list to inspect status, questions, permissions, logs, changed files, and attempts, then explicitly stop, rewind, or follow up. Use only when the user explicitly invokes the BDFL agents skill.
---

# BDFL Agents

Immediately call the bundled BDFL MCP server's `agents` tool. The tool owns the native agent selector and returns the selected agent details.

If it reports no agents, respond exactly `No agents.` and stop. Otherwise treat its selected agent as authoritative.

Never build a choice question yourself, print terminal key instructions, stop, rewind, answer, broaden permission, or start a follow-up automatically.
