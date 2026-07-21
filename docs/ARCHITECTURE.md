# Architecture

```text
Real terminal
  └─ foreground supervisor
       ├─ input router + alternate-screen renderer
       ├─ interactive provider PTYs + headless terminal snapshots
       ├─ native Plan / Review / Sessions panes
       ├─ atomic workspace state + append-only events
       ├─ plan parser + immutable lineage
       ├─ dependency/lock/capacity scheduler
       ├─ per-session stdio MCP bridge
       └─ Git worktrees + consolidation + final integration
```

The supervisor is the only durable-state writer. There is no daemon or headless provider broker. Provider adapters construct interactive delegator, worker, resume, integration, and verifier launches while provider-native authentication stays outside BDFL.

## Plans

Marker-bearing model output becomes an immutable `.bdfl/plans/<id>/versions/vNNNN/` lineage. Each version contains raw source for debugging, clean consolidated Markdown, clean shared/chunk/global files, and a manifest. Approvals bind the plan ID, version, section ID, and section SHA.

The scheduler freezes a completely approved manifest into `.bdfl/executions/`. Chunks become eligible only after every hard predecessor is accepted. Eligible chunks start in plan order, constrained by worker capacity and named locks. Capacity never changes plan shape.

## Workers and Git

Every coding worker receives one isolated branch/worktree and only its clean context. Root chunks use the frozen target baseline. Dependents use accepted predecessor results as their base. BDFL verifies actual paths and deterministic checks before offering native review.

Accepted commits apply to an integration worktree in dependency order. Conflicts create worker work; the delegator never edits code. A fresh read-only verifier reviews the consolidated diff and global checks. Final integration verifies the original target branch, HEAD, identity, and cleanliness, then creates one workstream commit rather than exposing checkpoint history.

## Persistence

`.bdfl/` contains configuration, workspace/session records, plans, executions, worker contexts, worktrees, events, snapshots, and the live supervisor lock. Git excludes it locally. Old unreleased architectures are reset or exported explicitly rather than migrated by inference.
