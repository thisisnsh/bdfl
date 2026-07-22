# Permissions

Delegators are always read-only. Planning, conversation, plan revision, and worker coordination never authorize code writes.

Workers always use BDFL's accept-edits policy inside their isolated worktree. The durable profile records this as `workspace-write`; provider adapters translate it to Claude's `acceptEdits` mode or Codex's workspace-write sandbox. Onboarding states this policy but does not ask users to choose a permission mode.

Permission is only one boundary. BDFL also verifies actual changed paths against the approved chunk, reruns deterministic argv-based checks, keeps conflicts inside integration worktrees, and refuses final integration when the target branch, HEAD, or cleanliness changed.

Custom profile commands never pass through a shell. BDFL owns provider resume, MCP, model, effort, permission, hook, and role flags.
