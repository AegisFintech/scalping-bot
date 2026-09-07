# ISSUE-077 — Pending-order reconciliation repair

Date: September 7, 2026. Issue: [#184](https://github.com/AegisFintech/scalping-bot/issues/184).
Pull request: [#185](https://github.com/AegisFintech/scalping-bot/pull/185).
Implementation checkpoint: `5ed2622` (committed and pushed).
Branch: `issue-077-pending-order-reconciliation`. Release: `0.2.2-fixed-risk.4`.
Policy remains `fixed-risk-v2`. The operator requested this repair after the status
audit; existing demo authority remains, and live submission is disabled.

## Reproduced failure

Between 16:38 and 20:35 SGT, release `.3` submitted 17 OCO pairs: all 34 orders
received broker acknowledgement, all were cancelled by the bot, and none filled.
The interval from first acknowledgement to last cancellation was 1.657–7.254 seconds
(mean 3.733 seconds). Every pair coincided with `DAILY_RISK_ACCOUNT_UNCERTAIN`.
Neither persisted daily nor capital loss lock was set. The latest pair in that
window was submitted at 20:29:17.102, cancelled by 20:29:20.714, and had an intended
expiry of 20:30:09.636. The map was consumed at intent, so immediate cancellation
also left execution waiting for the next bounded refresh.

A read-only broker observer reproduced the precise failure at 20:55:32–36 SGT:
two accepted orders with explicit zero executed volume, no open positions, and
two zero gross/net P/L records caused `CTRADER_ACCOUNT_PNL_INCOMPLETE`. As cancellation
proceeded, one zero-P/L record remained before the account returned to empty.
The old validator required equal open-position and P/L counts. The execution
service discarded this underlying exception, then failed daily reconciliation and
cancelled strategy-owned pending orders. This was an account-adapter mismatch;
tighter entry levels would not correct it.

cTrader documents reserved position identities for pending orders through
`POSITION_STATUS_CREATED`, the order's position identity, accepted/executed-volume
fields, and the separate account P/L response. These define the applicable protocol;
the zero-P/L response behavior above was directly observed on this demo broker.
[Official model definitions](https://help.ctrader.com/open-api/model-messages/),
[P/L and reconciliation messages](https://help.ctrader.com/open-api/messages/).

## Correction and boundaries

- Every open position still requires exactly one P/L record.
- An additional P/L record is accepted only when it has zero gross **and** net P/L,
  and its position identity matches exactly one broker-accepted order with explicit
  zero executed volume. Missing execution evidence is not assumed to mean zero.
- Unknown or duplicate P/L, multiple matching orders, nonzero unmatched P/L,
  partial/terminal matching orders, and missing open-position P/L reject. Other-symbol
  exposure and absent margin evidence remain blockers.
- Valid unfilled orders remain counted as pending exposure, with the existing shared
  OCO risk reservation. Their zero P/L does not increase equity or available margin.
- Account failures now retain allowlisted diagnostic codes in logs/status. Arbitrary
  errors, identifiers, and broker response bodies are withheld. Genuine uncertainty
  still blocks admission and triggers existing protective cancellation behavior.

There is no change to entries, spreads, expiry, SL/TP, 1% combined setup risk,
5% daily loss budget, drawdown protections, model/prompt, credentials or authorization.
No schema/SQL migration or environment edit is needed. No live execution is enabled.

## Validation and deployment

The failure was reproduced before editing the validator. All required checks passed:
445 Node tests in 61 files, 118 Python tests, 22 schema tests, three migration tests
and all three configured PostgreSQL/analytics integration tests. Formatting, ESLint,
TypeScript checks/build, Ruff, mypy, configuration startup checks, replay/fail-closed
fixtures, secret scanning and dependency audits passed. Both dependency audits found
zero known vulnerabilities. Seven initial require-await lint findings in test mocks
were corrected; full formatter/lint/type/Node checks passed again. Exact commands and
sanitized reproduction: [validation evidence](evidence/pending-reconciliation-validation.json).

New analyses were paused at 20:55:37 SGT while protective maintenance remained active.
The populated environment and previous compiled release are backed up privately.
The execution service was recreated on stable Node 22.23.2 with release `.4`; its
healthy paused preflight confirmed unchanged 1%/5% policy and healthy reconciliation.
Existing demo authorization was restored at 21:00:57 SGT. No environment value changed.

The first post-repair OCO setup was created at **21:02:02.590 SGT**. Its SELL
order remained pending from local submission at 21:02:03.600 until broker expiry
at 21:02:54.598: **50.998 seconds**, matching its 21:02:54.597 deadline. The
read-only observer made **62 successful account checks and zero failed checks**
while that pending order's zero-P/L record was present. The execution logs contain
no account/daily-risk/callback/recovery errors during this observation. The group
reconciled to EXPIRED with `ANALYSIS_EXPIRED`, not the prior premature safety cancellation.

The BUY leg was accepted and then cancelled by the broker without a fill or a
detailed error reason, before SELL became pending. Its cause is not inferred from
the cancellation alone. **Neither leg filled; no closed trade or improvement in
net returns is claimed.** This observation establishes that valid pending exposure
survives repeated account checks until its proper expiry; it does not establish
a fill rate or eliminate broker-side cancellation/slippage constraints. Tests cover
two simultaneous pending P/L records, fills and restart; this prospective observation
contained one surviving pending order.

At 21:04:42 SGT all five services were online; `.4` was healthy, demo automation
enabled, emergency/pause off, and no strategy order or position remained active.
The exact model request remained `gpt-6-astra/u64`, with returned `gpt-6-astra` and
18,621 ms for the first refresh. The populated environment was byte-for-byte unchanged
and remained mode 0600. [Sanitized rollout evidence](evidence/pending-reconciliation-rollout.json).

Rollback: pause new analyses, verify broker exposure and reconciliation, restore
the prior reviewed build through the stable Node 22 supervisor, and retain all
journals/accounting. The old build contains the reproduced pending-P/L bug; do not
clear loss locks, recreate consumed maps or claim it is healthy because an idle
status succeeds. Restore existing demo controls only after the reviewed preflight.

These are operational correctness checks. They do not establish strategy accuracy,
positive expectancy, or a guarantee that accepted stop-limit orders will fill.
