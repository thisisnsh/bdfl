# Commands and keys

Claude Code uses `/bdfl:activate`, `/bdfl:list`, `/bdfl:help`, and `/bdfl:off`. Codex uses `$bdfl:activate`, `$bdfl:list`, `$bdfl:help`, and `$bdfl:off`. Activation accepts one optional exact `provider:model:effort` specification. There is no plan command.

The list UI has `Runs | Plans | Tasks | Agents | Inbox | Models`. Left/right selects a tab, up/down selects a row, Enter opens details, and Esc returns. Always render contextual keys on the bottom row.

Actions: `x` stop agent, `r` rewind attempt, `f` start corrective follow-up, `a` approve plan version or task, `i` integrate a validated batch, `o` open full diff/log, and `?` open contextual help.

In plan detail, up/down selects a version and left/right switches diff/full. Diff uses green additions and red removals. Full mode uses white. `a` selects the highlighted version for execution.
