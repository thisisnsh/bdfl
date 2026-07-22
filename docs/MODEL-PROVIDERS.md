# Claude and Codex profiles

Each workstream has two independent profiles:

```text
delegatorProfile: provider, model, effort
workerProfile:    provider, model, effort, permissionMode
workerCapacity:   1–5, default 5
```

Claude may lead Codex workers, Codex may lead Claude workers, or one provider may fill both roles. A running session keeps the profile with which it launched. Profile changes affect future workers unless a selected session is explicitly restarted.

BDFL launches interactive provider CLIs and preserves their native authentication and session stores. Delegators receive read-only permissions, the short BDFL role instruction, and the session-only `bdfl-plan` skill. Workers receive only the approved clean shared contract, their chunk, dependency results, and execution metadata.

The onboarding screen shows only provider CLIs found on `PATH`. Codex choices come from `codex debug models`, including each model's supported reasoning-effort levels. Claude choices are rebuilt for each new session from the aliases advertised by the installed CLI and Claude's account-scoped model-option cache; the provider default is not shown as a model choice. Account-scoped IDs retain context-window suffixes such as `[1m]`. A model ID can still be entered directly when a custom MCP configuration requires it.

The planning profile accepts optional CLI arguments. BDFL tokenizes them without a shell and stores them as an argv array. It rejects pipes, redirection, substitutions, environment prefixes, headless modes, and flags it owns for model, effort, permissions, resume, MCP, hooks, and role injection. The complete accepted setup is saved locally and offered as **Last used** when the next workstream is created.

Worker access is fixed to accept edits (`workspace-write` in the durable profile), so onboarding does not ask users to choose a permission mode.

Ollama, local models, and additional provider CLIs are Coming Soon.
