---
name: models
description: Open BDFL's model chooser and select the exact provider, model, and effort used for future runs. Use only when the user explicitly invokes the BDFL models skill to inspect or change the run model.
---

# BDFL Models

Immediately run BDFL's bundled executable at `../../bin/bdfl` relative to this `SKILL.md`; never call bare `bdfl` and do not announce the tool call first. With no supplied model, pass `models`. With an exact model, pass `models provider:model:effort` unchanged.

When no model was supplied, use the returned list to ask one compact host-native choice question. Wait for the answer, then run the bundled executable again with that exact entry. Do not print terminal arrow-key instructions: tool actions are non-interactive.

Reject malformed or unlisted specifications. Never silently substitute a provider, model, or effort.
