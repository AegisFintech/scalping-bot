Reviewer launcher boundary and unknown-claim handling: [report](docs/research-launcher-report.md).

Attested research preparation: [import/format convergence and retained rejection](docs/research-import-preparation-report.md).

Research operational boundaries: [private CLI state and question-budget waits](docs/research-operational-waits-report.md).

Research candidate lineage and independent recorder health: [delivery visibility](docs/research-delivery-report.md).

Independent local review: [source/CI/approval/merge gates](docs/research-reviewer-report.md).

Holding-time research: [contract](docs/holding-research-report.md), [scheduled handoff](docs/holding-pipeline-report.md). Separate automated review remains pending.

Local publishing and review checks: [publisher](docs/trusted-publisher-report.md), [review checks](docs/review-admission-report.md).

Implementation queue: [autonomous harness delivery plan](docs/autonomous-harness-delivery-plan.md), with bounded tasks and an explicit full-cycle completion test.

Experiment registration and its authority limits: [frozen jobs](docs/experiment-registration-report.md).

Generated research and independent software checks: [candidate boundary](docs/candidate-attestation-report.md).

Continuous bot/research visibility and publication gates: [harness health](docs/harness-health-report.md).

Current research integration: [bounded observation review](docs/current-observation-review-report.md) connects the existing evidence archive to a confined Codex review thread. Proposed experiments and automatic publishing remain separate.

# Scalping bot

AI-assisted XAUUSD scalping for controlled demo evaluation. One existing demo
account and deployment; real-money live execution is disabled by default.

The isolated research harness reports failed tool results separately from findings;
its deployment and remaining observation are in [the research report](docs/research-failure-guidance-report.md).
The directional GTD gateway and historical rejected-intent recovery are deployed.
The existing demo resumed at 2026-10-29 04:41 UTC with verified startup and account
readiness. [Recovery, safeguards and activation evidence](docs/predispatch-incident-recovery-report.md).
The qualified release passed 2,088 tests. [AGENTS.md](AGENTS.md) keeps operator
directives short and links detailed subsystem rules on demand.
Approved legacy-data cleanup recovered 4.30 GiB net; the research disk-reserve
blocker cleared on its next scheduled run. [Cleanup and retained evidence](docs/legacy-cleanup-report.md).
The separate tc01 paper engine and agent are disabled; its feed, view and research
evidence remain preserved. [Central research status and priorities](docs/central-research-report.md).
Continuous operational verification remains in
[issue 431](https://github.com/AegisFintech/scalping-bot/issues/431).
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
Broker history and reconciliation reject missing or mismatched account identity.
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

Qualification records failures and corrections as well as passing formatting/lint/types/build, Node/Python/schema/migration and
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

The [isolated research worker](docs/isolated-worker-report.md) confines candidate
processes to a pinned runtime with no network or host credentials. It does not
publish code or activate a research loop.

The [offline publisher scope policy](docs/publisher-policy-report.md) checks research proposal boundaries only; it cannot run, publish or merge code.

The [broker acknowledgement design](docs/broker-acknowledgement-design.md) describes the demo acknowledgement recorder and its bounded read-only research export; a real acknowledgement remains unverified.

The [exact-head qualification report](docs/exact-head-checks-report.md) records active main protection and its independent-review limitation.

Distributed experiment delivery is tracked in [the execution report](docs/experiment-execution-report.md). Real registered jobs have remote execution/independent-check/closure evidence; periodic activation is recorded separately. Generated strategy improvement remains a separate milestone.

<!-- research-publication -->

Research-only delivery `2b95c24a3f6b273c3f5661ec5b53191f48d0a3d3244e9d58ae424b0e5892b303`; no execution or promotion authority.
