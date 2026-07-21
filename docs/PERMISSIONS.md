# Permissions

Delegators are always read-only. Planning, conversation, plan revision, and worker coordination never authorize code writes.

Workers use the permission mode selected for their workstream:

| BDFL mode | Intent |
|---|---|
| `read-only` | Inspect and verify without changing repository files |
| `workspace-write` | Write inside the isolated worker worktree |
| `full-access` | Use the provider's explicitly authorized broad mode |

Provider adapters translate these modes to the provider's native controls. A session retains its launch mode until explicitly restarted. Changing the workstream default does not silently widen a running worker.

Permission is only one boundary. BDFL also verifies actual changed paths against the approved chunk, reruns deterministic argv-based checks, keeps conflicts inside integration worktrees, and refuses final integration when the target branch, HEAD, or cleanliness changed.

Custom profile commands never pass through a shell. BDFL owns provider resume, MCP, model, effort, permission, hook, and role flags.
