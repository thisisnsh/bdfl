# Permissions

BDFL preserves the parent permission mode. Native parent plan mode maps to the host's ordinary default execution mode because agents execute only after planning is complete.

Read-only remains read-only, workspace/default access remains scoped to the isolated task worktree, and full access remains explicit. A request to change modes suspends the agent and creates an Inbox item. The agent cannot infer approval, answer its own request, or widen allowed paths.

Non-interactive provider runs can fail before producing a structured permission event. BDFL records that failure visibly rather than retrying with broader access.

Dirty main worktrees block dispatch. BDFL asks the user to clean the tree, authorize a recoverable snapshot, or cancel; it never stashes or commits user work automatically.

