---
name: bdfl
description: Turn BDFL orchestration on or off only when explicitly invoked.
disable-model-invocation: true
argument-hint: "[on|off]"
---

# BDFL

Run the `bdfl` executable with the Bash tool as an ordinary tool action. With no argument or `on`, run exactly `bdfl on`. With `off`, run exactly `bdfl off`. Reject every other argument and direct model changes to `/bdfl:models`.

If the executable is missing, report a broken plugin installation. Do not search npm, install a global package, or improvise another runtime path. Never broaden permissions, choose recovery automatically, or merge agent work directly into the main branch.
