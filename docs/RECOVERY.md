# Recovery and durable sessions

BDFL runs in the foreground, but its work survives a closed pane or supervisor restart. Each repository's schema-2 `.bdfl/workspace.json` records its agents' stable names, role sequences, task snippets, attention state, and provider resume identities; plan lineages, executions, worker contexts, worktrees, events, and terminal snapshots live beside it in that repository's `.bdfl/` directory.

- **Close** stops a session's PTYs and hides it. Its provider session IDs, roles, profiles, custom argv, branches, worktrees, plan relationships, and snapshots remain; **Sessions** can reopen it later.
- Reopening uses the provider's exact interactive resume identity: `claude --resume <id>`, `codex resume <id>`, or the underlying `codex resume <id>` passed through `ollama launch codex`. The saved model, effort, custom permission options, other arguments, fresh session capability, and canonical role instructions are restored with it.
- Dangerous access is never saved with a session. Restored sessions receive provider bypass flags only when the new supervisor process was started with `bdfl --dangerous`.
- **Quit** stops all PTYs without marking their sessions closed. Every agent in those sessions launches automatically when BDFL starts again.
- Native Plan and Review panes reconstruct themselves from files, not model context.
- A launch coordinator lock plus sorted repository locks prevent parent and repository-scoped supervisors from mutating the same state. If any repository is already owned, startup releases locks it acquired and stops.
- Development schema 1 state is not migrated. Stop the active supervisor, remove only this repository's `.bdfl/` directory, and start BDFL again to create fresh schema-2 state.

A supervisor launched from a non-Git parent discovers and aggregates repository-owned state up to two levels below that directory. Launching inside a repository, including from a subdirectory, reads only that repository's state from its Git top level. Legacy `.bdfl/workspace.json` state directly in a non-Git parent cannot be assigned safely and must be reset before a parent-scoped launch.

When recovery or another startup step fails, BDFL prints a stable error code and message without a JavaScript stack, restores the terminal, and provides the repository issue link. Include that code and message when reporting a failure.

Treat `.bdfl/` as sensitive and never commit it. Agent task snippets include the latest substantive planning prompt and worker assignment summaries. Before manually deleting state, inspect the associated plans, private branches, worktrees, and provider transcripts. Integrated Git history and provider-retained transcripts are independent of BDFL's local records and may outlive session deletion.

If a provider process survives a supervisor crash, confirm its identity before terminating it. Resume through BDFL so the durable record remains the source of truth.
