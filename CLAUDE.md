# BDFL development

Follow [AGENTS.md](AGENTS.md). The product is a foreground terminal supervisor; there is no installer, global host registration, status-line hook, headless broker, or provider plugin.

Canonical runtime code lives in `src/`. `plugins/bdfl/runtime/` is generated only for repository drift checks. After changing `src/`, run:

```bash
npm run package
npm test
npm run validate
```

The packaged planning skill lives in `skills/bdfl-plan/` and is injected only into managed delegators. `.bdfl/` contains sensitive local runtime state and must never be committed.
