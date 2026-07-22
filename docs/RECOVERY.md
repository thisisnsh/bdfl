# Recovery and durable sessions

BDFL runs in the foreground, but its work survives a closed pane or supervisor restart. Schema-2 `.bdfl/workspace.json` records each agent's stable name, role sequence, task snippet, attention state, and provider resume identity; plan lineages, executions, worker contexts, worktrees, events, and terminal snapshots live in their dedicated `.bdfl/` directories.

- **Close** stops a session's PTYs and hides it. Its provider session IDs, roles, profiles, custom argv, branches, worktrees, plan relationships, and snapshots remain; **Sessions** can reopen it later.
- Reopening uses the provider's exact interactive resume command with no synthetic prompt: `claude --resume <id>` or `codex resume <id>` alongside the saved model, effort, permission, and custom arguments.
- **Quit** stops all PTYs without marking their sessions closed. Every agent in those sessions launches automatically when BDFL starts again.
- Native Plan and Review panes reconstruct themselves from files, not model context.
- One workspace lock prevents concurrent supervisors from mutating state.
- Development schema 1 state is not migrated. Stop the active supervisor, remove only this repository's `.bdfl/` directory, and start BDFL again to create fresh schema-2 state.

Treat `.bdfl/` as sensitive and never commit it. Agent task snippets include the latest substantive planning prompt and worker assignment summaries. Before manually deleting state, inspect the associated plans, private branches, worktrees, and provider transcripts. Integrated Git history and provider-retained transcripts are independent of BDFL's local records and may outlive session deletion.

If a provider process survives a supervisor crash, confirm its identity before terminating it. Resume through BDFL so the durable record remains the source of truth.
