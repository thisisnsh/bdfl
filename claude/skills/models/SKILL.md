---
name: models
description: Open BDFL's model chooser and select an exact model only when explicitly invoked.
disable-model-invocation: true
argument-hint: "[provider:model:effort]"
---

# BDFL Models

Run `bdfl models $ARGUMENTS` with the Bash tool as an ordinary tool action. With no argument, list the models, show them to the user, and wait for an exact choice. Pass a supplied exact model unchanged. Never substitute a provider, model, or effort.
