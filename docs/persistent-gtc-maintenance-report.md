# ISSUE-283 — Preserve accepted GTC in operating maintenance

Issue: https://github.com/AegisFintech/scalping-bot/issues/283.
Dependency: #281 contract review; operational proof remains #222.

The current worker configured a 30-minute context-age recall and invoked it from
independent maintenance. Expired provider context could therefore cancel accepted
GTC orders, including uncertain/partial states selected by the legacy query. This
contradicted the authoritative GTC operating requirement. Provider expiry limits
fresh submission; it does not authorize cancellation of accepted orders.

The operating worker no longer supplies recall options or calls context-age recall.
A narrow maintenance entry point exposes only emergency cancellation and existing
expiry/peer reconciliation. It cannot invoke recall. The historical helper, release
constants, tests and archived reports remain intact; no historical event is rewritten.

Normal GTC null expiry continues through `expireAndReconcile`; historical GTD expiry,
OCO filled/terminal peer cleanup and exact ownership proof remain unchanged. An
explicit emergency still cancels owned orders. Recovery refresh runs even when
emergency cancellation or reconciliation throws; failures propagate without command
retry or financial reset. Filled-position SL/TP maintenance remains independent.

This corrects persistence authority, not entry/TP or economic tuning. It changes no
risk percentages, provider identity/prompt, admission economics, schema, migration,
private environment or model history. Four new behavior tests cover normal GTC,
emergency cancellation, uncertain reconciliation and failed cancellation; existing
peer/GTC/GTD tests remain required. Qualification does not establish profitability.

Runtime rollout is separate: source merge does not change the pinned demo artifact.
Prepare a new exclusive qualified artifact and verify its manifest, source/runtime
identity and private configuration before any reviewed activation. Preserve accepted
orders, live disablement, durable financial state and unknown-command reconciliation.
The original #255 frozen source and registrations remain untouched; research source
drift must halt research only. No automated promotion or backup operation is added.

## Validation

`PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed every gate:
851 Node tests in 112 files, 70 isolated TLS PostgreSQL lifecycle tests and
261 Python tests, no skips. Formatting, lint, TypeScript/Python types, isolated
build, schema/migration/replay/fail-closed checks, secret scan and both dependency
audits pass. Exact commands/results: [validation receipt](evidence/persistent-gtc-validation.json).
Evidence directory: `/tmp/scalper-qualification-OmY06r/checks`; source SHA-256
`618fc487f72d5ddabd135ffbd75959a529bc4061e2dd6315747dbf929ea22ef6`.

The first qualification stopped at four `require-await` lint findings in new
mock callbacks. Explicit resolved/rejected promises fixed them; final full
qualification passed. Seventeen focused maintenance tests passed before the
full run. Both policy and `--startup` configuration checks passed with 20 normal /
24 protected file assignments, literal Grok and no obsolete keys; values are not
logged. AST graph update passes (5,473 nodes / 10,490 edges), with the existing
empty-pyproject warning. Final staged diff and secret scan precede commit; both
current-head hosted full qualifications must pass before merge.
