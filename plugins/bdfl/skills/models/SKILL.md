---
name: models
description: Open BDFL's model chooser and select the exact provider, model, and effort used for future runs. Use only when the user explicitly invokes the BDFL models skill to inspect or change the run model.
---

# BDFL Models

Run `bdfl models` as an ordinary tool action. In an interactive terminal, use up/down to highlight an allowlisted model and `a` to select it. If the user already supplied an exact model, run `bdfl models provider:model:effort` with that value unchanged.

When the host returns a non-interactive list, show it to the user and ask which exact entry to select. Wait for the answer before running the selection command.

Reject malformed or unlisted specifications. Never silently substitute a provider, model, or effort.
