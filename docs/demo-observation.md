# ISSUE-103 — 0.3.0-fade-limit.1 demo deployment and observation

Deploys the new release and runs the bounded demo observation called for
by the ISSU-100 evidence and ISSU-102 policy. Reference outputs are
reproduced below from the live demo database.

## Deploy procedure

The procedure mirrors the rollouts of ISSUE-096/097/098 and ISSUE-099.

1. Pause new analyses:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
   INSERT INTO runtime_controls (control_key, scope, enabled, value, actor, reason, version)
   VALUES ('PAUSE_NEW_ANALYSES', 'local-1', true, '{}'::jsonb,
           'operator-authorized-issue-103', 'ISSUE-103 deploy', 1);
   SQL
   ```

2. Apply the migration (additive, no data rewrite):

   ```sh
   npm run db:migrate
   ```

   The output should list `0024_entry_recovery.sql` (already applied)
   and the new `0025_limit_execution.sql` that widens
   `orders.execution_order_type_check` and `orders.order_type_check`.
   No downtime is required.

3. Redeploy the four PM2 workers, picking up `0.3.0-fade-limit.1`:

   ```sh
   pm2 restart scalper-execution \
            scalper-market-data \
            scalper-ai
   ```

4. Confirm the release identity and exit policy:

   ```sh
   psql "$DATABASE_URL" -c "
     SELECT version FROM strategy_versions ORDER BY id DESC LIMIT 3;
     SELECT reference_equity, drawdown_percent, locked_out
     FROM capital_risk_state ORDER BY updated_at DESC LIMIT 1;
   "
   ```

5. Resume analyses:

   ```sh
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
   INSERT INTO runtime_controls (control_key, scope, enabled, value, actor, reason, version)
   VALUES ('PAUSE_NEW_ANALYSES', 'local-1', false, '{}'::jsonb,
           'operator-authorized-issue-103', 'ISSUE-103 resume', 1);
   SQL
   ```

## Telemetry

`scripts/summarize-demo-trades.ts` is the demo trade-by-trade summary
script. It runs read-only against the demo database and emits
`artifacts/demo-trade-summary.json` with:

- `per_day`: trades, winners/losers, net P&L, fees, average hold minutes
  and realised entry/exit slippage.
- `per_release`: same metrics grouped by `strategy_versions.version`.
- `account_state`: latest reconciled equity, drawdown and lockout state.

Re-run at any point in the observation window:

```sh
npx tsx scripts/summarize-demo-trades.ts artifacts/demo-trade-summary.json
```

The protective `DEMO_FILL_SLIPPAGE_EXCEEDED` latch (wired in
`apps/execution-service/src/demo-gateway.ts`) and the
`setup_statistics` decay tables continue to publish per-fill evidence;
they are the only sanctioned place that can block the next
placement once the limit is exceeded.

## Observation gates

The release is considered observationally positive once the following
hold together across at least 20 demo sessions:

1. Daily net P&L positive on at least 3 of the first 5 sessions.
2. `per_release` summary for `"0.3.0-fade-limit.1"` is net positive on
   aggregate.
3. `avg_entry_slippage_vs_trigger` p50 ≤ 0.10 (maker fills land at or
   beyond the limit; measured from `fills.price - orders.entry_price`).
4. `avg_stop_overshoot_vs_sl` p50 ≤ 0.65 (the calibrated reserve from
   `outcome_calibration.exit_overshoot_p95`).
5. `DEMO_FILL_SLIPPAGE_EXCEEDED` events on the new release remain below
   the historical per-session baseline.

When 3/5 gates pass for 20 consecutive sessions, the operator may turn
on the deferred ISSUE-102b gates (`trendFilterBars`,
`bracketRecallBars`, `streakLosses` / `streakPauseMinutes`); otherwise the
release remains at its safe defaults and the team holds for re-tuning.

## Baseline reference (`artifacts/demo-trade-summary.json`)

| metric                        | value             |
| ----------------------------- | ----------------- |
| closed demo trades            | 357               |
| total net P&L                 | −$754,816         |
| reference equity (start)      | $952,890          |
| adjusted equity (latest)      | $198,075          |
| drawdown %                    | 79.21%            |
| locked_out (latest)           | true              |
| avg entry slippage vs trigger | 0.60 price units  |
| avg stop overshoot vs SL      | −0.10 price units |

The drawdown is from the prior releases (`.4..`); the
`0.3.0-fade-limit.1` summary starts at zero closed trades here and
grows from each subsequent session through the observation window.

## Demo summary format (excerpt)

```json
{
  "per_day": [
    {
      "day": "2026-09-09",
      "trades": 93,
      "winners": 27,
      "losers": 66,
      "net_pnl_usd": "-299022.62",
      "fees_usd": "-53268.88",
      "commission_per_round_trip_usd": "-572.78",
      "avg_hold_minutes": 2.248,
      "avg_entry_slippage_vs_trigger": 0.6747,
      "avg_stop_overshoot_vs_sl": -0.4349
    }
  ],
  "per_release": [
    {
      "release": "0.2.5-market-stop.9",
      "trades": 137,
      "winners": 38,
      "losers": 99,
      "net_pnl_usd": "-248056.82"
    }
  ],
  "account_state": {
    "reference_equity": "952890.80",
    "adjusted_equity": "198074.92",
    "drawdown_percent": "79.21",
    "locked_out": true
  }
}
```

## Manual kill switch

The operator may hard-halt the demo at any time by toggling the
`EMERGENCY_STOP` environment variable (or the `EMERGENCY_STOP_FILE`
flag in `runtime_controls`) and restarting `scalper-execution`. The
release does not change the existing shutdown / cancel-own-pending
behaviour.
