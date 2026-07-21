# Plan format

Emit Markdown bounded by `bdfl-plan` schema-1 comments, with exactly one `bdfl-shared` section, one or more `bdfl-chunk` sections, exactly one `bdfl-global` section, and `bdfl-plan:end`. Chunk metadata is one-line JSON containing stable kebab-case `id`, repository-relative `paths`, `dependsOn`, and normalized kebab-case `locks`. Do not emit a wave field.

Every chunk body contains `## <title>`, `### Outcome`, `### Implementation`, `### Local validation`, and `### Acceptance conditions`. Full revisions begin with `bdfl-plan-patch` metadata containing schema, planId, and baseVersion; include only complete changed shared, chunk, or global sections and end with `bdfl-plan-patch:end`.
