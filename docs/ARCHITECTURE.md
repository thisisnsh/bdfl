# Architecture

```text
Real terminal
  └─ foreground bdfl launcher
       └─ isolated tmux server (.bdfl/run/tmux.sock)
            ├─ session windows + tiled agent panes
            ├─ native scrollback, copy mode, layouts, and zoom
            ├─ New / Plans / Sessions / Reviews popups
            └─ provider pane helpers

Background supervisor daemon
       ├─ launch-scope repository catalog
       ├─ mode-0600 Unix-socket action/state protocol
       ├─ tmux notification reconciliation
       ├─ atomic workspace state + append-only events
       ├─ plan parser + immutable lineage
       ├─ dependency/lock/capacity scheduler
       ├─ per-session stdio MCP bridge
       └─ Git worktrees + consolidation + final integration
```

The daemon is the only durable-state writer. The foreground command verifies tmux 3.2+, starts or reconnects the daemon, selects the leftmost live session and its first agent, and attaches the real terminal. It opens New only when no live sessions exist. tmux runs on BDFL's private socket with generated configuration under `.bdfl/run/`; terminal or daemon crashes leave provider panes available for reattachment. Provider argv, environment, and working directories cross the tmux boundary in a mode-0600 JSON descriptor consumed by a fixed pane helper, never as interpolated shell input.

When launched inside a Git repository, BDFL scopes itself to that repository's top level. When launched from a non-Git parent, its repository catalog discovers Git repositories up to two levels below the launch directory and aggregates their state. Provider adapters construct interactive delegator, isolated worker, resume, and durable execution-agent launches while provider-native authentication stays outside BDFL. Ollama is a Codex-backed adapter: its outer launcher selects and prepares the model, while the inner Codex arguments carry BDFL's MCP, permission, notification, and recovery contract.

## Plans

Marker-bearing model output becomes an immutable `.bdfl/plans/<id>/versions/vNNNN/` lineage. Each version contains raw source for debugging, clean consolidated Markdown, clean shared/chunk/global files, and a manifest. Approvals bind the plan ID, version, section ID, and section SHA.

The scheduler freezes a completely approved manifest into `.bdfl/executions/`. Chunks become eligible only after every hard predecessor is accepted. Eligible chunks start in plan order, constrained by worker capacity and named locks. Capacity never changes plan shape.

## Workers and Git

Every coding worker receives one isolated branch/worktree inside the selected repository and only its clean context. Root chunks use that repository's frozen target baseline. Dependents use every accepted ancestor in plan order to construct their base. BDFL verifies actual paths and deterministic argv checks before offering native review.

Accepted commits apply to an integration worktree in dependency order. Implementation workers are isolated; the delegator never edits code. BDFL creates one visible workspace-write execution agent for read-only combined verification, consolidation conflicts, and target reconciliation. When verification reports affected chunk IDs, BDFL creates repair worktrees from the verified combined head and resumes each affected original worker conversation, falling back to a visibly labeled replacement only when that conversation is unavailable. Repair rounds retain their own commits, worktrees, worker identity, progress, and Review acceptance; every repair diff must be accepted again before consolidation and fresh global checks. The execution agent handles only combined-context conflicts and reconciled-check repair. Final integration requires the original target branch and a clean working tree. Requests enter a durable per-repository integration queue, and only its oldest active item may inspect or advance that target. When the target HEAD has advanced through committed descendant history, BDFL cherry-picks the approved result in a disposable reconciliation worktree and continues the same execution agent there. Worker and integration checks run in bounded background processes so the supervisor, rendering, bridge HTTP requests, and heartbeats remain responsive. Explicit durable phase metadata identifies the active agent, worktree, attempt, progress, and next step. Passing reconciliation checks continue into a final verification phase before BDFL fast-forwards the target with one commit whose subject and body are the approved plan title and Summary. Rewritten history, exhausted bounded reconciliation repair, and verification failures leave the target untouched.

## Persistence

Each repository's `.bdfl/` contains its schema-2 configuration and workspace/session records, plans, executions, worker contexts, worktrees, events, snapshots, and repository lock. A non-Git parent launch may contain only coordinator runtime data; repository state remains repository-local. Every session record carries a stable canonical name, role-local sequence, optional lifecycle owner, and normalized task snippet. Existing schema-2 state defaults lifecycle ownership from role and status without resetting provider IDs or history. One shared recent-file metadata index discovers Codex conversation identities instead of recursively polling per agent.

Only repositories with a resolvable `HEAD` are offered for new sessions. BDFL does not initialize Git or create a bootstrap commit. Execution uses the repository recorded on the workstream, so one plan and its worktrees never span repositories.
