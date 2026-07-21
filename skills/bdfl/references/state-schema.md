# State schema

Runtime state is atomic JSON under `.bdfl/state.json` with `version: 1` and durable arrays for runs, tasks, agents, unanswered events, append-only provider events, and integration attempts. Plan bodies do not live in runtime state.

Plans use `.bdfl/plans/index.json`, one readable plan directory with `plan.json`, and immutable Markdown files under `versions/`. Metadata records title, host, session, plan episode, native source path, timestamps, hashes, and the selected version.

Tasks contain readable titles, exact dispatched prompts, path ownership, dependencies, attempts, checkpoint commits, validations, and approval state. Agents link to tasks by `taskId` and retain provider session IDs for continuation. Durable unanswered records remain available for recovery but have no polling UI.
