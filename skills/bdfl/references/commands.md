# Commands and keys

Claude Code uses `/bdfl:bdfl [on|off]`, `/bdfl:models`, `/bdfl:plans`, and `/bdfl:agents`. Codex uses the same names with `$` instead of `/`. The main skill defaults to `on`; model choice and management views use their dedicated skills.

The list UI has `Runs | Plans | Tasks | Agents | Inbox | Models`. Left/right selects a tab, up/down selects a row, Enter opens details, and Esc returns. Always render contextual keys on the bottom row.

Actions: `x` stop agent, `r` rewind attempt, `f` start corrective follow-up, `a` approve plan version or task, `i` integrate a validated batch, `o` open full diff/log, and `?` open contextual help.

In plan detail, up/down selects a version and left/right switches diff/full. Diff uses green additions and red removals. Full mode uses white. `a` selects the highlighted version for execution.
