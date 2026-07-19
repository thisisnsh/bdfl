# Repository guidance

Node.js 20+ and CommonJS are the compatibility baseline. Keep `src/` and the command skills under `skills/` canonical. Run `npm run package` after canonical runtime or skill changes; CI rejects package drift. Never commit `.bdfl/` runtime state or worktrees.
