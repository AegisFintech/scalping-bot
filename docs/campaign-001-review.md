# Demo campaign 001 review

## Scope

Campaign 001 is the completed 100-external-AI-analysis demo campaign carried
across immutable strategy releases `.19` through `.24`. The counted analyses
ran from 25 Aug 2026, 12:08 GMT+8 through 26 Aug 2026, 01:41 GMT+8. This report
uses only the durable PostgreSQL decision, model, order, position, fill, and
trade trail. It is a demo result and is not evidence of future profitability.

The campaign limit counted completed external-AI responses, not broker trades.
There were 156 analysis rows during the campaign window: 100 contained a
durable completed AI request/response and 56 ended before that boundary.

## Funnel

| Stage or outcome                         | Count |
| ---------------------------------------- | ----: |
| Analysis rows in the campaign window     |   156 |
| Durable completed external-AI responses  |   100 |
| Rejected after a completed response      |    64 |
| Broker OCO groups created                |    36 |
| Groups expired without a triggered trade |    11 |
| Groups closed with terminal evidence     |    25 |
| Exact broker positions/trades            |    26 |

One closed group contained both bounded OCO legs after a cancellation race, so
25 closed groups produced 26 exact position outcomes. The repaired schema
retains both results rather than collapsing them into one group result.

## Completed-response rejection review

Each of the 64 rejected completed responses is assigned once to its primary
stage; raw reason codes remain unchanged and auditable.

| Primary category                  | Count | Share of 64 |
| --------------------------------- | ----: | ----------: |
| Completed M1 candle context moved |    34 |       53.1% |
| AI proposal semantics invalid     |    18 |       28.1% |
| Market refresh unavailable/stale  |     6 |        9.4% |
| Spread safety protection          |     6 |        9.4% |

The context category comprises 23 decision-refresh and 11 final-placement
refresh changes. End-to-end time from analysis start to durable model response
was 37.208 seconds minimum, 48.602 seconds median, 59.669 seconds at p90, and
66.322 seconds maximum. Starts during broker-minute seconds 9 through 11 were
disproportionately likely to cross the next completed M1 boundary.

The 18 AI-proposal cases were primarily entry too close after the market moved,
miscomputed echoed reward/risk ratios, unordered technical targets, and two
validity windows that became too short by validation time. These support a
prompt self-check and stronger structural confirmation buffer; they do not
justify weakening the local semantic validator.

Across all 156 rows, not only the counted 100, common raw reasons included 27
absolute-spread skips, 20 market-data HTTP 503s, and 15 AI-orchestrator HTTP
503s. Reason counts can overlap. They must be presented as dependency or market
eligibility outcomes rather than implying that every raw `REJECTED` row was an
AI trading opinion.

## Terminal demo results

| Measure                              |            Result |
| ------------------------------------ | ----------------: |
| Trades                               |                26 |
| Wins / losses / break-even           |        6 / 20 / 0 |
| Win rate                             |             23.1% |
| Net realized P/L field               |            -43.65 |
| Recorded fee component               |             -7.28 |
| Gross positive / negative P/L        |    49.00 / -92.65 |
| Average trade                        |             -1.68 |
| Average win / loss                   |      8.17 / -4.63 |
| Best / worst trade                   |     10.71 / -9.69 |
| Maximum closed-trade drawdown from 0 |             55.85 |
| Longest consecutive loss sequence    |                 6 |
| Median / average holding time        | 314 / 551 seconds |

The realized P/L field is the broker-normalized terminal result and already
includes the recorded fee effect; the fee component is shown separately and is
not subtracted a second time.

Long trades were 2 wins from 12 and contributed `-33.62`; short trades were 4
wins from 14 and contributed `-10.03`. The `UNCERTAIN` model regime produced 1
win from 11 trades and `-36.84`. `VOLATILE` produced 3 wins from 10 and
`-13.83`; `RANGING` produced 1 win from 4 and `-2.71`; the only `BREAKOUT`
trade won `9.73`. These one-day cohorts are diagnostic and too small to support
a hard direction, session, or regime ban.

The average effective broker reward/risk ratio was approximately 2.14 for long
and 2.29 for short proposals after the configured TP-distance division. Winning
shorts had materially wider initial confirmation distance than losing shorts
in this small sample. This supports stronger chart-structure confirmation for
weak, uncertain, ranging, or balanced-order-book conditions while preserving
the requirement for both conditional legs.

## Refinement decision

Campaign 002 should change one coherent strategy release:

1. use a concise screenshot-first prompt with explicit buy/sell R:R formulas,
   exact TP-transform target formulas, ordered target checks, independent
   asymmetric legs, and wider structure-based confirmations when evidence is
   weak or balanced;
2. reduce redundant compact raw candle tails while retaining the full
   completed-candle chart and deterministic indicator summaries;
3. disallow late broker-minute starts that have insufficient time for the
   observed endpoint latency;
4. retain every schema, semantic, precision, freshness, spread, risk, exposure,
   and reconciliation check;
5. count campaign 002 from `0 / 100` under its own immutable release and report
   attempts, completed AI responses, placements, expiries, triggered trades,
   wins/losses, P/L, and primary rejection categories separately.
