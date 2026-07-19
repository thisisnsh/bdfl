---
name: agents
description: Open BDFL's agent list to inspect status, questions, permissions, logs, changed files, and attempts, then explicitly stop, rewind, or follow up. Use only when the user explicitly invokes the BDFL agents skill.
---

# BDFL Agents

Run `bdfl agents` as an ordinary tool action. Up/down selects an agent, Enter opens details, `x` requests a stop, `r` starts a fresh rewind attempt, `f` adds corrective follow-up instructions, `o` opens the full log or diff, and Esc returns.

When the host returns a non-interactive snapshot, present the agents and available actions, then wait for the user's exact target and action.

Never stop, rewind, answer, broaden permission, or start a follow-up automatically.
