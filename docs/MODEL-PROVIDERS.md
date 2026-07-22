# Claude, Codex, and Ollama profiles

Each workstream has two independent profiles:

```text
delegatorProfile: provider, model, effort
workerProfile:    provider, model, effort, permissionMode
workerCapacity:   1–5, default 5
```

Claude, Codex, and Ollama may be mixed between planning and worker roles, or one provider may fill both roles. A running session keeps the profile with which it launched. Profile changes affect future workers unless a selected session is explicitly restarted.

BDFL launches interactive agent CLIs and preserves their native authentication, settings inheritance, and session stores. Ollama uses its supported Codex integration: BDFL runs `ollama launch codex --model <id> --yes -- ...`, and the arguments after `--` carry the same managed Codex contract as a direct Codex session. Delegators receive read-only permissions, the short BDFL role instruction, and the session-only `bdfl-plan` skill. Workers receive only the approved clean shared contract, their chunk, dependency results, and execution metadata.

Provider-native lifecycle notifications feed BDFL's persistent attention markers. Claude receives session-level `Stop` and input-waiting `Notification` hooks through an additional `--settings` value; a packaged Node helper returns an internal BEL through Claude's `terminalSequence` field. Direct Codex and Ollama-backed Codex sessions receive TUI notifications for completed turns, approval requests, and plan-mode prompts with the BEL method enabled regardless of terminal focus. BDFL consumes those BEL events internally: it does not add audible or desktop notifications.

The onboarding screen shows only provider executables found on `PATH`; it does not query accounts, the Ollama daemon, or installed models. Claude offers `fable`, `opus`, `sonnet`, and `haiku`; Codex offers `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.4`, and `gpt-5.4-mini`. Ollama has no built-in catalog and goes directly to required manual model-ID entry. Every provider offers `low`, `medium`, and `high` effort in the wizard. The built-in Claude and Codex choices are convenient defaults rather than allowlists: **Type a model ID…** accepts any non-empty custom ID.

Profiles accept optional CLI arguments. BDFL tokenizes them without a shell and stores them as an argv array. Ollama profile arguments are passed to Codex after the launcher's `--` separator. BDFL rejects pipes, redirection, substitutions, environment prefixes, headless modes, and flags it owns for model, provider/profile, effort, permissions, resume, MCP, hooks, and role injection. The complete accepted setup is saved locally and offered as **Last used** when the next workstream is created.

Worker access is fixed to accept edits (`workspace-write` in the durable profile), so onboarding does not ask users to choose a permission mode.

Ollama requires the `ollama` executable, a running Ollama service, and a current Codex CLI. `--yes` prevents a nested model selector and lets Ollama prepare the exact model ID saved in the BDFL profile. BDFL captures the underlying Codex session identity so Close, Quit, bridge recovery, and Sessions reopening retain conversation history.
