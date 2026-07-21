# Repository guidance

Node.js 20+ and CommonJS are the compatibility baseline. Keep `src/` canonical; `plugins/bdfl/runtime/` is its generated mirror. Run `npm run package` after canonical runtime changes; CI rejects package drift. Never commit `.bdfl/` runtime state or worktrees.
