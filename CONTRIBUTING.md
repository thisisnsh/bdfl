# Contributing

Use Node.js 20 or newer. Keep changes atomic and do not edit packaged copies directly.

```bash
npm run package
npm test
npm run validate
```

Add deterministic tests for behavior changes. Real-provider smoke tests must remain opt-in and must not expose credentials. Update user documentation when commands, settings, permissions, recovery, or limitations change.

Pull requests should explain the safety boundary affected, include validation evidence, and leave the worktree clean. By participating, follow the [Code of Conduct](CODE_OF_CONDUCT.md).

