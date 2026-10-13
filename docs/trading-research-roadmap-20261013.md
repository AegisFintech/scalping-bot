# Trading research roadmap — October 13, 2026

Operator review issue: https://github.com/AegisFintech/scalping-bot/issues/288.

Documentation review PR: https://github.com/AegisFintech/scalping-bot/pull/296.

Roadmap continuation approved. First-batch written designs: [measurement #299](https://github.com/AegisFintech/scalping-bot/pull/299) and [evaluation protocol #300](https://github.com/AegisFintech/scalping-bot/pull/300), both drafts awaiting concrete design review.

Qualification follow-up: test-only #297/#298 fixes a causal-order fixture race. Both full hosted checks passed on 0645ef4 (38342582664/38342580035); source merged as 1d363d6. Original failure 38334644623 remains retained. No production source or behavior changes.

Status: proposed. This document requests review of priorities and bounded scope; it does not authorize implementation, new paid provider calls, order mutations, registrations or runtime policy changes.

## Why this order

The latest fixed close-time demo cohort (October 9 00:50 UTC–October 13 01:46 UTC) has 80 closes/43 wins, gross -942.36, signed costs -2,233.97 and net -3,176.33 in account-currency units. Average net win/loss is 258.85/386.68. All 80 cost estimates/terminal projections match; all 80 effective entries differ from model levels. These observations support investigating economic edge and attribution, without proving any replacement will win. Closed-trade P/L excludes open positions and is not account return.

The recommendation is to improve measurement and agree falsifiable evaluation rules first. Then review existing entry/TP evidence and evaluate AI contribution. Slower setups and selectivity are independent follow-ups, not one bundled strategy rewrite. Risk containment is a separate operator decision and does not repair negative expectancy.

## Proposed batches

| Order | Issue                                                           | Intended deliverable                                                                   | Depends on                                                            |
| ----- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1     | [#289](https://github.com/AegisFintech/scalping-bot/issues/289) | Trading measurement: fill-relative risk, exit attribution and complete cost coverage   | Existing #249/#261/#276                                               |
| 2     | [#290](https://github.com/AegisFintech/scalping-bot/issues/290) | Research protocol: chronological evaluation and explicit promotion/retirement criteria | Existing #251/#253; measurement for richer metrics                    |
| 3     | [#291](https://github.com/AegisFintech/scalping-bot/issues/291) | Research decision: review frozen entry-preserving and larger-TP candidates             | #255, #289, #290                                                      |
| 4     | [#292](https://github.com/AegisFintech/scalping-bot/issues/292) | Research benchmark: measure AI contribution against deterministic entries              | #289, #290                                                            |
| 5     | [#293](https://github.com/AegisFintech/scalping-bot/issues/293) | Research experiment: slower M5/M15 setups and transaction-cost balance                 | #289, #290; reviewed benchmark methodology                            |
| 6     | [#294](https://github.com/AegisFintech/scalping-bot/issues/294) | Research experiment: cost-aware selectivity and market-condition attribution           | #289, #290; entry/TP and benchmark review                             |
| 7     | [#295](https://github.com/AegisFintech/scalping-bot/issues/295) | Demo risk containment: review lower shared risk and loss-limit enforcement options     | Existing accounting/risk contracts; #222 for deployment qualification |

Measurement and protocol can be designed together. Entry/TP uses the current frozen study rather than a duplicate. Benchmark, timeframe and selectivity each need their own approved candidate definition and future registration. Risk proposal review may proceed independently; implementation and activation await an explicit operator choice.

## Existing issues retained

- #255: ten of thirty immutable windows verified at the review cutoff, zero due unreported, HOLD. Collection ends November 1 04:00 UTC plus reporting delay; elapsed days do not establish qualification. Entry-only and TP-only experiments remain separate. Source, candidates, registration and retained reports stay frozen.
- #222: complete independent broker-calendar coverage, exact protective/terminal/next-cycle proof, current-release recovery, daily rollover and alert receipt acceptance. Preserve existing evidence and timers. Backup/restore remains deferred and unproven; no new backup work is proposed.

## Evaluation and operating constraints

- Preserve current `entry-pair-v4`, literal `grok-4.5`, `0.3.0-fade-limit.3`, dynamic shared 1% setup ceiling, costs/margin/volume precision, fail-closed admission, GTC/OCO and independent protection. Changes require a separate reviewed economic release.
- Record actual causal provider availability/broker acceptance; local placement-result timestamps cannot substitute for broker events. Completed candles only, explicit gaps/open/nonfills/OCO ambiguity and all registered denominators.
- Unknown counterfactual fees/swap/FX/margin/provider costs remain null. Frozen quantities and historical request streams are conditional experiments, not dynamically resized executable portfolios. No candidate qualifies from selected completed paths.
- Predeclare metrics, uncertainty, chronological partitions, candidate inventory and coverage requirements. Review numeric promotion/retirement thresholds before untouched outcomes; no fixed-day profitability guarantee.
- Existing trend/loss-streak/fee checks must be inventoried before proposing selection changes. A filter is an economic change; do not infer permission from issue creation.
- Separate source delivery, research registration/collection and runtime activation. Live remains disabled. No baseline resets, silent model fallback, loss chasing or forced trading.

## Review decisions requested

1. Approve or revise the proposed order and bounded issue scopes.
2. Confirm that the first implementation batch should be measurement plus protocol design.
3. Review the risk-containment options separately before choosing any policy values.

Each approved implementation receives a concrete design and test plan, its own issue branch/PR, applicable full qualification and explicit rollout scope. The current deliverable is the roadmap and reviewable issues only.

## Planning validation

Graphify scoped query and current architecture/risk/research contract review completed; existing open issues checked to avoid duplicate collection/operational work. Every created issue includes acceptance criteria, dependencies and PROPOSED review status. Planning checks passed: `PATH=/opt/scalper-node22/bin:$PATH npm run format:check`, `bash scripts/secret-scan.sh` and `git diff --check`; issue bodies were checked remotely for acceptance criteria and proposed status. Runtime suites are not claimed rerun for this documentation-only proposal; hosted qualification applies to the pushed PR, and all required full checks precede any future merge. No product source, dependency, schema, database or deployment changes.
