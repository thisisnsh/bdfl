---
name: bdfl
description: Activate and manage BDFL only when the user explicitly invokes the command.
disable-model-invocation: true
argument-hint: "[list|help|off|provider:model:effort]"
---

# BDFL

Run the local BDFL runtime before responding. Treat its output as authoritative activation, recovery, list, help, or deactivation state.

Runtime output: !`node "${CLAUDE_PLUGIN_ROOT}/bin/bdfl.js" $ARGUMENTS`

After activation, coordinate requested work with isolated task worktrees, explicit questions and permissions, per-task review, batch validation, and user-approved integration. Preserve native plan mode. Never broaden permissions, make an automatic recovery choice, or merge agent work directly into the main branch.
