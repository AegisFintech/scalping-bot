# ISSUE-259 — Reproducible release qualification

Issue: <https://github.com/AegisFintech/scalping-bot/issues/259>.
Depends on [batch 258](upgrade-batch-258-report.md).

Dependencies are updated narrowly: Fastify 5.12.5, transitive fast-uri 3.1.8 / 4.2.1,
brace-expansion 5.0.12 and urllib3 2.8.0. Clean npm and Python environments were
installed in the isolated checkout. Both dependency audits report zero known
vulnerabilities. Active dependencies and the frozen observer lockfiles remain
untouched; deployment requires a separately reviewed release.

The credential scanner checks tracked and eligible untracked files, recognizes
API-key boundaries rather than matching the `sk-` substring in risk-budget
filenames, and prints only filename/line/category. Tests prove that API keys,
bearer tokens, populated assignments and private keys reject without printing
values. Test files are now included; no blanket fixture exclusion is used.

The five existing Prettier failures and dashboard Ruff grouping difference are
formatted without economic changes. The CLI exclusive-output/redaction test gives
its three subprocesses explicit ten-second deadlines and a bounded 35-second
aggregate test budget, preserving assertions rather than removing coverage.

`scripts/qualify.mjs` requires Node 22, initializes its own PostgreSQL cluster on
a loopback ephemeral port with a one-day test TLS certificate and verified CA,
and injects only that TEST_DATABASE_URL into lifecycle/storage tests. It removes
the production DATABASE_URL from child environments, stops the disposable cluster
and removes its data/private test key in final cleanup. It does not connect to or
migrate the production database. Logs are retained privately under /tmp.

The first actual database run exposed 24 failures hidden by prior skips: migration
expectations stopped at 0024, and current-context fixtures still requested the
retired provider. Fixtures now include 0025/0026 and use the current configured
provider identity; historical migration/model tests remain unchanged. No production
identity check was relaxed. The corrected suite passes all 70 integration tests with no skips. Assertions
retain cancel rejection before its proof and keep unresolved protective-child
evidence blocking after a separately proven cancel rejection resolves.
Python/full cross-batch results are recorded in the final qualification report.

The GitHub workflow pins Node 22.23.2, Python 3.13.5 and official action commit
SHAs, installs native PostgreSQL (no container requirement), and runs full
qualification. Its first remote run remains separate evidence from local success.
Rollback restores source/lockfiles only in a prepared release; never install old
locks over active environments or edit the existing research registration.

Final combined validation and remote delivery: [upgrade delivery report](upgrade-delivery-report.md).
