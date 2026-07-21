# Architecture

The foreground supervisor owns terminal input/rendering, provider PTYs, atomic state, the event journal, scheduling, local authenticated MCP bridges, and Git operations. Provider adapters build interactive delegator, worker, resume, and verifier launches. No daemon or headless provider broker exists.

Plan source is parsed into immutable `.bdfl/plans/<id>/versions/vNNNN/` lineages containing raw source, clean consolidated Markdown, clean shared/chunk/global files, and a manifest. The scheduler freezes an approved manifest into `.bdfl/executions/`, writes minimal worker context, and starts eligible chunks in plan order subject to capacity and locks.

Each worker uses an isolated worktree and private branch. Accepted predecessors define dependent bases. Results are mechanically checked, consolidated in an integration worktree, globally verified by a fresh read-only provider session, and converted into one target commit only after branch/head/cleanliness checks.
