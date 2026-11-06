# Verified loss-cooldown reporting — ISSUE-353

## Defect and scope

At2026-10-21T05:19:52Z the observational watchdog reported
AUTOMATIC_ANALYSIS_STALLED during the existing one-hour loss wait following the
04:23:54Z loss. The scheduler had correctly returned LOSS_STREAK_PAUSE_ACTIVE.
These historical observations remain unchanged. The regression reproduced the
false stall before the implementation changed.

The watchdog now independently reads the same account-wide demo closed-trade
streak as the existing gate. Zero realized P/L retains the existing loss meaning;
other symbols and releases on the account remain included. Another account,
insufficient losses or a newer positive outcome cannot establish this wait.
Cooldown duration/count are supplied from the existing execution policy only when
that policy applies. The admission gate itself is unchanged.

Fresh proof returns WAITING_FOR_COOLDOWN with checkedAt/until and the original
LOSS_STREAK_PAUSE_ACTIVE reason. checkedAt is captured before database reads and
must be no more than3seconds old, never future; expiry must be future. Missing,
stale or expired evidence cannot suppress ordinary stall detection. Invalid
source clocks and database errors remain failures. Pause, managed exposure and
market unavailability retain precedence. Waiting does not emit a progress-resumed
audit event. The read-only harness health consumer validates the proof separately;
missing, stale or malformed proof is UNAVAILABLE, not verified waiting.

No order/provider calls, retries, settings, accounting, cooldown, eligibility,
risk, protection, database schema or frozen study changes. The new SQL is SELECT
only. This is reporting correctness, not strategy improvement or economic
qualification. A forward executor handover remains a separate reviewed operation;
do not restart the frozen executor from this checkout.

## Validation and delivery

Unit tests cover the reproduced false stall, expiry, missing/stale/future proof,
malformed clocks and precedence. An isolated migrated PostgreSQL test exercises
account-wide scope, zero outcomes, another account, positive reset, insufficient
streaks, expiry, actual database failure and no order/audit side effects. Python
health tests exercise the consumer boundary independently. Full qualification,
four configuration checks, independent Standards/Spec reviews and protected
exact-head delivery are required. Full qualification passes2,991tests/no skips
(1,352Node,178PostgreSQL,1,461Python) and all20checks. All four
configuration checks pass; independent Standards/Spec reviews are CLEAR.

Initial qualification exposed typed SQL/Python proof errors and three fixture
defects: source-minute alignment, UUID/text parameter inference and historical
analysis state violating the active-analysis uniqueness guard. These were corrected
and the complete suite rerun successfully. Two intermediate runs were stopped
without acceptance while fixture repairs were underway. The retained
[validation receipt](evidence/watchdog353-validation.json) records source hashes,
checks, corrected failures and existing audit/deprecation limitations. Hosted
exact-head checks, authentic independent approval and operational activation remain
separate from local qualification.

[Issue353](https://github.com/AegisFintech/scalping-bot/issues/353) stays open until
reviewed delivery and actual operational activation satisfy its acceptance.
