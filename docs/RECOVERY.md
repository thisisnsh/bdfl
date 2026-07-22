# Recovery and durable sessions

BDFL runs in the foreground, but its work survives a closed pane or supervisor restart. `.bdfl/workspace.json` records sessions and their agents; plan lineages, executions, worker contexts, worktrees, events, and terminal snapshots live in their dedicated `.bdfl/` directories.

- **Close** stops a session's PTYs and hides it. Its provider session IDs, roles, profiles, custom argv, branches, worktrees, plan relationships, and snapshots remain; **Sessions** can reopen it later.
- Reopening uses the provider's exact interactive resume command with no synthetic prompt: `claude --resume <id>` or `codex resume <id>` alongside the saved model, effort, permission, and custom arguments.
- **Quit** stops all PTYs without marking their sessions closed. Every agent in those sessions launches automatically when BDFL starts again.
- Native Plan and Review panes reconstruct themselves from files, not model context.
- One workspace lock prevents concurrent supervisors from mutating state.
- Unsupported old prerelease state receives a reset/export path instead of a guessed migration.

Treat `.bdfl/` as sensitive and never commit it. Before manually deleting state, inspect the associated plans, private branches, worktrees, and provider transcripts. Integrated Git history and provider-retained transcripts are independent of BDFL's local records and may outlive session deletion.

If a provider process survives a supervisor crash, confirm its identity before terminating it. Resume through BDFL so the durable record remains the source of truth.
