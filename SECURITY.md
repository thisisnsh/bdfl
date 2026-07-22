# Security policy

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/thisisnsh/bdfl/security/advisories/new). Do not open a public issue containing credentials, exploit details, private terminal output, provider transcripts, or repository content.

The latest stable release and `main` receive security fixes. Include impact, reproduction steps, provider/version details, and the smallest safe proof of concept. Allow maintainers time to investigate before disclosure.

## Local data

BDFL keeps plans, prompts, one-line task snippets, agent names, events, terminal snapshots, diffs, session metadata, worktrees, and execution records under repository-local `.bdfl/`. Planning snippets retain the latest substantive submitted prompt; worker snippets summarize their assigned plan chunk. Treat all of it as sensitive. It is excluded through local Git metadata and must never be committed or shared without review.

Provider authentication remains in the provider's native store. BDFL does not ask for or persist Claude, Codex, npm, or GitHub credentials.

## Network behavior

BDFL performs a short nonblocking request to the public npm registry on launch to check for updates. Offline failure does not block the terminal. Provider CLIs and npm retain their own network behavior. BDFL has no analytics account or application telemetry service.

## Execution boundaries

- Delegators are read-only.
- Custom commands are tokenized without a shell.
- Workers operate in isolated Git worktrees with explicit permission profiles.
- Changed paths and deterministic checks are verified before acceptance.
- Final integration stops on target branch, HEAD, or cleanliness drift.
- One supervisor lock protects durable workspace state.

Use least privilege, inspect diffs before acceptance, and keep provider CLIs and Node.js patched.
