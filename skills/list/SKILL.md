---
name: list
description: Open BDFL's shared Runs, Plans, Tasks, Agents, Inbox, and Models interface. Use only when the user explicitly invokes the BDFL list skill to inspect or manage active and recoverable work.
---

# List BDFL State

Run `bdfl list` as an ordinary tool action. Do not use inline shell expansion in the skill. If a terminal is available, open the interactive interface; otherwise return its stable text snapshot.

Keep all actions explicit. Questions and permission requests remain suspended in Inbox until the user answers. Display contextual keys in the bottom row and never infer approval, recovery, cancellation, rewind, or integration.
