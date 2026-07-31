# Recovery and durable sessions

BDFL attaches the real terminal to a private tmux server while a background supervisor remains the sole workspace-state writer. Its work survives a detached client or supervisor restart. Each repository's schema-2 `.bdfl/workspace.json` records its agents' stable names, role sequences, lifecycle owner, task snippets, attention state, and provider resume identities; plan lineages, executions, worker contexts, worktrees, events, and terminal snapshots live beside it in that repository's `.bdfl/` directory.

- `C-b x` pauses only the selected agent. Its provider session IDs, roles, profiles, custom argv, branches, worktrees, plan relationships, and snapshots remain; **Sessions** can resume that exact conversation later, including an accepted or completed worker. A user-resumed managed worker remains user-owned until an explicit repair reclaims it. (`C-b X` remains an alias.)
- Reopening uses the provider's exact interactive resume identity: `claude --resume <id>`, `codex resume <id>`, or the underlying `codex resume <id>` passed through `ollama launch codex`. The saved model, effort, custom permission options, other arguments, fresh session capability, and canonical role instructions are restored with it.
- Dangerous access is never saved with a session. Restored sessions receive provider bypass flags only when the new supervisor process was started with `bdfl --dangerous`.
- `C-b q` performs a normal shutdown: it snapshots panes, stops providers, kills only BDFL's private tmux server, closes the daemon, and releases its runtime files. Closing the terminal client or losing the daemon leaves tmux panes running; the next `bdfl` reconnects and reconciles them. (`C-b Q` remains an alias.)
- Native Plan and Review panes reconstruct themselves from files, not model context.
- Private mode-0600 sockets and generated configuration live under `.bdfl/run/`. BDFL never joins or modifies the user's existing tmux server.
- Development schema 1 state is not migrated. Stop the active supervisor, remove only this repository's `.bdfl/` directory, and start BDFL again to create fresh schema-2 state.

A supervisor launched from a non-Git parent discovers and aggregates repository-owned state up to two levels below that directory. Launching inside a repository, including from a subdirectory, reads only that repository's state from its Git top level. Legacy `.bdfl/workspace.json` state directly in a non-Git parent cannot be assigned safely and must be reset before a parent-scoped launch.

When recovery or another startup step fails, BDFL prints a stable error code and message without a JavaScript stack, restores the terminal, and provides the repository issue link. Include that code and message when reporting a failure.

Treat `.bdfl/` as sensitive and never commit it. Agent task snippets include the latest substantive planning prompt and worker assignment summaries. Before manually deleting state, inspect the associated plans, private branches, worktrees, and provider transcripts. Integrated Git history and provider-retained transcripts are independent of BDFL's local records and may outlive session deletion.

Deleting one plan or all plans for its selected session removes only the selected repository-owned `.bdfl/plans/` lineage, version, approval, and feedback files. It does not remove executions, workstream/session records, snapshots, worktrees, branches, integrated Git history, or provider-retained transcripts.

Deleting one workstream removes that workstream and its session records after BDFL has stopped and removed the affected managed processes and snapshots. Deleting all sessions performs that runtime cleanup across every repository first, then clears all workstream/session records and resets local selection and numbering. Saved `.bdfl/config.json`, plans, execution records, events, worktrees, Git history, and provider-retained transcripts survive. If process or snapshot cleanup fails, BDFL retains the workspace metadata so the operation can be inspected and retried safely.

If a provider process survives a supervisor crash, confirm its identity before terminating it. Resume through BDFL so the durable record remains the source of truth.
