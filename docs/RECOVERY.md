# Recovery

On activation, BDFL inspects `.bdfl/state.json`. Active runs, pending/running/waiting/review tasks or agents, and open Inbox items require one explicit choice:

- Continue: continue the recorded run; stale processes become interrupted instead of pretending to still run.
- Manage tasks: open readable task titles and explicit actions.
- Archive run: preserve the run and mark active records archived.
- Cancel run: preserve prompts, attempts, logs, branches, and worktrees while marking active records cancelled.

BDFL never resumes, archives, terminates, discards, rewinds, or integrates automatically.

Rewind marks the old attempt `rewound`, retains its events/logs/branch/session, and starts a new attempt from the selected safe checkpoint. Provider crashes retain exit code or signal and remain inspectable. Integration conflicts remain on the temporary integration branch for review; they are never forced into `main`.
