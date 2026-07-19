---
name: activate
description: Activate BDFL only when the user explicitly invokes this command.
disable-model-invocation: true
argument-hint: "[provider:model:effort]"
---

# Activate BDFL

Run the `bdfl` executable with the Bash tool as an ordinary tool action. With no model argument, run exactly `bdfl`. With a user-supplied model, pass only that exact `provider:model:effort` value. Never pass the literal word `activate`.

If the executable is missing, report a broken plugin installation. Do not search npm, install a global package, or improvise another runtime path.

Treat the runtime output as authoritative activation or recovery state. After activation, coordinate requested work with isolated task worktrees, explicit questions and permissions, per-task review, batch validation, and user-approved integration. Preserve native plan mode. Never broaden permissions, make an automatic recovery choice, or merge agent work directly into the main branch.
