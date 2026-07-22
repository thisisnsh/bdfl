# Permissions

Planning and verification never authorize implementation work. Claude delegators and verifiers default to `manual` mode and rely on their role instructions and native permission prompts. Codex and Ollama-backed Codex delegators and verifiers default to the read-only sandbox.

Workers default to BDFL's accept-edits policy inside their isolated worktree. The durable profile records this as `workspace-write`; provider adapters translate it to Claude's `acceptEdits` mode or the Codex workspace-write sandbox. Ollama sessions use that same Codex sandbox after the Ollama launch separator. BDFL never defaults any role to Claude `bypassPermissions` or the Codex `danger-full-access` sandbox.

Agent options can explicitly select safe alternatives to these defaults. Claude `--permission-mode` values other than `bypassPermissions` pass through unchanged. Codex `--sandbox`, `--ask-for-approval`, and their configuration equivalents also pass through when they do not select `danger-full-access`; Ollama forwards those options to its underlying Codex session. When an option supplies a safe sandbox or permission mode, BDFL does not append a conflicting role default.

Dangerous provider options cannot be stored in an agent profile. `bdfl --dangerous` is the only bypass opt-in: it launches Claude with `--dangerously-skip-permissions` and launches Codex or Ollama-backed Codex with `--dangerously-bypass-approvals-and-sandbox`. The switch applies to every agent launched or restored during that supervisor process and is not persisted.

Permission is only one boundary. BDFL also verifies actual changed paths against the approved chunk, reruns deterministic argv-based checks, keeps conflicts inside integration worktrees, and refuses final integration when the target branch, HEAD, or cleanliness changed.

Custom profile commands never pass through a shell. BDFL owns provider/profile selection, resume, MCP, model, effort, hook/settings, notification, dangerous access, and role flags; safe provider-native permission, sandbox, and approval options remain user-controlled.
