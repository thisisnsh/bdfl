---
name: "off"
description: Deactivate BDFL safely after resolving any running or waiting agents. Use only when the user explicitly invokes the BDFL off skill.
---

# Turn BDFL Off

Run `bdfl off` as an ordinary tool action. If an agent is running or waiting, report the blocking agents and let the user stop, resolve, or retain them; do not terminate them automatically. On success, confirm that BDFL is off. The status line becomes empty on its next host refresh.

Do not discard run state, worktrees, branches, logs, or checkpoints.
