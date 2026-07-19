---
name: models
description: Open BDFL's model chooser and select an exact model only when explicitly invoked.
disable-model-invocation: true
argument-hint: "[provider:model:effort]"
---

# BDFL Models

Immediately call the bundled BDFL MCP server's `models` tool and do not announce the call first. The MCP tool displays the host-native selector, validates the exact model, and persists it. Never call Bash, AskUserQuestion, or build a choice list yourself. Never substitute a provider, model, or effort.
