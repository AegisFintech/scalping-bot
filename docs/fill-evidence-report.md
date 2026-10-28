# ISSUE-390 — Fill evidence and the native TP pattern (#388 pack)

The operator approved recording the quote-to-fill gap, delay and order-book context
for every fill and auditing whether the gap grows with order size. Everything here is
read-only and descriptive: no trading, provider, order, protection, risk or
deployment behavior changes, nothing is sent to the broker, and no counterfactual
fill, net or SL/TP cause is inferred.

## What was built

- `python/operations/export_fill_evidence.py`: one `REPEATABLE READ READ ONLY`
  transaction, hashed demo account scope, at most 31 days and 10,000 deals. Entry
  deals carry their order trigger and broker acceptance time; broker-generated
  closing deals carry the closing order type, the external-intervention flag and the
  last observed broker SL/TP. Setup keys are hashed; no account, order, position or
  deal identifier is exported.
- `python/backtest/fill_gap_review.py review`: joins those deals with Flight quote
  chains and the pinned 250 ms quote/DOM market segments. For each deal it reports
  the latest observation at or before the broker fill time whose executable side
  (ask for buys, bid for sells) was updated within 3 s, the adverse-positive gap and
  delay, the gap to the entry trigger, the native level slippage, recorded TP-side
  crossings before each close, and a walk of the recorded visible ladder for the fill
  size. Close class comes from the closing order type and the fill price against the
  last observed protection, never from the sign of P/L. Summaries group by class
  and by volume bucket (0–100, 100–200, 200–300, 300+ base units).
- `python/backtest/fill_gap_review.py pattern`: rebuilds the #388 pack below from the
  retained ISSUE-387 snapshot.
- Schemas `fill-gap-review-1.0` and `native-tp-fill-pattern-1.0` pin the no-authority,
  no-cause and null-net flags.

No recorder or trading-service change was needed. The market-data process already
records 250 ms quote+DOM samples (4 levels per side), and storage maintenance pins
the sealed segments overlapping each setup ±5 minutes into market evidence. The
review reads those verified segments directly (checksum, sample count, time order,
complete/continuous book).

## #388 evidence from the retained cohort

[Retained pack](evidence/native-tp-fill-pattern.json), generated from
[the ISSUE-387 snapshot](evidence/entry-trigger-review.json) (all 14 scoped intents,
8 closes, selected after the results were known, not prospective). The retained
snapshot has no closing deal price, so close prices are derived from canonical net,
signed fees and volume. The derived losing close, 4001.49, equals the independent
[broker history](evidence/entry-broker-history.json) execution price.

| Setup    | Side | Broker TP | Close   | First TP crossing → fill (s) | Last crossing before fill | Lag (s) | Fill vs that quote |
| -------- | ---- | --------- | ------- | ---------------------------- | ------------------------- | ------- | ------------------ |
| 968450ff | BUY  | 4023.67   | 4023.73 | 16.721                       | +0.20                     | 0.297   | 0.14 worse         |
| c19f6f0d | SELL | 4009.88   | 4009.85 | 172.311                      | +0.19                     | 0.297   | 0.16 worse         |
| 8bd43a25 | BUY  | 4008.75   | 4008.92 | 1.351                        | +0.35                     | 0.246   | 0.18 worse         |
| 434cfd1d | BUY  | 4005.25   | 4005.33 | 26.436                       | +0.26                     | 0.309   | 0.18 worse         |
| 89994dad | SELL | 4001.28   | 4001.24 | 131.581                      | +0.18                     | 0.251   | 0.14 worse         |
| e27a4da4 | SELL | 4000.47   | 4000.47 | 0.612                        | +0.14                     | 0.247   | 0.14 worse         |
| 547074ef | BUY  | 4001.60   | 4001.77 | 8.048                        | +0.35                     | 0.273   | 0.18 worse         |
| ff0c14ac | BUY  | 4009.10   | 4001.49 | no TP fill                   | max +0.06 (05:19:03–06Z)  | —       | SL fill 0.21 past  |

Entry fills were 0.09–0.24 (median 0.12) worse than the first recorded crossing quote,
0.233–0.283 s later (7 measurable entries).

The observed pattern: every TP fill came 0.25–0.31 s after a recorded quote 0.14–0.35
beyond the TP and printed 0.14–0.18 worse than that quote. No fill followed a touch of
0.13 or less, while three quotes 0.14–0.20 beyond the TP did not fill either. The losing
position's TP touches peaked at +0.06. This is consistent with deals of ~2.4 lots
executing about 0.15 behind the displayed quote after ~0.25 s, so a 0.40 TP behaved
like ~0.55 of displayed movement while the SL filled at market. Candidate
explanations (visible-ladder walk, a broker execution markup, demo execution latency)
are hypotheses only; the broker's execution logs are needed to confirm any of them.

Draft question for the operator to send in #388 (not sent): for the 05:15:27Z BUY 2.46
lots at 4008.70 with TP 4009.10, the spot feed showed bids 4009.15–4009.16 at
05:19:03.987–04.357Z. Why did the TP not execute, and is TP execution evaluated against
a price other than the spot feed, or subject to liquidity for the order size? For
seven other TP closes the fill came about 0.25 s after the displayed price was
0.14–0.35 beyond TP, 0.14–0.18 worse than that price.

## Running it on the host

```sh
DATABASE_URL=… ACCOUNT_KEY_HASH=… TRADING_SYMBOL=XAUUSD \
  .venv/bin/python -m python.operations.export_fill_evidence \
  --from 2026-10-19T00:00:00Z --until 2026-10-28T00:00:00Z --output fills.json
.venv/bin/python -m python.backtest.fill_gap_review review --fills fills.json \
  --recordings /var/lib/scalper-flight/recordings \
  --market <runtime>/.runtime/market-evidence --output fill-gap-review.json
```

Use the Flight/research reader, not the application role. Confirm its column grants
first: `fills.position_id`, `broker_fill_id`, `received_at`; `position_close_deals`;
`broker_execution_events.broker_order_type`, `closing_order`, `broker_fill_id`;
`position_protection`; `symbols.volume_scale` and `tick_size`. Outputs are exclusive,
read-only files; an existing output is never overwritten.

## Limits

- The retained cohort is 8 closes; every recent fill is 240–246 base units, so it
  cannot show volume dependence. Running the review over the fresh epoch (October 19
  onwards, including earlier 1% releases with smaller sizes) is the next step and
  needs host database and recording access.
- Quotes are sampled, not a complete tick tape. The ISSUE-387 snapshot retained only
  TP-side crossing quotes (at most 100 per setup), so "last crossing before fill" may
  not be the last quote overall. Book times are the last broker spot time.
- The visible ladder is broker-only, four levels; a walk shortfall is not proof of
  missing liquidity and the walk price is not a predicted fill.
- Close class is price against the last observed protection, not the broker's reason.

## Validation

- 12 new Python tests (side mapping, fresh-side references, stale/gap censoring,
  close classes, TP crossings with and without fills, visible-ladder walk and
  shortfall, segment checksum/count/book checks, bounds, the retained-cohort
  reproduction and exclusive CLI output, exporter scope and projection). Run locally
  with a stand-in runner because the sandbox cannot install pytest/pydantic; all pass.
- Exporter SQL run against PostgreSQL 16 with all 35 migrations and a fixture
  matching the losing trade; another account hash returns no rows. The isolated
  database test and the TypeScript schema test run in hosted qualification.
- Not run locally: full `node scripts/qualify.mjs` (no npm/pip registry access).
