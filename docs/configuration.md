# Configuration and migration

Release `0.2.2-fixed-risk.3` uses policy `fixed-risk-v2` in
`packages/config/src/policy.ts`. The normal template has 21 assignments, previously
176: 155 fewer, an 88.1% reduction. These include secrets and deployment identity;
there are no strategy tuning controls. The actual authorized local migration
reduced the populated environment from 176 to 25 entries: the 21 normal keys plus
four retained deployment credentials/identifiers. No credentials were changed.
See [the current policy report](fixed-risk-report.md) for migration and validation. There is no operator strategy tuning file.
Reusable scenario maps add no environment variables or tuning file. Five-minute
refresh/cooldown, one intent per map, five-second local decisions, 60-second
pending expiry and 45-second provider timeout are engineering policy, not operator
knobs. The original observe/replay tools remain separate research utilities.
The [complete inventory](configuration-inventory.md) classifies every original
setting. Advanced listener/path/TLS deployment overrides remain available for
systemd layouts and do not belong in a normal installation's template.

## Normal choices

| Purpose                                       | Keys                                                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Instance and account identity                 | `INSTANCE_ID`, `ACCOUNT_ID`, `ACCOUNT_KEY`, `TRADING_SYMBOL`                                                           |
| Explicit operation                            | `TRADING_MODE`, `EMERGENCY_STOP`, `AUTOMATIC_ANALYSIS_ENABLED`, `DEMO_TRADING_ENABLED`, `DEMO_TRADING_ACKNOWLEDGEMENT` |
| Capital bounds in account currency            | `MAX_POSITION_NOTIONAL`                                                                                                |
| cTrader credentials                           | `CTRADER_CLIENT_ID`, `CTRADER_CLIENT_SECRET`, `CTRADER_ACCESS_TOKEN`, `CTRADER_REFRESH_TOKEN`                          |
| EPRToken deployment                           | `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`                                                                                |
| Persistence, controls, optional observability | `DATABASE_URL`, `DASHBOARD_CONTROL_TOKEN`, `BETTERSTACK_SOURCE_TOKEN`, `BETTERSTACK_INGESTING_HOST`                    |

Blank cTrader host/port use the official selected demo/live connection host and
port 5036. Host, port, connection environment and optional access-token expiry
remain advanced deployment overrides; ordinary installations need not set them.
A supplied custom deployment endpoint must be preserved; it grants no trading
authority. Paper/stopped/no automation are the defaults. Demo execution additionally needs
the existing exact acknowledgement and successful broker/account/recovery checks.
No setting can make this build submit live orders. Shadow uses a separately
specified connection environment without submission authority. An API key or
broker token is not an authorization to trade.

The model pin is visible as `AI_MODEL=gpt-6-astra/u64`, and a different nonempty
model is rejected. API style, request limits, indicator periods, scheduling,
execution thresholds and risk percentages are managed in the versioned policy.
Removing redundant default endpoints/paths is safe only after comparing them to
their effective code defaults. Keep unknown credentials or custom deployments
until reviewed; unused monitoring credentials must not disappear accidentally.

The operator-authorized fixed policy uses a 1% setup risk ceiling and 5% daily
loss limit, with no absolute equity floor. The 1% margin-use ceiling and 10-point
spread ceiling remain. The
order-count ceiling is 100 per day, below the former configured 103. Sizing includes execution costs and bounded risk reductions; AI cannot raise risk.
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
npm run config:check -- .env --startup
```

The default checks **policy compatibility** and reports actual file and normal
template counts separately. `--startup` additionally runs the execution
configuration parser, including mode/acknowledgement and explicit demo capital
limits. Both are read-only; neither checks provider/broker connectivity, runtime
state or permission to place an order. Service startup separately validates
credentials, fresh metadata and account evidence. Errors name keys only.

The migrated local file passes both compatibility and startup checks with 25
keys and the exact model pin. `ACCOUNT_EQUITY_FLOOR` is obsolete: any legacy value
is ignored and removed from the resolved runtime environment; the read-only
checker names it as removable without printing its value. Remove its assignment
from existing files after a protected backup. No replacement setting is required.
The scheduler-enabled flag is operational authority: it remains in the full
safety audit hash but does not redefine the immutable strategy. Economic changes
still require a new strategy version. A file edit alone does not update running processes. The previous floor blocker
is historical, not a requirement of this release.

Nonempty fixed overrides must match the policy exactly or startup rejects with
`CONFIG_POLICY_CONFLICT`. Ambiguous legacy `SHADOW_MODE` also rejects; use the
explicit mode. Cleartext database configuration for broker modes rejects.
Obsolete observability/unused feature switches do not regain behavior by being
retained; remove them during migration. `GH_PAT` is obsolete for the application,
but an existing ignored credential used for delivery must remain private.

## Reviewed migration

1. Pause new analyses using authenticated controls and verify strategy exposure,
   pending cancellations and reconciliation. Preserve broker protection for open
   positions. ISSUE-075 applied an audited maintenance pause before implementation.
2. Back up the populated environment and database to the approved protected
   location. Preserve mode-0600 permissions. Do not copy credentials into commands,
   reports or Git; do not run `cp .env.sample .env` over an existing file.
3. Review each conflicting key reported by `config:check`. Retain credentials,
   endpoints, instance identity, control authorization and notional authorization.
   Remove `ACCOUNT_EQUITY_FLOOR`; do not add percentage overrides.
   Remove reviewed legacy internals. Choose paper/stopped for the first check.
4. Apply additive migrations `0015` and `0016` with the existing migration CLI during the
   reviewed rollout. They add provider telemetry, capital state, reusable-context audit,
   five-second claims and terminal deferral; there
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
7. Review provider access/pricing and run a bounded compatibility call. The operator authorized a controlled demo rollout for ISSUE-075. Missing
   notional authorization or reconciliation still block placement. This policy
   change neither clears a loss lock nor grants live authority.

## Rollback

Keep a protected copy of the former environment and release artifact. Pause new
analysis, reconcile outstanding orders, then restore the previous reviewed release
and its environment through the normal supervisor. Keep migration `0015`/`0016` tables
and their audit data: the older release can ignore them. Do not drop tables, edit
migration checksums, reset daily/capital rows, or resurrect expired proposals.
Rollback does not transfer live authority or prove older risk behavior sufficient.
