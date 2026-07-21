# Recovery and durable sessions

BDFL runs in the foreground, but its work survives a closed pane or supervisor restart. `.bdfl/workspace.json` records workstreams and sessions; plan lineages, executions, worker contexts, worktrees, events, and terminal snapshots live in their dedicated `.bdfl/` directories.

- Closing a provider stops its PTY and marks it explicitly closed. Its provider session ID, role, profile, branch, worktree, plan relationship, and snapshot remain.
- Reopening uses the provider's interactive resume command with no synthetic prompt.
- Sessions that were open when BDFL exited are eligible for restoration. Explicitly closed sessions stay closed.
- Native Plan and Review panes reconstruct themselves from files, not model context.
- One workspace lock prevents concurrent supervisors from mutating state.
- Unsupported old prerelease state receives a reset/export path instead of a guessed migration.

Treat `.bdfl/` as sensitive and never commit it. Before manually deleting state, inspect the associated plans, private branches, worktrees, and provider transcripts. Integrated Git history and provider-retained transcripts are independent of BDFL's local records and may outlive session deletion.

If a provider process survives a supervisor crash, confirm its identity before terminating it. Resume through BDFL so the durable record remains the source of truth.
