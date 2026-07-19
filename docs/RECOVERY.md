# Recovery

On activation, BDFL inspects `.bdfl/state.json`. Active runs, pending/running/waiting/review tasks or agents, and open Inbox items require one explicit choice:

- `resume`: continue from recorded sessions and checkpoints.
- `inspect`: open state, logs, diffs, and worktrees without execution.
- `archive`: preserve the run and mark it terminal.
- `cancel`: leave state untouched and do not activate.

BDFL never resumes, archives, terminates, discards, rewinds, or integrates automatically.

Rewind marks the old attempt `rewound`, retains its events/logs/branch/session, and starts a new attempt from the selected safe checkpoint. Provider crashes retain exit code or signal and remain inspectable. Integration conflicts remain on the temporary integration branch for review; they are never forced into `main`.

