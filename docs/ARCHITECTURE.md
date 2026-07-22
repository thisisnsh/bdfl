# Architecture

```text
Real terminal
  └─ foreground supervisor
       ├─ launch-scope repository catalog
       ├─ input router + alternate-screen renderer
       ├─ interactive provider PTYs + headless terminal snapshots
       ├─ native Plan / Review / Sessions panes
       ├─ atomic workspace state + append-only events
       ├─ plan parser + immutable lineage
       ├─ dependency/lock/capacity scheduler
       ├─ per-session stdio MCP bridge
       └─ Git worktrees + consolidation + final integration
```

The supervisor is the only durable-state writer. There is no daemon or headless provider broker. When launched inside a Git repository, BDFL scopes itself to that repository's top level. When launched from a non-Git parent, its repository catalog discovers Git repositories up to two levels below the launch directory and aggregates their state. Provider adapters construct interactive delegator, worker, resume, integration, and verifier launches while provider-native authentication stays outside BDFL. Ollama is a Codex-backed adapter: its outer launcher selects and prepares the model, while the inner Codex arguments carry BDFL's MCP, permission, notification, and recovery contract.

## Plans

Marker-bearing model output becomes an immutable `.bdfl/plans/<id>/versions/vNNNN/` lineage. Each version contains raw source for debugging, clean consolidated Markdown, clean shared/chunk/global files, and a manifest. Approvals bind the plan ID, version, section ID, and section SHA.

The scheduler freezes a completely approved manifest into `.bdfl/executions/`. Chunks become eligible only after every hard predecessor is accepted. Eligible chunks start in plan order, constrained by worker capacity and named locks. Capacity never changes plan shape.

## Workers and Git

Every coding worker receives one isolated branch/worktree inside the selected repository and only its clean context. Root chunks use that repository's frozen target baseline. Dependents use every accepted ancestor in plan order to construct their base. BDFL verifies actual paths and deterministic argv checks before offering native review.

Accepted commits apply to an integration worktree in dependency order. Conflicts create worker work; the delegator never edits code. A fresh verifier reviews the consolidated diff and global checks without implementing changes. Final integration verifies the original target branch, HEAD, identity, and cleanliness, then creates one workstream commit rather than exposing checkpoint history.

## Persistence

Each repository's `.bdfl/` contains its schema-2 configuration and workspace/session records, plans, executions, worker contexts, worktrees, events, snapshots, and repository lock. A non-Git parent launch may contain only coordinator runtime data; repository state remains repository-local. Every session record carries a stable name, role-local sequence, and normalized task snippet. Schema-1 development state is reset explicitly rather than migrated by inference.

Only repositories with a resolvable `HEAD` are offered for new sessions. BDFL does not initialize Git or create a bootstrap commit. Execution uses the repository recorded on the workstream, so one plan and its worktrees never span repositories.
