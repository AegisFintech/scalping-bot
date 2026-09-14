# ISSUE-100 — Variant replay lab: why the loop loses and what screens positive

Research-only report. No profitability claim; every positive number below is a
simulation over four trading days of journaled setups, deliberately biased
against the new variants. promotion to demo additionally requires the Phase
B–D implementation, the documented gates and a bounded demo observation.

## 1. Measured diagnosis (demo database, 2026-09-10 → 2026-09-14)

333 closed demo trades, net **−$726,589** (equity $952,890 → $225,167, −76%).
Per-release measured expectancy (`outcome_calibration` in
`artifacts/variant-inputs-full.json`):

| release                           | trades | avg net         | entry slip (mean) | SL overshoot (mean) | wins |
| --------------------------------- | ------ | --------------- | ----------------- | ------------------- | ---- |
| `0.2.5-market-stop.9`             | 137    | −$1,811         | 0.63              | 0.58                | 28%  |
| `0.2.5-market-stop.10`            | 50     | −$1,250         | 0.56              | 0.62                | 28%  |
| `0.2.5-market-stop.11` (balanced) | 44     | −$1,478         | 0.64              | 0.65                | 9%   |
| earlier `.4–.8`                   | 107    | −$1,928…−$4,096 | 0.41–0.90         | 0.51–3.53           | —    |

Structural causes, quantified:

1. **Sub-noise geometry.** Production TP ≈ $0.53 with SL = 2×TP (`.9/.10`) or
   1×TP (`.11`); the median M1 range is $1.84. The recorded whipsaw test shows
   78% of stopped-out trades returned to the entry fill within 20 minutes.
2. **Anti-predictive direction.** Stop-market breakout entries at the nearest
   M1 support/resistance reached TP first in a 25% (2×SL) and 9% (balanced)
   ratio; a driftless walk would hit the nearer barrier ~65% of the time.
3. **Taker execution asymmetry.** STOP entries filled on average **0.64
   adverse** (p95 ≈ 1.31) — more than the whole TP distance; stop exits filled
   on average **0.62–0.65 beyond** the stop (policy reserve models only 30
   points). Realized gross R:R was 0.70 : 1.77.
4. **Cost × frequency.** Round-trip commission $256–$770 (≈65% of an average
   win), immediate re-analysis after every close, 100–150 trades/day. Every
   hour of every trading day lost; no session refuge.

The balanced-exit trial (ISSUE-099) changed geometry only and stayed deeply
negative, confirming geometry alone cannot fix direction and execution.

## 2. Method

- **Inputs (A1/A5):** `scripts/export-variant-inputs.ts` exports all 717
  READY `entry-pair-1.0` journaled level pairs (`model_responses` /
  `scenario_contexts.plan`) plus calibration measured from actual fills, with
  per-release expectancy. `scripts/backfill-candle-history.ts` (read-only,
  `allowOrderCommands:false`) paged 55,000 completed M1 bars
  (2026-07-20 → 2026-09-14) through the new optional `toTimestampMs` argument
  of `getCompletedCandles`; the exporter merges them behind the recorded DB
  candles so regime filters and ATR warm up correctly for every setup.
- **Simulator (A2):** `python/backtest/variants.py` replays identical recorded
  levels through alternative direction/geometry/execution models. All prices
  Decimal; conservative conventions: stop wins every unresolved intrabar race;
  limit entries require a one-tick pierce; STOP-market exits pay the measured
  overshoot; STOP-limit exits fill at the capped limit, model gap non-fills
  honestly and escalate to a bounded protective close; open positions mark at
  window end. `run_variant --serial` mirrors the production one-position loop
  (a setup captured while a position is open is skipped) and supports
  loss-streak pauses. Fees $277 RT and $1,068/point come from measured fills.
- **Screen (A3/A4):** `python.backtest.screen` ran 428 variants × 717 setups,
  chronological split train (<2026-09-13) / holdout (≥), plus stress runs at
  3-tick pierce and 2× commission. Fidelity check: the two production replicas
  reproduce measured direction, win rates and expectancy bands
  (e.g. balanced replica train 17% wins vs measured 9–28%).

## 3. Results

- **All production replicas lose under both splits** (train −$1,959…−$2,111,
  holdout −$1,609…−$1,793 per fill), matching live measurements.
- **Confirmed-breakout (momentum-gated) variants lose under both splits**
  (best holdout −$992/fill): the breakout family is dead at these levels.
- **Sweep-reversal variants** are holdout-positive but train-negative once the
  warmup is honest; not promoted.
- **Trend-aligned fade limits at the same LLM levels win under every tested
  condition.** 125 of 428 variants are positive on both splits; the robust
  core (serial, streak 3→60min pause):

| variant                             | train $/fill (n) | holdout $/fill (n) | worst-stress train/holdout | total (worst stress) |
| ----------------------------------- | ---------------- | ------------------ | -------------------------- | -------------------- |
| `v1-fade-sl2.0-tp2.0-e30-noBe-tr30` | +1,356 (51)      | +2,001 (34)        | +713 / +1,724              | +$95,000             |
| `v1-fade-sl2.5-tp1.0-e30-noBe-tr30` | +1,050 (75)      | +958 (39)          | +713 / +681                | +$79,324             |
| `v1-fade-sl2.5-tp2.0-e60-noBe-tr30` | +1,496 (46)      | +2,727 (29)        | +176 / +2,450              | +$79,174             |

Winner daily totals (`v1-fade-sl2.5-tp2.0-e60-noBe-tr30`, base costs):
Sep 10 **+$42.3k**, Sep 11 **+$26.5k**, Sep 13 −$12.9k (2 fills), Sep 14
**+$92.0k** — positive on the three days production lost −$299k / −$305k /
−$117k. Definition: BUY/SELL **limit** orders at the journaled support /
resistance levels (fade the level the breakout strategy chases), M1-ATR(14)
geometry (SL 2–3×ATR, TP 1–2×ATR, stop-limit exits 30-tick cap, 3-bar
escalation), 30–60 bar bracket expiry, 30-bar trend alignment (fade only in
the prevailing short-term direction), serial with 3-loss → 60-minute pause.

Artifacts: `artifacts/variant-screen-full-serial.json`,
`artifacts/screen-full-{base,pierce3,comm2,both}.json`,
`artifacts/variant-screen-{parallel,serial}.json` (pre-backfill),
`artifacts/variant-inputs-full.json`, `artifacts/history-candles-m1.json`.

## 4. Limitations (read before acting)

- Four trading days of journaled levels (717 setups, 85–114 serial fills per
  winner). Confidence intervals are wide; PF 2–3.4 is optimistic. The sign was
  stable across splits and stress, but this is not out-of-sample proof.
- Limit fills at 1-tick pierce ignore queue priority; the 3-tick stress keeps
  every promoted variant positive, but real fills sit between the two.
- Sep 13 (Sunday-open cohort) loses for every variant; small sample.
- Trend alignment (30-bar) and streak pauses are part of the tested edge and
  must ship together with the fade geometry, not be stripped as "filters".
- Calibration averages mix releases; the `.5` overshoot tail (max 35.6) shows
  stop-market exits have unbounded gap risk — the promoted design exits via
  stop-limit with bounded escalation for that reason.

## 5. Decision and next steps

Promote the **tr30 fade-limit family** (`v1-fade-sl2.0-tp2.0-e30-noBe-tr30`
primary; `v1-fade-sl2.5-tp1.0-e30-noBe-tr30` high-frequency alternative) to
implementation:

- ISSUE-101 (Phase B): LIMIT entry orders + STOP_LIMIT protective exits in the
  client/contracts/migrations/coordinator/risk engine, fail-closed non-fill
  escalation reusing ISSUE-093/095 evidence paths.
- ISSUE-102 (Phase C): `entry-pair-v4` fade semantics for the pinned model
  (levels only; deterministic local geometry, regime gate and sizing), new
  schema/journal identities, strategy-version release constants.
- ISSUE-103 (Phase D): serial cadence, loss-streak pause, realized-slippage
  and net-EV instrumentation, bounded demo observation before any scale-up.

A paid historical level-replay benchmark (regenerating provider levels across
the backfilled 8 weeks via the existing bounded benchmark harness) is the
recommended out-of-sample confirmation before live-scale decisions; it makes
chargeable provider calls and requires explicit operator authorization.

Commands: `npx tsx scripts/backfill-candle-history.ts --weeks 8 --timeframe M1
--output artifacts/history-candles-m1.json`; `npx tsx
scripts/export-variant-inputs.ts artifacts/variant-inputs-full.json
artifacts/history-candles-m1.json`; `.venv/bin/python -m python.backtest.screen
--input artifacts/variant-inputs-full.json --output
artifacts/variant-screen-full-serial.json --serial --streak-losses 3
--streak-pause-bars 60`.
