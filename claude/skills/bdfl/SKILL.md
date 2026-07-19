---
name: bdfl
description: Turn BDFL orchestration on or off only when explicitly invoked.
disable-model-invocation: true
argument-hint: "[on|off]"
---

# BDFL

Immediately run `"${CLAUDE_PLUGIN_ROOT}/bin/bdfl"` with the Bash tool; never call bare `bdfl` and do not announce the tool call first. With no argument or `on`, pass exactly `on`. With `off`, pass exactly `off`. Reject every other argument and direct model changes to `/bdfl:models`.

If the executable is missing, report a broken plugin installation. Do not search npm, install a global package, or improvise another runtime path. Never broaden permissions, choose recovery automatically, or merge agent work directly into the main branch.
