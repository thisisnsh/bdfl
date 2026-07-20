# State schema

State is JSON under `.bdfl/state.json` with `version: 1` and arrays for `runs`, `plans`, `tasks`, `agents`, `inbox`, and `events`. Writes are atomic through a sibling temporary file and rename.

Every record has an internal ID and timestamps. Plans belong to a run, contain immutable numbered versions, and have one optional selected version. Tasks contain a readable title, exact dispatched prompt, path ownership, dependencies, attempts, validations, and approval state. Agents link to tasks by `taskId`; user-facing labels use the task title. Inbox items reference an agent and event and remain open until explicitly answered or dismissed.

Global settings live in the platform config directory and use:

```json
{
  "version": 1,
  "defaultModel": "claude:sonnet:medium",
  "models": ["claude:sonnet:medium"],
  "maxAgents": 4,
  "ollamaBaseUrl": "http://localhost:11434"
}
```

Parse model specs at the first and final colon so `ollama:qwen3.5:9b:medium` preserves `qwen3.5:9b` as the model.
