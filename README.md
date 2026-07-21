# BDFL

BDFL is a foreground terminal supervisor for delegator-led Claude Code and Codex workstreams. A read-only delegator creates and revises a dependency-aware plan; isolated interactive workers implement approved chunks; BDFL validates, consolidates, verifies, and presents one final integration commit.

## Install and run

Requires Node.js 20+ on macOS or Linux.

```bash
npm install -g bdfl
cd your-git-repository
bdfl
```

BDFL uses the alternate screen and restores existing scrollback on exit. `Ctrl+]` toggles chrome and provider focus. While provider content is focused, arrows and `Ctrl+C` go to the provider. Each workstream independently chooses its delegator provider/model/effort, worker provider/model/effort/permission mode, and active worker capacity from 1–5 (default 4).

All state lives under ignored `.bdfl/`. The foreground supervisor is the only durable-state writer, and one workspace lock prevents concurrent supervisors. Closing a pane stops its PTY but retains its provider session ID, worktree, branch, profile, and snapshot for interactive resume.

## Planning and execution

BDFL injects the packaged `bdfl-plan` skill only into managed delegators. The skill teaches the model to create the fewest useful chunks, with stable owned paths, hard `dependsOn` edges, and concurrency locks. Capacity is a ceiling, not a chunk target.

Marker-bearing source is retained for debugging. Native Plan views and workers receive clean Markdown. Approvals bind plan/version/section/SHA; unchanged sections retain approval across targeted patches. Shared changes invalidate all dependent approval, and graph metadata changes invalidate affected downstream sections.

The single local `bdfl_workers` MCP tool offers `status`, `execute`, `wait`, `complete`, and `send`. It never returns plans, diffs, logs, or terminal transcripts. Workers cannot create workers. Root chunks branch from the frozen baseline; dependent chunks branch from accepted predecessor results. Named locks and capacity constrain only active PTYs.

Worker completion is checked against actual changed paths and deterministic local checks. Accepted results consolidate in dependency order. Conflicts go to a worker, never the delegator. A fresh read-only worker performs global verification. Final integration requires a clean unchanged target and creates one workstream commit.

## Custom launch profiles

`Type your own` accepts safely tokenized interactive commands beginning with `claude` or `codex`. Shell operators, substitutions, environment prefixes, arbitrary executables, headless modes, and BDFL-owned resume/MCP/model/effort/permission flags are rejected. Profiles are stored as argv arrays in `.bdfl/config.json`. Profile deletion and reordering can currently be done by editing that file while BDFL is closed.

## Releases

Every successful `main` push publishes an npm `staging` prerelease without moving `latest`. Published GitHub Releases pass the protected `production` environment, test Node 20/22/current, and publish `latest` with npm OIDC provenance. Release assets include the tarball, SHA-256, CycloneDX SBOM, and [support policy](SUPPORT.md). BDFL checks npm nonblockingly on launch; offline startup is unaffected.

## Coming soon

Ollama/local models, native Windows, Aider, OpenCode, Goose, Gemini CLI, Qwen Code, remote peers and sessions, session renaming, launch-profile deletion/reordering UI, and tiled worker monitoring.

See [SECURITY.md](SECURITY.md), [CONTRIBUTING.md](CONTRIBUTING.md), and [LICENSE](LICENSE).
