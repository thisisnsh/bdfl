# Contributing

Thanks for helping make supervised multi-agent work calmer and safer.

## Set up

```bash
git clone https://github.com/thisisnsh/bdfl.git
cd bdfl
npm ci
npm test
```

Use Node.js 20 or newer. Claude Code and Codex are needed only for opt-in provider smoke testing; the deterministic suite must not require credentials.

## Make a change

- Keep `src/` canonical. Never edit `plugins/bdfl/runtime/` directly.
- Run `npm run package` after canonical runtime changes.
- Add deterministic tests with behavior changes.
- Keep `.bdfl/`, provider transcripts, credentials, and local worktrees out of commits.
- Update user-facing documentation when commands, profiles, permissions, recovery, packaging, or limitations change.
- Prefer small imperative commit subjects without Conventional Commit prefixes or trailing periods.

## Verify

```bash
npm run package
npm test
npm run validate
npm pack --dry-run
git status --short
```

Pull requests should explain the user-visible outcome, safety boundary, and validation evidence. Follow the [Code of Conduct](CODE_OF_CONDUCT.md) and report vulnerabilities through the private path in [SECURITY.md](SECURITY.md).
