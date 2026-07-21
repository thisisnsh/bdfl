# Model providers

Model values use `provider:exact-model`. The parser splits at the first colon, preserving model names that contain colons. Reasoning effort is a runtime policy and is currently always `medium`; it is not configurable in settings or model selectors.

## Discovery

BDFL detects only installed hosts. Codex discovery parses visible models from `codex debug models`. Claude honors configured `availableModels`; otherwise it uses built-in aliases. The native selector asks only for a model.

Settings version 3 keeps runtime-discovered specifications separate from user-added custom specifications. Version 2 settings migrate by removing stored effort suffixes and unavailable-provider entries. A current selection is preserved while it remains available. Otherwise BDFL selects the invoking host's first discovered model. Discovery failures add no invented models.

## Claude

Claude tasks run through the installed headless `claude` CLI with streaming JSON, the exact model, medium effort, and inherited permission mapping. Authentication and saved sessions remain in the host CLI. Deferred answers resume with `claude --resume <session>`.

## Codex

Codex tasks run through `codex exec --json` with the exact model, medium reasoning effort, and mapped sandbox. Deferred answers resume with `codex exec resume <session>`. JSONL sessions, questions, completions, and errors normalize into durable BDFL events.

## Ollama

Ollama support is coming soon. Provider implementation code remains available for continued development, but Ollama models are not exposed in settings or selectors.

## Failure behavior

Before dispatch, BDFL checks the harness executable, authentication surface, exact allowlisted model, and endpoint. A failure becomes a recoverable workflow event. No alias, model, provider, or endpoint fallback is automatic.
