# Configuration and migration

Release `0.2.0-overhaul.1` uses policy `conservative-v1` in
`packages/config/src/policy.ts`. The normal template has 25 assignments, previously
176: 151 fewer, an 85.8% reduction. The 25 include secrets and deployment identity;
they are not 25 strategy controls. There is no operator strategy tuning file.
The [complete inventory](configuration-inventory.md) classifies every original
setting. Advanced listener/path/TLS deployment overrides remain available for
systemd layouts and do not belong in a normal installation's template.

## Normal choices

| Purpose                                       | Keys                                                                                                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instance and account identity                 | `INSTANCE_ID`, `ACCOUNT_ID`, `ACCOUNT_KEY`, `TRADING_SYMBOL`                                                                                                                                        |
| Explicit operation                            | `TRADING_MODE`, `EMERGENCY_STOP`, `AUTOMATIC_ANALYSIS_ENABLED`, `DEMO_TRADING_ENABLED`, `DEMO_TRADING_ACKNOWLEDGEMENT`                                                                              |
| Capital bounds in account currency            | `ACCOUNT_EQUITY_FLOOR`, `MAX_POSITION_NOTIONAL`                                                                                                                                                     |
| cTrader credentials and deployment            | `CTRADER_CLIENT_ID`, `CTRADER_CLIENT_SECRET`, `CTRADER_ACCESS_TOKEN`, `CTRADER_ACCESS_TOKEN_EXPIRES_AT`, `CTRADER_REFRESH_TOKEN`, `CTRADER_API_HOST`, `CTRADER_API_PORT`, `CTRADER_CONNECTION_MODE` |
| EPRToken deployment                           | `AI_BASE_URL`, `AI_API_KEY`                                                                                                                                                                         |
| Persistence, controls, optional observability | `DATABASE_URL`, `DASHBOARD_CONTROL_TOKEN`, `BETTERSTACK_SOURCE_TOKEN`, `BETTERSTACK_INGESTING_HOST`                                                                                                 |

Blank cTrader host/port use the official selected demo/live connection host and
port 5036. A supplied deployment endpoint is preserved; it grants no trading
authority. Paper/stopped/no automation are the defaults. Demo execution additionally needs
the existing exact acknowledgement and successful broker/account/recovery checks.
No setting can make this build submit live orders. Shadow uses a separately
specified connection environment without submission authority. An API key or
broker token is not an authorization to trade.

The conservative policy preserves the audited deployment's 0.001% setup risk,
1% daily loss limit, 1% margin-use ceiling and 10-point spread ceiling. The
order-count ceiling is 100 per day, below the former configured 103. It adds
cost-inclusive sizing and bounded reductions, not automatic risk increases.
`MAX_POSITION_NOTIONAL` is per position; the two-leg OCO maximum gross notional
can therefore be twice this amount, while both losses/margins must fit the shared
setup budget. Notional conversion uses broker quote-to-account currency metadata.
A broker minimum can be unaffordable; do not enlarge risk to force a fill.

Symbol ID, account currency/type, volume increments, precision, commissions and
conversion are discovered. Nonempty legacy broker-discovery overrides require
removal after review. Strategy thresholds are code-reviewed defaults, not inferred
from profitable-looking data. Adaptive behavior is only the fixed drawdown/daily
loss reduction and documented hysteresis; no return-optimizing tuner runs.

## Read-only validation

```sh
npm run config:check -- .env.sample
npm run config:check -- .env
```

This checks **policy compatibility**, not connectivity or permission to place an
order. Service startup separately validates required credentials, explicit demo
capital limits, acknowledgements, fresh metadata and account evidence. Errors name
keys only. The existing populated environment failed compatibility as expected:
it contains the old model, strategy identity and policy overrides. It was not
rewritten, and the existing deployment was not restarted.

Nonempty fixed overrides must match the policy exactly or startup rejects with
`CONFIG_POLICY_CONFLICT`. Ambiguous legacy `SHADOW_MODE` also rejects; use the
explicit mode. Cleartext database configuration for broker modes rejects.
Obsolete observability/unused feature switches do not regain behavior by being
retained; remove them during migration. `GH_PAT` is obsolete for the application,
but an existing ignored credential used for delivery must remain private.

## Reviewed migration

1. Pause new analyses using authenticated controls and verify strategy exposure,
   pending cancellations and reconciliation. Preserve broker protection for open
   positions. This repository change has not performed that operational action.
2. Back up the populated environment and database to the approved protected
   location. Preserve mode-0600 permissions. Do not copy credentials into commands,
   reports or Git; do not run `cp .env.sample .env` over an existing file.
3. Review each conflicting key reported by `config:check`. Retain credentials,
   endpoints, instance identity, control authorization and explicit capital limits.
   Remove reviewed legacy internals. Choose paper/stopped for the first check.
4. Apply additive migration `0015` with the existing migration CLI during the
   reviewed rollout. It adds provider telemetry/failures and capital state; there
   is no destructive transition or historical audit rewrite.
5. The PM2 ecosystem now contains deployment identity only; strategy defaults come
   from the typed policy. Under the reviewed stopped rollout, recreate the named
   service processes from the new ecosystem and migrated environment to remove
   stale PM2-cached overrides, then save that reviewed state. A reload that retains
   old environment keys can still fail policy validation. Systemd users should
   review their EnvironmentFile and drop-ins for the same legacy keys.
6. Build on Node 22, start under the existing Debian service supervisor, and verify
   account-scoped reconciliation, freshness, capital state, mode and controls.
   An absent late-start daily baseline needs the existing audited initialization
   procedure; do not synthesize it or reset a loss lockout.
7. Review provider access/pricing and run a bounded compatibility call. Supervised
   demo validation is a separate authorization. No new strategy candidate is enabled.

## Rollback

Keep a protected copy of the former environment and release artifact. Pause new
analysis, reconcile outstanding orders, then restore the previous reviewed release
and its environment through the normal supervisor. Keep migration `0015` tables
and their audit data: the older release can ignore them. Do not drop tables, edit
migration checksums, reset daily/capital rows, or resurrect expired proposals.
Rollback does not transfer live authority or prove older risk behavior sufficient.
