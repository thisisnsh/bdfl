# Claude and Codex profiles

Each workstream has two independent profiles:

```text
delegatorProfile: provider, model, effort
workerProfile:    provider, model, effort, permissionMode
workerCapacity:   1–5, default 5
```

Claude may lead Codex workers, Codex may lead Claude workers, or one provider may fill both roles. A running session keeps the profile with which it launched. Profile changes affect future workers unless a selected session is explicitly restarted.

BDFL launches interactive provider CLIs and preserves their native authentication, settings inheritance, and session stores. Delegators receive read-only permissions, the short BDFL role instruction, and the session-only `bdfl-plan` skill. Workers receive only the approved clean shared contract, their chunk, dependency results, and execution metadata.

Provider-native lifecycle notifications feed BDFL's persistent attention markers. Claude receives session-level `Stop` and input-waiting `Notification` hooks through an additional `--settings` value; a packaged Node helper returns an internal BEL through Claude's `terminalSequence` field. Codex receives TUI notifications for completed turns, approval requests, and plan-mode prompts with the BEL method enabled regardless of terminal focus. BDFL consumes those BEL events internally: it does not add audible or desktop notifications.

The onboarding screen shows only provider CLIs found on `PATH`. Each installed provider has an ordered set of built-in model choices: Claude offers `fable`, `opus`, `sonnet`, and `haiku`; Codex offers `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, and `gpt-5.4-mini`. Every model supports `low`, `medium`, and `high` effort in the wizard. These choices are convenient defaults rather than an allowlist: **Type a model ID…** accepts any non-empty custom model ID for either role.

The planning profile accepts optional CLI arguments. BDFL tokenizes them without a shell and stores them as an argv array. It rejects pipes, redirection, substitutions, environment prefixes, headless modes, and flags it owns for model, effort, permissions, resume, MCP, hooks, and role injection. The complete accepted setup is saved locally and offered as **Last used** when the next workstream is created.

Worker access is fixed to accept edits (`workspace-write` in the durable profile), so onboarding does not ask users to choose a permission mode.

Ollama, local models, and additional provider CLIs are Coming Soon.
