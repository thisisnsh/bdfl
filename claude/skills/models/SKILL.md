---
name: models
description: Open BDFL's model chooser and select an exact model only when explicitly invoked.
disable-model-invocation: true
argument-hint: "[provider:model:effort]"
---

# BDFL Models

Immediately run `"${CLAUDE_PLUGIN_ROOT}/bin/bdfl" models $ARGUMENTS` with the Bash tool. Never call bare `bdfl` and do not announce the tool call first. With no argument, use the returned list to ask one compact choice question, then run the bundled executable with the exact choice. Tool actions are non-interactive, so never show arrow-key instructions. Pass a supplied exact model unchanged. Never substitute a provider, model, or effort.
