# ISSUE-093: Resolve missing broker stop losses

Status: implemented, validated and deployed to demo. [Issue #217](https://github.com/AegisFintech/scalping-bot/issues/217), [PR #218](https://github.com/AegisFintech/scalping-bot/pull/218).
Release `0.2.5-market-stop.6`; policy `market-stop-v1`; demo only.

## Incident and cause

On September 10 at 14:01:59 SGT, the BUY STOP requested at 4431.40 filled
at 4432.49. A read-only broker history query confirms the original order retained
relative SL 108000 and TP 54000, representing price distances 1.08 and 0.54.
The resulting position should have SL 4431.41 and TP 4433.03. Fresh broker reads
and the broker's protection child instead showed TP only. Why the broker omitted
SL is not established; the initial fill journal does not contain that explanation.
This release does not claim to repair a proven broker defect.

The independent monitor detected missing SL at 14:02:01. Its crossed-price branch
then waited indefinitely without consuming an amendment attempt. ISSUE-089 had
removed local closes to stop premature exits on positions with verified broker
protection. Applying that removal to missing protection left this recovery gap.
By 16:13, no repair or close had been sent. Both daily and high-water loss locks
were active. Provider inference had succeeded; it was not the cause.

## Change

`PositionProtectionMaintenance` still restores approved distances from actual
fill with inward tick rounding and without widening existing protection. It
attempts at most two amendments, at least five seconds apart, and waits for a
fresh broker snapshot rather than treating an acknowledgement as proof.

Only a position whose SL is confirmed absent can enter the new close path:

- The proposed repair is already beyond an executable SL/TP boundary.
- A fresh usable quote cannot be obtained to price an amendment.
- Two amendment attempts have not established SL, after the five-second wait.

Immediately before claiming a close, the worker independently re-reads the exact
owned demo position, symbol, side, actual fill and volume. Any existing SL on
this read prevents the close. Stale, missing, duplicate, changed or uncertain
broker state cannot authorize it. No sampled price can close an SL-protected
position; missing TP or a wider existing SL retains bounded repair only.

`PostgresPositionProtection.claimClose` requires a fresh missing-SL observation,
the exact open owned demo position and volume, and no prior close claim. It
commits the claim before `CTraderClient.closePosition` sends a position-specific
market close. Acknowledgements bind the broker order but do not prove closure.
Unknown/rejected/timeout dispatch, partial fills and restarts do not resend.
Existing broker event/deal/P&L reconciliation must establish the terminal state.
There is no global pause, new cooldown, risk reset or manual-order cancellation.
The request uses cTrader's documented [position-close API](https://help.ctrader.com/open-api/messages/#protooaclosepositionreq).

## Terminal recovery correction found during demo verification

The first rollout closed the position at 16:44:59 SGT. Broker and database agreed
it was closed, but the original TP child still had an unresolved accepted-order
marker. The broker had cancelled that unfilled TP child after the market close;
the old recovery resolved markers only when the same order produced a closing deal.

Terminal recovery now resolves only mapped SL/TP child acknowledgement markers
with an explicit matching zero-fill cancellation, a closed owned position/trade,
and the existing fully reconciled group/terminal-deal proof. Account, symbol,
position and broker child-order identities must match. Unknown, partial,
conflicting or missing cancellation evidence remains blocked. No price validator
or recorder failure latch is weakened: existing certain terminal recovery clears
transient callback failures only after all evidence passes. Integration tests
cover the distinct child order, missing cancellation, incomplete group and repeat
recovery. This correction uses existing journal rows without a migration.

## Contracts, assumptions and limits

Existing protection schema 1.0, shared observation types and migration 0022 already
define CLOSE_REQUIRED/CLOSE_SENT, durable close claims and broker acknowledgements.
They are reused without modifying historical contracts or migration checksums.
The internal store/client interfaces regain narrowly used close methods. Native
volume remains a decimal string until checked protocol encoding; no sizing or
entry/SL/TP distance changes are introduced. The EPRToken pin and prompt stay the
same, as do GTC/OCO, shared 1% modeled risk, dynamic sizing and sticky loss locks.

Broker close orders may be rejected, slip, be partially filled or time out. Fresh
broker proof and durable storage remain necessary. A process or broker outage
can still prevent protection/closure; software cannot guarantee a realized loss
ceiling or continuous execution. An uncertain close needs reconciliation and may
require operator intervention. This change cannot recover past losses or clear
the current daily/high-water locks. A new provider cycle is eligible only after
full closure and all existing admission checks.

## Validation and rollout

The regression reproduces the exact BUY incident and covers SELL, two failed
amendments, a late SL, protected SL/TP crossings, quote failure, stale/duplicate
broker evidence, ownership/volume changes, durable-claim failure, close rejection,
timeout, acknowledgement mismatch and restart idempotency. Isolated PostgreSQL
tests exercise close-claim scope/freshness, accepted close/deal reconciliation and
normal broker exits. Transport tests verify the exact close payload, volume
validation and disabled command authority.

All 22 required gate categories passed: 633 Node tests, 161 Python tests, 36
schema tests, three migration tests and five isolated PostgreSQL/TLS integration
tests, plus formatting, lint, types, build, configuration, replay, secrets and
dependency audits. Initial formatting and test typing/fixture failures were
corrected and rerun; exact commands/results are in
[validation evidence](evidence/missing-stop-recovery-validation.json).

A verified paired backup preceded the rollout. The first updated worker claimed
one close at 16:44:59.169 SGT; the broker filled it at 16:44:59.544 at 4395.82.
After the cancelled-child correction, startup/reconciliation passed at 16:49:29.
An independent read-only broker check at 16:49:38 confirmed zero positions and
zero pending orders. Database position and group are CLOSED, with exactly one
close claim and acknowledgement across the second process restart. No new
unprotected trade was created for testing. The historical protection observation
remains uncertain; the closing deal, not an invented SL, proves the trade ended.

The environment is byte-identical. PM2 has no cached model/database/risk overrides.
Daily baseline/lock timestamp and capital reference/high-water/zero multiplier
remain unchanged. Current admission reports DAILY_LOSS_LOCKOUT; both stored daily
and capital locks remain active after 6.38% drawdown. The fix does not authorize
new trades through those limits. No global pause was set or manually launched
analysis used. All five services remain online; PM2 state was saved.

Graphify's AST graph and source-grounded recovery/prompt relationships were
updated without provider calls. The known pyproject.toml zero-node warning and
community-label hub fallbacks do not affect source validation.

## Rollback

Retain a protected release artifact and paired database/chart backup before
deployment. Restore the previous build only after reconciling outstanding close
claims and exposure: it contains the original missing-SL waiting gap. Never erase
a claim, broker event or risk lock to retry. There is no migration or environment
rollback. Historical/current market-close recovery already exists in the prior
release. Keep pending GTC orders and manual exposure under their existing scope.
