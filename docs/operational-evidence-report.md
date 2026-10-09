# ISSUE-278 — Complete prospective operational samples

Issue: https://github.com/AegisFintech/scalping-bot/issues/278.
Source PR: https://github.com/AegisFintech/scalping-bot/pull/279.
Activation receipt PR: https://github.com/AegisFintech/scalping-bot/pull/280.
Dependencies: #222 operational qualification; qualified current demo status.

The existing observer preserves counters and only its last 64 transitions. Its
October 9 checkpoint has about 19,600 samples, no detected sampling gaps and
multiple normal waiting reasons. This cannot reconstruct 24 market-open hours
or exact broker/protection cycles. The original checkpoint stays unchanged.

The new collector preserves every future status sample in a separate private
JSONL journal. Registration fixes demo identity, exact current release, start,
1–168 hour deadline and 15-second cadence. Each line links the previous SHA-256
and sequence; strict schema validation, bounded size, timestamps and monotonic
close counters are checked on restart. No timer extends the original deadline.

The single writer holds a native `flock` for the complete collection process.
Each appended line is fsynced; parent-directory metadata is fsynced when registration and journal are created. Creation uses exclusive open and mode 0600;
malformed or partial crash tails halt without truncation, rewriting or resetting
old evidence. Restart resumes the same registration. A separate exclusively created registration
anchor is written before the journal. A missing journal with a retained anchor
halts rather than silently opening a new window; a rehashed registration that
disagrees with its anchor rejects. Retain both files together. Concurrent writers reject.
A valid-prefix truncation or deliberately recomputed chain needs an independently
retained prior digest to detect; hashes alone are not authenticated archival proof.
Retain published registration/tail digests separately from the private journal.

Only GET `http://127.0.0.1:8080/v1/status` is used, with a ten-second timeout and
256 KiB streamed response limit. No database, broker metadata refresh, provider,
control mutation or execution authority. Extracted samples exclude account IDs,
raw broker messages, credentials and economic balances. Network/invalid status
samples remain unavailable. A regressed close counter halts rather than resetting.
Input journals are bounded to 32 MiB and 40,321 samples; memory is capped at
384 MiB in the unit. Source is kept in a fixed read-only artifact, whose file and Node checksums are verified before each service start.

## What coverage means

The summary counts only intervals between adjacent available OPEN samples whose
session check and metadata were still fresh at capture. Both endpoints must be
valid; intervals over 45 seconds, first-sample time, missing samples and tail time
are excluded. Startup/operational readiness is counted separately from trading
eligibility: legitimate active groups and other fail-closed waits are not downtime.

These are **sampled-open milliseconds**, not continuous availability or independent
broker-calendar verified market-open hours. A brief unsampled failure can still
exist. `brokerCalendarVerifiedHours`, exact protected cycles, alert receipt and
current restore stay null; qualification is always UNQUALIFIED. The strict schema
forbids fabricated qualification and broker/promotion authority.

Observed alternating OPEN/UNAVAILABLE status does not alone establish a broker
outage. The session gate marks cached metadata unavailable after 30 seconds and
refreshes it at the next authorization check. Actual request/connection errors
must be distinguished using their own retained evidence; do not attribute them
to historical errors or relax freshness to improve a readiness metric.

## Collection and recovery

```sh
npm run demo:operational-evidence -- --release 0.3.0-fade-limit.3 \
  --hours 168 --output /private/new-operational-journal.jsonl
npm run demo:operational-evidence -- --summary /private/new-operational-journal.jsonl \
  --as-of 2026-10-09T04:00:00.000Z
```

The explicit summary cutoff must not precede the last retained sample. Summaries
are printed for exclusive private retention; individual journals never go to
GitHub. Do not overwrite old artifacts. Keep the exact fixed source/manifest,
registration and chain digest for recovery. Preserve valid prefixes and fault
artifacts when diagnosing corruption; never silently repair an incomplete tail.

The persistent `scalper-operational-evidence@.service` template uses a commit-named
artifact and separate StateDirectory. It survives reboot and resumes the same
journal. Resource limits, ProtectSystem/ProtectHome, private temporary storage,
no-new-privileges and bounded failure restarts apply. It never reloads trading
services, edits the private environment or changes financial state.

Activation follows full qualification and merged source. The previous #222
observer and frozen #255 study continue independently. Their old reports and
registrations are not migrated. Backup work remains explicitly deferred, not
fabricated as a passed restore. Frozen collection ends November 1 04:00 UTC;
30 days is a collection batch, not economic qualification.

## Validation

Eighteen focused tests pass: schema, integrity/order, gaps, stale/future/invalid
sessions, non-demo identity, clock/counter rejection, native lock collision,
crash tail, duration mismatch, mocked collection and byte-preserving restart.
Initial eight lint findings in streamed-byte typing and test matchers were
corrected. The first complete qualification passed 843 Node / 70 isolated DB /
261 Python tests, no skips and clean audits. A subsequent review found the
missing-journal restart reset gap; the independent registration anchor and two
additional tests close it. The second full run stopped at one caught-error cause-preservation lint finding
in the new missing-journal rejection; the cause is now retained internally while
CLI errors remain redacted. Streaming oversize and input-bound rejection tests
were also added. Final full qualification passes **847 Node tests in 111 files / 70 isolated TLS
PostgreSQL tests / 261 Python tests**, no skips. Formatting, ESLint, TypeScript
checks/build, Python Ruff/mypy, JSON Schema/migrations/replay/fail-closed coverage,
secret scanning and npm/pip audits all pass. Exact commands, durations and source
snapshot: [validation evidence](evidence/operational-evidence-validation.json).

Commands: `PATH=/opt/scalper-node22/bin:$PATH npm run qualify`;
`node node_modules/vitest/vitest.mjs run tests/operations/operational-evidence.test.ts
tests/operations/operational-evidence-cli.test.ts tests/schema/operational-evidence.test.ts`
(18 pass); `systemd-analyze verify systemd/scalper-operational-evidence@.service`
(passes); `graphify update .` (5,455 nodes / 10,460 edges, AST-only, existing empty
pyproject warning). The local wrapper uses Node 22.23.2/Python 3.13.5 and an
isolated PostgreSQL cluster; the original running source remains unchanged.
Documentation receipts follow this snapshot; hosted qualification covers the
actual committed source head before merge. Activation remains a separate receipt.

Read-only operational audit through October 9 01:35 UTC found 34 closes across
33 groups since the prior observer start, five reconciled UTC daily rows for
October 5–9 and 96 local HIGH_CPU alert records. No matching unlock/reset/control
rows occurred in this query. The matching outbox confirms all 96 alerts were accepted by the existing delivery
transport at read time (latest receipt 01:35:01.637 UTC); this is not human acknowledgment.
These aggregates do not prove exact protected
cycles, complete control history, continuous uptime or human alert acknowledgment.
Initial audit SQL alias syntax failed and was corrected; failed read-only
transactions changed no financial state. Frozen prospective summary verifies six
retained windows with HOLD and no due missing windows; no old report changed.

## Qualified activation — October 9

Source PR #279 merged at 02:03:22 UTC after both hosted full qualification runs
passed on exact head 141c7a3. Fixed artifact
`/opt/ctrader-ai-scalper/observers/issue-278-141c7a3` contains the four required
compiled modules, copied Zod dependency and strict schemas; all 727 manifest
entries including Node 22.23.2 verify. The independent expired-fixture smoke
passed without status, broker or provider calls.

The persistent `scalper-operational-evidence@141c7a3.service` is enabled and active,
with zero automatic restarts. Registration began **October 9 02:04:53.575 UTC**,
deadline **October 16 02:04:53.575 UTC**. Registration SHA-256:
`fe214d9719c41e2fb81101ddca8cbc40f5fdd7204ebaddf51b6945fa67370250`.
Journal and independent registration anchor are private in
`/var/lib/ctrader-ai-scalper/observations/issue-278-141c7a3/`.

A controlled normal **collector** restart preserved the same header, deadline and
complete retained record prefix, then appended new samples. Ten samples had been
verified at the receipt cutoff, with 126,338 sampled-open milliseconds; these are
not unattended qualification or a trading-worker/protection recovery drill.
The installed unit and resource/sandbox settings were inspected. All five demo
process definitions/PIDs, private environment content/mode and original frozen
checkout were unchanged; the old #222 observer and #255 timer remain active.
No broker/provider/control calls, trade resets or strategy changes were made.

[Activation and restart receipt](evidence/operational-evidence-activation.json).
The source and receipt are stored on GitHub; private databases and journal files
are not backed up by GitHub. Existing #222 qualification and #255 collection
remain open. No current restore, continuous market-open coverage or economic
qualification is claimed. Backup remains deferred by the operator.
