# ISSUE-091: Fresh local demo with dynamic money management

The demo loop resumed on local PostgreSQL at **11:20:10 SGT on September 10,
2026**. Its first automatic request returned usable DeepSeek entries, and the
execution journal recorded both GTC STOP orders placed. A separate read-only
broker observation at 11:21:04 SGT confirmed two accepted pending STOP orders,
relative SL/TP supplied for both legs, no open position, and certain account
reconciliation. This is demo operational evidence, not a profitability result.

Issue: [#213](https://github.com/AegisFintech/scalping-bot/issues/213).
Branch: `issue-091-fresh-local-demo`. Dependency: merged storage PR
[#212](https://github.com/AegisFintech/scalping-bot/pull/212), `b4fd196`.
The deployed trading code remains `0.2.5-market-stop.4`; this change records the
authorized operational transition and persistent money-management preference.

## Authorized accounting transition

The operator explicitly accepted a fresh local demo start and resetting the
unrecovered loss/risk tracking, while requiring dynamic money management. A
separate operational database was created with all 23 existing migrations.
The historical recovery databases, original hosted source, original chart bytes,
and original backups were preserved. The source gap after September 9 at
16:32 SGT is still missing; it was neither recovered nor imported as current.
New dashboard history starts with this local accounting epoch. The 282 archived
historical trades remain in the separate historical recovery database.

Before initialization, the broker confirmed zero positions, zero pending orders,
zero deals today, complete deal-history evidence and zero external flow operations.
The existing authenticated demo baseline initializer repeated the account/history
checks while emergency stop was enabled and submission disabled. It recorded the
operator's reason in the audit journal. The new daily and capital baselines use
the reconciled account, not an invented balance or an old snapshot.

This is a one-time transition. Repeating initialization returned HTTP 409 /
`DAILY_RISK_BASELINE_ALREADY_EXISTS`. The initialized daily and capital reference
values survived the execution restart unchanged. Future losses, reductions,
locks and dispatch claims remain durable; no automatic reset was introduced.

## Dynamic money management

Sizing continues to run for every fresh setup against current reconciled equity,
remaining daily loss capacity, drawdown reductions, local stop distance, execution
costs, broker collateral and permitted volume increments. The model supplies entry
prices only. It cannot select lot size, increase risk or reset accounting.

- Both OCO legs share a maximum **1% of current equity** in modeled setup loss.
- The **5% UTC daily loss budget** and **5% high-water drawdown lock** remain.
- Risk multipliers reduce to **0.5** and **0.25** as the existing daily/drawdown
  thresholds are reached; locked state permits no new risk. Existing recovery
  hysteresis and cash-flow treatment are unchanged.
- Broker margin, costs and volume rounding can produce a smaller position.
  There is no fixed-lot override, upward minimum-volume rounding or leverage change.

The first pair's journal records 0.5% budget per leg, a combined 1% budget,
positive rounded volumes and recorded broker margin estimates. Tests cover
multiple equity levels, nearly exhausted daily capacity, cash flows, reductions
and restart-persistent locks. These are modeled limits, not guaranteed realized
loss ceilings; STOP and protective exits can slip. TP/SL geometry, model pin and
the OCO lifecycle were not changed in this activation.

## Storage and service activation

Node and Python use verified loopback TLS with separate application/migration
roles. Only `DATABASE_URL` differs from the protected original populated
environment after temporary maintenance settings were restored. All other 23
values, including credentials and the existing demo authorization, are preserved.
Policy and startup checks both pass. PM2 has no cached `DATABASE_URL` for any of
the five services; their startup wrappers load the protected environment file.
All five processes are online, and the reviewed running state is saved in PM2.

A consistent paired current backup was restored into a separate empty database:
all **45 table counts and fingerprints matched**. The activation marker identifies
the fresh accounting transition and explicitly records absent history continuity.
Both native systemd timers are enabled and active. The first maintenance run
completed successfully with healthy storage status; the overlapping manual probe
correctly returned `maintenance_already_running` without a second writer.

A second paired backup after automatic order placement also restored all 45
tables into another empty verification database. This covers actual new provider,
candle, risk and order evidence as well as the pre-start baseline.

All **2,176** pre-transition sampled-market files (**48,770,846 bytes**) were
hashed and preserved outside active cache retention before new recording began.
This protects possible evidence for the unresolved historical gap. The previous
cleanup's 9.44 GB saving and all original rollback sets remain intact.

The first new context stores exact provider input/prompt evidence, and the journal
observed 120 candle references pointing to 60 distinct values, with no automatic
PNG generated. Requested model: `deepseek-v4-pro/u5W`; observed returned identity:
`deepseek-v4-pro`. One paid request produced the first pair. An active pending
group prevents another setup; that status is normal OCO ownership, not a stopped
automation service.

Off-server backup delivery remains separate: no destination/public encryption
recipient has been selected, so no external copy is claimed. This does not prevent
the authorized local demo from running.

## Validation and rollback

All 22 required gates passed: formatting, lint, TypeScript, build, 619 Node tests,
155 Python tests, 36 schema tests, three migration tests, five TLS integration
tests, Python format/lint/types, configuration policy/startup, replay/fail-closed
fixtures, secret scanning and dependency audits. Repeated baseline rejection,
baseline persistence across execution restart, paired restore verification and
direct broker order observation supplement these checks. Exact evidence is in
[the validation record](evidence/fresh-local-demo-validation.json).

Light/dark checks against the running dashboard preserved navigation, input text,
focus and cursor across timed updates. History and storage status remained visible,
with no browser errors or submitted controls. The initial test used an outdated
heading selector; correcting it to the existing `Closed trades` heading passed
without an application change.

The original environment and PM2 snapshot remain protected for reference.
After new local trading starts, neither the old hosted database nor the historical
restore is a valid rollback target for execution. An operational rollback must
first hold new analysis, reconcile current owned exposure, preserve broker
protection and transfer every newer local journal/risk record. Restore a verified
paired current set and reconcile broker truth before resuming. Never run two
independent writers or repeat the accounting reset as a recovery shortcut.
