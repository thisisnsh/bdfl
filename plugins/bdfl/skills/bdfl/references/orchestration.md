# Event-driven orchestration contract

Compile a manifest only after plan approval/version selection or, outside plan mode, after material questions are resolved. Reject dependency cycles. Treat paths as overlapping when they are equal or one contains the other; schedule independent non-overlapping tasks up to `maxAgents`.

`dispatch` validates the manifest, creates a fresh branch and `.bdfl/worktrees/` worktree per attempt, starts eligible tasks, and waits for durable attention events. A question or permission pauses only its agent. Multiple simultaneous events belong in one bundle and require independent answers.

Use `continue` for all event decisions. Question choices may be generated options or free text. Permission choices are exactly Approve/Deny. Completion choices are View/Accept/Decline: View returns paginated file names, diffstat, and patch without resolving review; Accept approves the task and starts newly unblocked dependencies; Decline requires feedback and creates a fresh attempt while preserving prior branches, commits, logs, and events.

After all tasks are accepted, BDFL combines approved commits in a separate integration worktree and runs batch validation. Final integration uses the same View/Accept/Decline protocol and never proceeds without explicit acceptance. Cancellation and host shutdown preserve durable state; recovery choices must remain explicit.
