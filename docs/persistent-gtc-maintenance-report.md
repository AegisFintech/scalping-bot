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
logged. AST graph update passes (5,473 nodes / 10,491 edges), with the existing
empty-pyproject warning. Final staged diff and secret scan precede commit; both
current-head hosted full qualifications must pass before merge.

## Execution-only activation receipt

Source PR [#284](https://github.com/AegisFintech/scalping-bot/pull/284) merged as
`a5466c3608e73054b8467203e29a7ad272dd6083` after both full hosted runs
37876073509 / 37876067156 passed on qualified source `9b35d877`. The exclusive
artifact `/opt/ctrader-ai-scalper/releases/9b35d877` records that exact source and
qualification. Manifest SHA-256:
`6ad407d9aeccb9732b544428b2bbfbfe6ebcb718c613b459cf33e6f8a3c00667`.
Preparation, pre-start and post-start manifest verification all pass; compiled
operating code has no call to context-age recall. Node remains 22.23.2.

Only `scalper-execution` was stopped normally, its PM2 definition replaced and
started with the new verified release and protected existing environment. The
other four services keep their exact definitions, PIDs, uptimes and restart counts.
No emergency stop, cancellation, analysis, reset or migration was invoked by the
activation commands. Native broker-held SL/TP protected the existing owned open
position before restart. The worker's ordinary reconciliation/maintenance retains
its existing authority after startup; no unknown command is manually replayed.

After the new definition was confirmed online, a separate status review verified
demo fade-limit.3, startup checks passed and operational readiness. The one open
position still had fresh VERIFIED broker SL/TP. New analysis remained withheld for
`RELEVANT_POSITION_EXISTS`; this is expected waiting, not a failed activation.
The new PM2 definition has zero restarts; this does not erase the prior definition's
historical restart evidence. Definitions were saved only after verification.

Private environment bytes/mode and original clean `984f479` checkout are identical
before/after. The six retained study reports/registration and operational journal
registration are unchanged. Both operational collectors and the research timer
remain active. Latest retained journal review has 173 samples, ten unavailable
samples and no >45-second gaps; unavailable samples are not discarded.

The first status probe finished before the old worker had stopped and is retained
as pre-start evidence, not restart proof. The separate confirmed post-start probe
is the activation evidence. Likewise the earlier primary-guide receipt CI attempt
37875538279 failed at Python audit (exit 1; detailed audit output was not retained).
Its full rerun passed; the parallel run 37875534640 passed. No audit was disabled
or failure bypassed, and no unverified cause is assigned to that failure.

Sanitized [activation receipt](evidence/persistent-gtc-activation.json) records the
artifact, checks and finite recovery evidence. This fixes operating GTC persistence,
but does not prove 24 broker-calendar market-open hours, uninterrupted protection,
complete group cycles, production reconnect/dependency recovery or restore.
#222 remains open; backup/restore remains deferred. #255 still needs its original
30-window collection and independent economic review. No profitability or promotion
claim is made.
