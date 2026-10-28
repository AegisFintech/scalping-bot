# ISSUE-392 — Fill evidence integrity

Child of [the review and scalping redesign](https://github.com/AegisFintech/scalping-bot/issues/391).
This repair changes read-only research only. Trading, prompt v5, sizing, native
protection, accepted groups, observers, accounting and running artifacts are unchanged.

## Corrections

New exports and reviews use additive `fill-evidence-input-1.1` and
`fill-gap-review-1.1` with required instrument identity. Older schema files,
retained reports, frozen source and registrations stay immutable. Re-export old
input rather than relabeling its version. The retained pattern command remains
byte-for-byte reproducible against the original cohort.

- Each market sample must match the exported symbol. Unknown or mismatched samples
  provide no quote/depth evidence.
- Visible depth eligibility uses local capture time after verified source/receipt
  ordering, and still requires a fresh source. A later snapshot carrying an older
  last-spot timestamp cannot become pre-fill liquidity.
- Aggregate market quotes cannot attest each side's update time. They supply no
  fill-price reference; only Flight events with explicit side updates can. Quotes
  received after a fill are excluded. This deliberately increases unavailable data.
- The exporter resolves the exact position's latest immutable OBSERVATION event
  known and observed before the close, within three seconds. A later mutable
  protection row cannot rewrite historical close classification. Unverified or
  missing/stale history stays unknown. The reader role needs SELECT on
  `position_protection_events`; this delivery does not change production grants.
- Readers cap paths at 4,096, sessions per setup at 64, decoded market bytes at
  64 MiB and samples at 100,000. Flight records/decoded bytes are bounded both per
  setup and across the review. Oversized inputs fail instead of selecting a subset.
- The Python audit result is narrowed explicitly, fixing the pulled type failure.

## Verification and limits

Qualification also found the existing `msgpack==1.2.1` lock vulnerable to
[CVE-2026-114613](https://github.com/msgpack/msgpack-python/security/advisories/GHSA-j586-36cw-2gc2).
The lock now pins patched 1.2.3. A clean Python 3.13 development environment was
installed from that lock; the previous environment is preserved outside the
repository, and immutable deployed/observer environments were not modified.

Four regressions failed before the fix: wrong instrument, backdated depth,
invented side freshness and decoded-byte overflow. Targeted suite now passes
19 tests, including receipt ordering, stale protection and path/session limits.
Isolated PostgreSQL coverage verifies historical export stability after both a
later mutable update and a later immutable observation. The new schema requires
instrument identity. Full qualification results are recorded below before delivery.

No new dependency, environment setting, migration, duplicate trading deployment or
automatic cleanup is needed. Caller search found only the CLI and tests; both are
updated. Existing history, serializers and evidence remain in use and are retained.
The immutable observation query uses the existing table; a timeout remains a failed
export, never incomplete success. Classification is descriptive and not a broker
exit reason. Sampled quotes/depth do not prove executable fills or profitability.

Rollback: restore the prior research executable with its matching input/schema.
Do not alter stored reports, input versions or frozen observer registrations.

## Final qualification

`PYTHONDONTWRITEBYTECODE=1 /opt/scalper-node22/bin/node scripts/qualify.mjs`
passed all required gates: 1,132 Node + 124 isolated PostgreSQL + 527 Python tests
(1,783 total), formatting/lint/types/build, schemas/migrations/lifecycle/recovery,
secret scan and npm/Python audits. Source SHA-256:
`15ff133e1ad2d7ee09a78874860cf1a520ff713dff62ba1e1de1234217fb9433`.
Private logs: `/tmp/scalper-qualification-rQvO9k/checks/results.json`.
Both policy and `--startup` configuration checks passed for `.env.sample` and the
existing populated deployment file; PM2-cached settings were not modified.
AST Graphify updated without provider calls; staged diff/secret scan precede commit.

Earlier attempts are not qualification evidence: the exploratory database run
passed its tests but detected source drift; a full run was interrupted for the
uncertainty correction; the next found two SQL line-length errors; the next
found the existing msgpack vulnerability. All were corrected before the final run.
One upstream Starlette/httpx deprecation warning remains. Two independent reviews
found the uncertainty case, then confirmed its resolution. No production activation
or economic validation is claimed.
