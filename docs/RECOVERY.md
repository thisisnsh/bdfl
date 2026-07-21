# Recovery

`BDFL status` inspects durable `.bdfl/state.json` records. Active runs, unfinished tasks or agents, and unanswered events require one explicit choice:

- Continue marks stale live processes interrupted and resumes only after explicit event decisions.
- Manage tasks opens readable task titles and safe inspection/cancellation actions.
- Archive run preserves the run and marks active records archived.
- Cancel run preserves prompts, attempts, events, branches, commits, and worktrees while marking active records cancelled.

BDFL never resumes, archives, terminates, discards, retries, declines, or integrates automatically. There is no Inbox command: durable unanswered records surface automatically through `dispatch` or `continue`, and remain available after cancellation or host shutdown.

Declining a task marks its old attempt declined and starts a fresh worktree with the supplied feedback. Provider session IDs are retained for supported resume commands. Integration conflicts remain isolated in the integration worktree and never alter the main worktree before explicit acceptance.
