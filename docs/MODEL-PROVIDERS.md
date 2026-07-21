# Model providers

Model values use `provider:exact-model:exact-effort`. The parser splits at the first and final colon, preserving model names that contain colons.

## Discovery

BDFL detects only installed hosts. Codex discovery parses visible models and supported efforts from `codex debug models`. Claude honors configured `availableModels`; otherwise it uses built-in aliases and parses effort support from the installed CLI. The native selector asks for a model first and a supported effort second.

Settings version 2 keeps runtime-discovered specifications separate from user-added custom specifications. A current selection is preserved while it remains available. Otherwise BDFL selects the invoking host's discovered default. Discovery failures add no invented models.

## Claude

Claude tasks run through the installed headless `claude` CLI with streaming JSON, exact model and effort, and inherited permission mapping. Authentication and saved sessions remain in the host CLI. Deferred answers resume with `claude --resume <session>`.

## Codex

Codex tasks run through `codex exec --json` with the exact model, reasoning effort, and mapped sandbox. Deferred answers resume with `codex exec resume <session>`. JSONL sessions, questions, completions, and errors normalize into durable BDFL events.

## Ollama

Ollama support is coming soon. Provider implementation code remains available for continued development, and explicitly configured legacy custom models are preserved, but fresh settings do not include an Ollama model.

## Failure behavior

Before dispatch, BDFL checks the harness executable, authentication surface, exact allowlisted model, endpoint, and effort configuration. A failure becomes a recoverable workflow event. No alias, model, provider, endpoint, or effort fallback is automatic.
