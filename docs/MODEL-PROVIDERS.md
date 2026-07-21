# Claude and Codex profiles

Each workstream has two independent profiles:

```text
delegatorProfile: provider, model, effort
workerProfile:    provider, model, effort, permissionMode
workerCapacity:   1–5, default 4
```

Claude may lead Codex workers, Codex may lead Claude workers, or one provider may fill both roles. A running session keeps the profile with which it launched. Profile changes affect future workers unless a selected session is explicitly restarted.

BDFL launches interactive provider CLIs and preserves their native authentication and session stores. Delegators receive read-only permissions, the short BDFL role instruction, and the session-only `bdfl-plan` skill. Workers receive only the approved clean shared contract, their chunk, dependency results, and execution metadata.

`Type your own` accepts commands beginning with `claude` or `codex`, tokenizes them without a shell, and stores the remaining arguments as an argv array. BDFL rejects pipes, redirection, substitutions, environment prefixes, arbitrary executables, headless modes, and flags it owns for model, effort, permissions, resume, MCP, hooks, and role injection.

Ollama, local models, and additional provider CLIs are Coming Soon.
