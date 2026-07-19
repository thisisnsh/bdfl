---
name: plans
description: Open BDFL's plan list to inspect versions, switch between colored diffs and full text, and explicitly approve a version for execution. Use only when the user explicitly invokes the BDFL plans skill.
---

# BDFL Plans

Run `bdfl plans` as an ordinary tool action. Up/down selects a plan or version, Enter opens details, left/right switches diff and full modes, `a` approves the highlighted version, `o` opens the full artifact, and Esc returns.

When the host returns a non-interactive snapshot, present the plans and available actions, then wait for the user's exact plan, version, and action.

Preserve native host plan approval. Never select or approve a plan version automatically.
