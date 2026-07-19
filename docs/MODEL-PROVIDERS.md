# Model providers

Model values use `provider:exact-model:exact-effort`. The parser splits at the first and final colon, preserving tags such as `qwen3.5:9b`.

## Claude

Claude tasks run through the installed headless `claude` CLI with streaming JSON, explicit model, effort, and inherited permission mapping. Authentication stays in the host CLI.

## Codex

Codex tasks run through `codex exec --json`. The adapter passes `-m <exact-model>`, `model_reasoning_effort`, and the mapped sandbox. JSONL session, item, completion, and error events are normalized into BDFL state.

## Ollama

Ollama preflight checks the configured endpoint and exact local model. Under Codex, BDFL uses the Codex `--oss --local-provider ollama` harness. Under Claude Code, it uses the host's configured Ollama-compatible harness. BDFL never substitutes a cloud model.

## Failure behavior

Before dispatch, BDFL checks the harness executable, authentication surface, model, endpoint, and effort configuration. A failure becomes an agent/task error state with its original message. No alias, model, provider, endpoint, or effort fallback is automatic.

