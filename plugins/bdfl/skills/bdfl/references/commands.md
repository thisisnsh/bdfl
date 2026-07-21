# Commands and protocol

Claude Code uses `/bdfl [on|off|models|plans|tasks|agents|help]`. Codex uses `$bdfl` with the same optional arguments. The single skill defaults to `on` and routes management through MCP `bdfl`.

`dispatch` starts a validated manifest and waits for attention. `continue` renders and resolves question, permission, failure, task-review, and integration-review events. They are protocol tools, not public commands. `workflow`, `inbox`, and `capture-plan` are invalid commands.

Plans offer plan/version selection followed by Diff, Full, or Approve. Tasks and agents are on-demand inspection and cancellation views; they are not polling mechanisms. Prompts, logs, plan bodies, and diffs stay hidden unless their view is explicitly selected.
