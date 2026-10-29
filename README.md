# Scalping bot

AI-assisted XAUUSD scalping for controlled demo evaluation. One existing demo
account and deployment; real-money live execution is disabled by default.

The isolated research harness reports failed tool results separately from findings;
its deployment and remaining observation are in [the research report](docs/research-failure-guidance-report.md).
The directional GTD gateway correction and unresolved incident are described in
[the recovery report](docs/directional-gtd-recovery-report.md).
The independent broker-history review and unresolved recovery are recorded in
[issue 427](https://github.com/AegisFintech/scalping-bot/issues/427).
The exact historical recovery procedure is in [the incident report](docs/predispatch-incident-recovery-report.md).
[AGENTS.md](AGENTS.md) now keeps operator directives and essential safeguards short,
with detailed subsystem rules linked on demand.
Continuous operation and research timer verification are tracked in
[issue 431](https://github.com/AegisFintech/scalping-bot/issues/431) and
[issue 430](https://github.com/AegisFintech/scalping-bot/issues/430).
See the [quantitative review](docs/quantitative-review-426.md) for recent demo
payoffs and flight-recorder limits.

## Workflow

```text
wait -> completed OHLC / quotes / DOM -> local technical context -> Codex proposal
     -> deterministic validation / sizing -> one STOP_LIMIT/GTD
     -> native TP/SL and independent maintenance -> reconcile -> repeat
unfilled expiry -> exact zero-fill broker proof -> fresh market analysis
```

Codex proposes direction, entry, TP, SL and pending lifetime. Code owns execution,
broker precision, costs, margin, ownership, dynamic sizing and reconciliation.
WAIT, stale data, closed sessions, active exposure or uncertainty prevent new orders.
A filled position never closes just because the pending-entry timer elapsed.

## Current source contract

| Item            | Contract                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------- |
| Source / policy | `0.8.0-model-scalp.1-codex.1` / `0.8.0-model-scalp.1`                                               |
| Provider        | Subscription Codex, `gpt-6.1-sol`, prompt `entry-scalp-v1`, no API fallback                         |
| Entry           | One trend-direction STOP_LIMIT, broker-acknowledged GTD,60–300s from capture                        |
| Protection      | Model distances: TP<=0.40 price units, SL<=7.00, reward/risk>=0.0571428571                          |
| Demo risk       | At most2.5% for the single order within the unchanged5% setup ceiling; costs/margin may reduce size |
| Evidence        | Completed M15/M5/M1, causal SMC levels, broker-only sampled DOM and flight recorder                 |

Native protection is fill-relative; final absolute levels can differ after entry
slippage. Costs and the five-tick exit allowance are modeled, not guaranteed net
proceeds. Persistent model memory is not training. No profitability claim.

See [release, tests, activation and rollback](docs/model-scalp-report.md). Source
updates do not prove deployment: the matching operational receipt is authoritative.
Existing accepted GTC/OCO groups retain their original orders and protection.

## Development and verification

Use Node22 and Python3.13 with an isolated development environment. Preserve
immutable deployment dependencies, credentials, broker/account history and frozen
research registrations. Read [AGENTS.md](AGENTS.md), [plan.md](plan.md) and the
relevant report before changing code.

```sh
npm run qualify
npm run hooks:install
```

Qualification checks formatting/lint/types/build, Node/Python/schema/migration and
isolated PostgreSQL lifecycle tests, secret scanning and dependency audits. Reviewed
issue branches, README/AGENTS updates, AST Graphify and green checks precede merge.
Normal environment settings are intentionally small; never replace a populated
`.env` with the sample. See [configuration](docs/configuration.md).

## Reports

- [Offline scalping replay and evidence limits](docs/scalp-replay-draft.md)
- [Replay qualification receipt](docs/evidence/scalp-replay-validation.json)

- [Approved tc01/tc02 research integration into this bot](docs/harness-integration-plan.md)
- [Read-only learning evidence bridge and verification status](docs/learning-evidence-bridge-report.md)

- [Architecture seams and review](docs/execution-seams-report.md)
- [Corrected causal fill evidence](docs/fill-evidence-integrity-report.md)
- [Storage and seven-day logs](docs/lean-storage-report.md)
- [Manual intervention and reconciliation](docs/manual-intervention-report.md)
- [Historical README](docs/readme-history.md) and [agent directives](docs/agents-history.md)

Research is SELECT-only, retains unknown/censored outcomes and never promotes a
strategy automatically. Round numbers and shallow broker DOM are context, not
proof of liquidity, accuracy or future fills.

The [offline publisher scope policy](docs/publisher-policy-report.md) checks research proposal boundaries only; it cannot run, publish or merge code.

The [broker acknowledgement design](docs/broker-acknowledgement-design.md) describes the demo acknowledgement recorder and its bounded read-only research export; a real acknowledgement remains unverified.

The [exact-head qualification report](docs/exact-head-checks-report.md) records active main protection and its independent-review limitation.
