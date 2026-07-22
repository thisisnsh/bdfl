# TODO

This is the working roadmap for BDFL. Items here are plans, not promises or currently supported features.

## Providers and platforms

- [x] Add Ollama and local-model support through Codex.
- [ ] Add native Windows support.
- [ ] Evaluate additional coding-agent providers: Aider, OpenCode, Goose, Gemini CLI, and Qwen Code.

## Performance and measurement

- [ ] Add token accounting for planning, worker, verifier, and recovery sessions.
- [ ] Build repeatable benchmarks for token use, wall-clock time, concurrency, and task outcomes.
- [ ] Audit the `bdfl-plan` skill for prompt size, duplicated context, plan quality, and unnecessary model work.
- [ ] Audit the MCP path for tool-call volume, payload size, wait/poll behavior, bridge recovery, and end-to-end latency.
- [ ] Publish a reproducible baseline before claiming efficiency improvements.

## Experience

- [ ] Add a profile-management UI for saved agent setups.
- [ ] Add tiled monitoring for active workers.
- [ ] Explore remote peers and resumable remote sessions.
- [ ] Improve long-running execution history and cleanup controls.

## Reliability

- [ ] Expand end-to-end coverage across supported Node.js versions, providers, terminals, and Git recovery paths.
- [ ] Add stress tests for dependency graphs, locks, capacity changes, MCP reconnects, and interrupted integrations.
