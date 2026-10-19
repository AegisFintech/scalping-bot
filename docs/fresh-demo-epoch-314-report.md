# ISSUE-314 — Operator-authorized fresh demo epoch

Issue: https://github.com/AegisFintech/scalping-bot/issues/314.
PR: https://github.com/AegisFintech/scalping-bot/pull/315.
Status: fresh demo and epoch-aware research feed activated; final delivery receipt under qualification.

On October 19 the operator explicitly requested “clear all historical records and
start from afresh” after reviewing the legacy conflict blocker. This authorizes a
one-time fresh local demo accounting epoch. The implementation uses a separate
empty operational database; previous history is absent from the new dashboard,
but the old database and immutable research/evidence remain isolated. There is no
DELETE/TRUNCATE, broker balance reset, history import or assertion that discarded
callbacks were harmless. This authorization is not a recurring recovery shortcut.

## Transition and acceptance

1. Verify current explicit demo authorization and the existing selected demo
   account, empty broker orders/positions, complete current-day deals/flows and no
   in-flight provider request. Stop only the five trading services normally before
   cutover; no forced cancellation, closing or callback replay.
2. Create a separate local database from existing forward migrations, preserve TLS
   and application/migration role separation, and use separate writable runtime
   and logs. Keep existing subscription/broker authentication; credentials alone
   do not grant trading authority. Use a new protected environment derived from
   the existing file, retaining its original values except database/runtime and
   temporary maintenance controls.
3. Prepare a fully qualified immutable release. Start with emergency stop enabled,
   submission and automatic analysis disabled. Initialize reconciled daily/capital
   baselines through the existing authenticated audit endpoint. Reject nonempty
   broker state or current-day trades; never insert an invented balance. Verify
   the second initialization rejects and the baseline survives restart.
4. Restore the existing authorized demo controls, verify actual supervisor paths,
   config checks, broker/session/account state and all gates. Observe natural
   market-open evaluation without forcing a provider call or order. Both legs
   continue sharing the dynamic 1% setup ceiling. Live remains disabled.
5. Point maintenance at the new runtime/database only. Keep the frozen #255
   checkout, registrations, reports and old source environment unchanged; the
   epoch boundary is explicit, not a fabricated continuous trading series.

The current Grok/fade policy remains unchanged. Codex transport/research work is
separate from activating a different trading provider. No economic strategy,
leverage, sizing percentage or protective maintenance change is included.

## Operational limits and rollback

The initial filesystem had only about 1.7 GiB free (97% used). Regenerable package
caches are being reclaimed before deployment; historical trading/research files
are not disposable build cache. Record final free space and storage health.
Backup work remains operator-deferred; do not claim a restore or external backup.

Before any new activity, stop the new services and retain both databases if
activation fails. After any new request/order/accounting activity, the old database
is no longer a valid execution rollback target. Roll back compatible code only
against the newest database, preserve every new claim/order/accounting row and
reconcile broker truth. Never run both epochs' trading writers concurrently.

## Validation

Full local qualification and final-head hosted checks are required before rollout.
The existing authenticated baseline initializer and lifecycle tests supply success,
repeat-rejection and fail-closed coverage; no executable source behavior is changed.
Operational checks and immutable release/configuration receipts will be added
without private identifiers, credentials, URLs or raw broker payloads.

## Pre-cutover evidence

At October 19 06:07 UTC, independent read-only broker checks showed balance and
equity **85,360.83 USD**, zero orders/positions, zero current-day deals, complete
deal history and zero external flow operations. The old journal contains 1,165
trades, one REQUESTING context from October 5 and one FAILED group from September
10, with no open local position. The stale request remains unknown in the old
journal; it is not replayed or relabelled successful. These timestamps exclude
an active current provider dispatch, but fresh broker checks repeat at initialization.

A new separate database contains all 28 forward migrations; every stored checksum
matches the qualified source. Migrations ran through local PostgreSQL peer admin
under the existing migration owner, with the same per-file transactions/checksum
ledger; the application role retains separate DML privileges. No old database
rows changed. The new mode-0600 environment differs only in DATABASE_URL, an
explicit existing token-state path and temporary emergency/submission/automation
controls. A new runtime/log root starts empty. Original credentials and the old
source environment remain unchanged.

Full `npm run qualify` passed at `/tmp/scalper-qualification-xQifvb/checks`: all
format/lint/TypeScript/build/Node/schema/migration/replay/fail-closed, Python
format/lint/types/tests, isolated database, secret scan and both dependency audits.
Regenerable npm/pip cache removal raised free disk from about 1.7 to 3.6 GiB.
Release preparation and hosted qualification remain required before cutover.

## Activation receipt

Both complete hosted checks passed on `70a7d48` (39208504004 / 39208508811).
The immutable release `/opt/ctrader-ai-scalper/releases/70a7d48-epoch314` was
prepared against the full local qualification and its manifest verified. All five
PM2 services were stopped normally and recreated with that exact cwd, pinned Node
22 and the new protected environment; none caches DATABASE_URL. The frozen
checkout and old environment were not changed. The application role has no schema
DDL permission: the migration-status CLI correctly failed its CREATE TABLE attempt;
a read-only TLS query independently verified all 28 migration checksums instead.
Application writes to the migration ledger were explicitly revoked.

At **2026-10-19 06:16:40.511 UTC**, the authenticated initializer recorded certain
reconciliation for the new daily/capital baseline. Its repeat returned HTTP 409 /
DAILY_RISK_BASELINE_ALREADY_EXISTS. Baseline/reference/high-water evidence hashes
matched before and after a normal execution restart while submission was disabled.
Existing authorized demo controls were then restored; no provider call or order
was manually forced. The first natural context placed two entries: one FILLED,
one CANCELLED, one OPEN position with VERIFIED protection, and zero conflicts.
A transient session-unavailable status cleared to OPEN; active-analysis/position
waiting is normal exclusion, not the old recovery lock. This is operational demo
evidence, not a completed profitability trial or guaranteed future continuity.

Storage timers now target only the new database and real state directories. The
first maintenance invocation rejected a symlinked log-directory argument; passing
the actual state/log paths corrected it without weakening validation. Remaining
storage warnings are low disk space (about 2.7 GiB after the pinned release) and
backup overdue in the new epoch. No new backup/restore success is claimed. The
existing backup schedule remains configured; off-server backup work stays deferred.

## Research epoch boundary

The Codex feed receives an explicit UTC epoch start and clips its reporting window
to the later of that timestamp or its normal seven-day boundary. It waits without
an export/provider call when the new epoch has no completed UTC reporting interval.
It rejects future/non-UTC starts and mismatched returned windows. Pre-epoch absence
is not published as zero performance. The partial first day is honestly labelled
with the exact start timestamp. No new schema, promotion authority or frozen-study
registration is introduced. The original latest aggregate will be retained outside
the active latest pointer; original reports/weekly claims remain unchanged.

The new feed uses a separately pinned qualified Python bundle and the new database
environment; it does not alter the immutable trading release. Ten focused feed
tests cover clipping, future/naive rejection, first-window waiting without export,
exact requested/returned windows, explicit empty-epoch rejection, CLI waiting, timeout and immutable publication. Full final
qualification gates this feed deployment and PR completion.

## Final feed deployment and delivery qualification

Both full hosted checks pass on `43d788bf64d919810413b697c892a0e3f4d7c4dc`:
[push 39209802552](https://github.com/AegisFintech/scalping-bot/actions/runs/39209802552)
and [PR 39209807766](https://github.com/AegisFintech/scalping-bot/actions/runs/39209807766).
They include every required quality gate and dependency audit. The earlier full
local trading-release qualification includes 884 Node and 89 PostgreSQL cases;
the final feed adds five cases to the existing five, all ten focused tests pass.
Python types/lint and graphify refresh pass; no semantic-graph/provider call was
used. This final receipt receives exact-head hosted checks before merge.

The trusted feed now runs a six-file tracked-source bundle pinned to `43d788b`,
verified byte-for-byte against Git. Its working directory/PYTHONPATH select that
bundle; its existing isolated Python environment remains unchanged. It exports
from the verified `70a7d48-epoch314` trading release and new protected database
environment, with the audited epoch timestamp fixed in its unit. The old latest
aggregate was retained as `pre-epoch-314-latest.json`, alongside original immutable
archives. The active latest pointer remains absent until the new reporting window
exists. The deployed service succeeded with RESEARCH_FEED_WAIT_NEW_EPOCH and zero
provider calls. The hourly timer is active; the next UTC day permits a first
partial-day aggregate. No weekly claim was replayed or candidate promoted.

The old database now defaults to read-only for new connections. Its rows, old
environment and frozen #255 checkout remain preserved; the checkout is clean at
`984f479`. Frozen registrations/reports are not edited. The new operational review
pointer selects the fresh environment, with the original pointer retained privately.
A private durable fresh-epoch receipt records explicit discontinuity and the
verified baseline/restart checks. Never treat this as proof that old conflicts
were resolved or that historical returns were erased at the broker.

Post-start release-manifest verification passes. Analytics, market, AI, dashboard
and execution health endpoints all return 200. All five PM2 services are online
with only the deliberate activation/restart counts. At the follow-up observation
the first position remained OPEN with VERIFIED protection, its peer CANCELLED,
and no broker-event conflict. Waiting for that position is expected; do not force
a second setup. Low-disk and new-epoch backup-overdue storage warnings remain
explicit. No code/database rollback to the pre-epoch journal is now permitted.

## Frozen-study boundary

The older #255 observer service's last attempt was **06:15:14 UTC**, before the
new baseline, and failed with FORWARD_DISK_RESERVE. That pre-existing failure is
not attributed to the fresh database. Its timer is now stopped because the
production accounting source has changed; the old database remains historical
read-only evidence. Frozen code, registered denominators/windows and reports are
unchanged. Uncollected windows remain missing, never zero performance or a
selected complete subset; the old study is not qualified. New research collection
requires its own prospective registration/review. The independent Codex feed and
candidate intake remain active on their documented boundaries.
