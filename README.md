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

A registered trial selects Codex or an explicit local trend-range proposal. Code owns execution,
broker precision, costs, margin, ownership, dynamic sizing and reconciliation.
WAIT, stale data, closed sessions, active exposure or uncertainty prevent new orders.
Broker history and reconciliation reject missing or mismatched account identity.
A filled position never closes just because the pending-entry timer elapsed.

## Current source contract

| Item            | Contract                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| Source / policy | `0.10.0-demo-trials.1-codex.1` / `0.10.0-demo-trials.1`                  |
| Proposal        | Explicit CODEX Sol API-first or registered LOCAL_RANGE; no WAIT fallback |
| Entry           | One trend STOP_LIMIT, original completed range, registered60/180s GTD    |
| Protection      | Structural five-M1 stop <=7; fixed profile TP0.4/0.6/1 price units       |
| Demo risk       | At most2.5% single leg inside5% setup; dynamic costs/margin/volume       |
| Evidence        | Completed M15/M5/M1, SMC/DOM, bounded idle tape and flight recorder      |

Native protection stays fill-relative; proposed structural prices and actual
broker levels are recorded separately. Target admission uses the declared5-tick base allowance; stress evidence and stop
sizing retain65ticks. None guarantees closing proceeds. Realized net includes signed
broker fees. `/learning` shows registered trials, source, waits, fills, net and next
action; stale values are withheld. Persistent model memory is not training.

See [protocol, tests, activation requirements and rollback](docs/demo-trial-protocol-report.md).
Source updates do not prove deployment. Historical registrations, orders, native
protection and broker/accounting history remain unchanged. No profitability claim.

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

Tamper fixtures must explicitly unlock their own read-only files before mutation;
verify them as a non-root user without relaxing production permissions.

For compressed registered-study storage/runtime pins and local /learning status,
read `docs/study-retention-report.md`; preserve old source/registration segments
and keep study failures separate from trading authority.

Verified study511 rollout and actual normal capture: `docs/evidence/study511-activation.json`
and `docs/evidence/study511-normal-capture.json`; economic qualification stays separate.

## Current demo experiment and evidence

The [finite registered trials](docs/demo-trial-protocol-report.md) are active in
ONE demo on reviewed PR525/source39588e87. Normal restart preserves orders;
actual fills, native protection and restart/dedup readbacks are retained in the
[rollout receipt](docs/evidence/demo-trial-rollout.json). Parent515/520 stay OPEN
until two distinct allocations naturally fill, complete and register successors.
Software qualification and a positive trade do not establish a profitable strategy.

[Daily scorecards and retained trial proof](docs/demo-scorecards-report.md) add
read-only /learning visibility and repair the actual idle-tape UTC reader boundary.
Keep the executor/provider/Flight source and active registrations frozen when
updating these readers. Completed facts, losses, zero-fill trials and gaps remain.
Actual broker metadata/signed fees override historical flat-commission assumptions.
Use exact existing terminal-proof functions for nonfill counts, distinguish
unsent/open/unproven groups, and test root ownership independently of runner UID.
The browser-clock regression uses an explicit typed Date override; long evidence
wraps on mobile and desktop. First natural completion/successor proof is retained
in `docs/evidence/demo-first-natural-completion.json`; two-trial proof stays pending. Read-only source qualifies2,845 tests/no skips;
see `docs/evidence/demo-scorecards-validation.json` and issue526 for activation.

Related implementation reports: [cost/tape measurement](docs/experiment-measurement-report.md),
[current-contract screening](docs/current-demo-runner-report.md), and
[detached policy validation](docs/context-policy-completion-report.md).

Current provider/monitoring repair and loss-coverage limits: [ISSUE-528 report](docs/provider-monitor-repair-report.md). Daily learning scorecards include average win/loss; sampled gaps never establish hypothetical profits.

[Loss-control diagnostics](docs/loss-control-study-report.md) preserve full journal denominators while studying structural loss admission, holding time and failed breakouts. Signals are not hypothetical profits or trading authority.

[Position-state clock and R:R diagnostics](docs/position-clock-rr-report.md) separate lifecycle time from protection observations and prepare two gross R:R hypotheses without changing active trades.

Push maintenance permits up to ten minutes for the local AST graph rebuild; failures still block publishing.

First registered R:R findings: [review](docs/first-rr-review.md). Preserve the complete cohort; no exit candidate is economically qualified by these four closes.

Operator-approved trend breakout/retest experiment: [specification](docs/trend-retest-plan.md). Preserve historical reversal semantics; new retest limits must retain trend direction and require versioned execution authority.

<!-- research-publication -->

Research-only delivery `fb2b9b805295ffbf6bfc9456486195059edb36f9f46f4ec9089ea6bfb1155b88`; no execution or promotion authority.
