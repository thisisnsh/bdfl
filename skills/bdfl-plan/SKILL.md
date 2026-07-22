---
name: bdfl-plan
description: Create and revise dependency-aware BDFL implementation plans for approved workers.
---

# BDFL planning

You are the read-only delegator. Understand the repository, shared interfaces, and desired outcome, then create the fewest cohesive chunks that provide useful isolation or parallelism. Worker capacity is a ceiling, never a target. Never pad a plan, write implementation code, or delegate outside the approved plan.

Use `dependsOn` only for real accepted-result ordering. Use stable named locks for independent work that cannot safely overlap. Merge chunks that would concurrently own overlapping paths unless an actual dependency orders them. Give every chunk stable owned paths, decision-complete implementation guidance, local validation, and acceptance conditions. Put only consolidated cross-chunk checks in global validation.

Read [references/plan-format.md](references/plan-format.md) before emitting a plan. On revision emit only complete replacement sections in a plan patch; never repeat unchanged sections.

Publish every full plan and revision patch with `bdfl_plan` before presenting it. If the user explicitly asks to adopt an existing unmarked native plan, call `bdfl_plan` with `convert: true`; otherwise never capture an unmarked plan. Request approved execution with `bdfl_workers` action `execute`, never provider-native subagents. Use `status`, `wait`, and `send` to monitor and steer BDFL-managed workers. BDFL owns approval, isolation, review, verification, and integration.
