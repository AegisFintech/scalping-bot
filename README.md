# Scalping bot

AI-assisted XAUUSD scalping for controlled demo evaluation. One existing demo
account and deployment; real-money live execution is disabled by default.

[Token usage and bounded context](docs/token-usage-report.md): full fresh market
inputs stay intact; old chart history no longer accumulates all day.

Scheduled research retains its independently reviewed vetoes and all prior attempts.
[Relevant, hourly paced research](docs/research-pacing-report.md) replaces the holding
generator’s lifetime cap. Research grants no trading or automatic economic promotion
authority. See [activation history and remaining work](docs/research-pipeline-activation-report.md),
[installed bounded input repair](docs/research-input-domain-report.md#reviewed-activation), and
[implementation queue](docs/autonomous-harness-delivery-plan.md).

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
The [latest loss reconstruction](docs/loss496-review.md) verifies all14 current-release
closed paths and separates broker pips, actual fees and sampled exit evidence.

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

| Item            | Contract                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| Source / policy | `0.9.0-cost-balanced.1-codex.1` / `0.9.0-cost-balanced.1`                                              |
| Provider        | API-first `gpt-6.1-sol`/low, prompt `entry-scalp-v2`; approved subscription fallback on API credit/cap |
| Entry           | One trend-direction STOP_LIMIT, broker-acknowledged GTD,60–300s from capture                           |
| Protection      | Model distances <=7.00; modeled net reward >= modeled stop loss after fees/65-tick reserve             |
| Demo risk       | At most2.5% for the single order within the unchanged5% setup ceiling; costs/margin may reduce size    |
| Evidence        | Completed M15/M5/M1, causal SMC levels, broker-only sampled DOM and flight recorder                    |

Native protection is fill-relative; final absolute levels can differ after entry
slippage. Costs and the65-tick adverse-exit reserve are modeled, not guaranteed net
proceeds. Persistent model memory is not training. No profitability claim.

See [release, tests, activation and rollback](docs/cost-balanced-scalp-report.md). Source
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

Authentication fixtures run without root; deployment still requires private root-owned control credentials.

Learning resources and the separate `/learning` console: [operator guide](docs/learning-control-report.md). API-first uses the approved US$20/day ceiling with credit/cap subscription fallback; research pauses do not pause position protection.

[Current economic review and execution evidence](docs/completion489-report.md):
research blockers and actual activity age are visible in `/learning`; future
metadata/acknowledgement collection has no trading or promotion authority.

The [private learning console](docs/completion491-report.md) relies on existing
Cloudflare Access, with no second admin-key prompt; control write checks remain.
[Verified deployment](docs/evidence/completion491-activation.json).

[Execution research visibility](docs/execution-research-report.md) separates recorded
WAIT/nonfill/latency measurements from code-generation waits and unexecuted baselines.

The separate [native entry-range study](docs/entry-range-study-report.md) freezes
10-vs30-point observational collection without changing demo orders or promoting
a candidate. Unknown-clock fills remain visible. Actual activation/evidence is
recorded on issue #499. Metadata warm-up does not backdate outcome collection.
The linked report records2,675-test software qualification, not economic validation.

[Version-aware learning evidence](docs/research-observation-scope-report.md) keeps
unsupported historical replay separate from actual current trading decisions and
recorded outcomes. Its report records software qualification separately from
economic acceptance.

The [prospective context-tracing plan](docs/wait-context-tracing-plan.md) records
missing WAIT/context links without inferring historical associations.

For execution-aware attribution, fixed breakout hypotheses, agenda/recovery and
independent inference/maintenance, read `docs/execution-aware-harness-report.md`.
Preserve old study segments; rebase only completed never-scored standalone
generation with unchanged protected contracts and fresh scoring/review.

<!-- research-publication -->

Research-only delivery `ddaba508ad0cb363994bebbdcb0265262c14dd8edff266084eb53fa21a40a199`; no execution or promotion authority.
