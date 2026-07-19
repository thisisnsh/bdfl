# Security policy

Report vulnerabilities privately through GitHub Security Advisories for `thisisnsh/bdfl`. Do not open a public issue containing credentials, exploit details, private logs, or sensitive repository content.

Supported releases are the latest tagged release and `main`. Include impact, reproduction steps, affected host/provider, and a minimal proof of concept. Allow maintainers time to investigate before disclosure.

BDFL stores local logs and prompts under `.bdfl/`. Treat that directory as sensitive. Use least privilege, review agent diffs, keep provider authentication in host-managed stores, and never bypass checksum failures.

