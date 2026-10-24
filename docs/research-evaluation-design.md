# ISSUE-290 — Economic evaluation protocol design

Issue: https://github.com/AegisFintech/scalping-bot/issues/290.
Parent: #288. Status: concrete design for operator review; no registration or recommendation authority.

## Intent

Make every future experiment answer a frozen, falsifiable question and give an honest HOLD/REJECT/REVIEW_REQUIRED decision. A source passing unit tests, a 30-day collection, a high win rate or selected complete paths cannot qualify a strategy. This proposal preserves existing #251/#253/#255 HOLD guards.

## Protocol artifact

New contracts live in `packages/evaluation/src/research-protocol.ts` and `schemas/research-protocol-1.0.json`; isolated CLI validation goes in `scripts/check-research-protocol.ts`, with pure/schema/CLI tests. A separate retained review artifact uses `research-review-1.0.json`. No existing #255 registered files or schemas change.

Protocol fields: version/experiment ID; research-only authority; frozen source/candidate hashes; one hypothesis and primary endpoint; chronological development, validation and untouched prospective windows; fixed baseline/candidate definitions; candidate inventory and selection history; feature/provider/broker causal availability; GTC/OCO and gap/open censoring; quantity/margin/cost/request-stream model; predeclared uncertainty and sensitivity methods; market-condition coverage; numerical risk/retirement rules; explicit operator-review receipt. Register only future windows, before outcomes; never edit an active protocol to fit results.

Development may propose one candidate. Validation may reject it but cannot repeatedly tune and continue to call the same interval untouched. A changed candidate requires a new version and new untouched outcomes. Retain rejected experiments and declared denominators; never silently narrow to winners.

## Proposed evaluation choices for review

- Primary economic metric: actual after-cost closed setup P/L normalized by pre-intent reconciled equity, aggregating both race-exposed legs at setup level. Unknown or unresolved full outcomes remain visible and prevent full-cohort net qualification. Report trade-level results separately, never sum them as account return.
- Uncertainty: chronological block resampling over setup outcomes with an explicitly frozen block construction and deterministic seed; 95% intervals proposed. Select block length from development evidence only. Diagnose serial dependence and small-block counts; inadequate coverage stays HOLD.
- Require the lower confidence bound for after-cost expectancy to exceed zero for REVIEW_REQUIRED. This is proposed evidence screening, not an automatic promotion threshold or guarantee.
- Require separately approved maximum drawdown/tail-risk and cost/slippage stress criteria. Suggested starting review limit is 5% equity drawdown, reflecting the existing risk model; define an actual reconciled equity/cashflow series before calling it portfolio drawdown. Closed-trade cumulative-dollar drawdown cannot substitute.
- Evaluate largest-winner dependence and higher causal transaction-cost/slippage assumptions. Sensitivity exclusions are supplementary; original outcomes/denominators remain immutable.
- Require chronological coverage of both quieter and volatile markets and trending/ranging conditions based on frozen causal labels. Do not claim independence from the passage of a fixed number of days/trades. Specific coverage and sample adequacy rules must be approved in the registration before collection.

These choices are proposals, not presently approved constants. An unreviewed/incomplete protocol cannot register or yield REVIEW_REQUIRED.

## Decision artifact and safety

`assessResearchEvidence(protocol, evidence)` produces one of HOLD, REJECT or REVIEW_REQUIRED plus explicit reasons, and always `brokerAuthority: false` / `promotionAuthority: false`. It accepts only checksum-verified registered artifacts with matching fixed source/candidate/window identity. It cannot dispatch, choose lot sizes, place/cancel, change runtime configuration or mark a candidate production-approved.

HOLD applies to incomplete protocol/review, touched holdout, missing/inconsistent costs or causal availability, unknown dynamic sizing/request streams, incomplete/gapped/open/OCO paths, selected-subset claims or insufficient condition/dependence coverage. Conditional gross-only comparisons remain useful descriptions but cannot become net portfolio qualification.

REJECT requires sufficient defensible evidence against frozen criteria. It is not inferred solely from missing data. REVIEW_REQUIRED requires all reviewed evidence criteria; the result still needs independent manual economic review, a separately versioned release, #222 operational acceptance and explicit rollout scope. Human review does not permit bypassing failed safety/quality checks.

## Tests and completion

Schema checks enforce authority false, exact versions/time ordering, immutable hashes and reviewed protocol fields. Pure tests must show every missing/ambiguous class above yields HOLD, a selected complete winning subset cannot qualify, contradictory ownership/cost evidence rejects the artifact, and valid complete data can request review without granting execution/promotion. Test zero cost only when directly supported, stale/newer source, unknown economics, touched validation and duplicate candidate identity.

CLI bounds reads and creates review output exclusively, refusing overwrite/backdate or writing inside the current #255 study. Full isolated qualification, documented actual sample review and a dedicated source PR follow reviewed design. This issue delivers protocol enforcement, not a profitable strategy or a new trading gate.

## Dependencies and review

#289 provides richer defensible actual observations. #255 completes its existing collection unchanged, using its original limitations. Proposed benchmark/timeframe/selectivity experiments #292–#294 each require a separate future protocol; this artifact cannot retroactively qualify the October observations.

Review primary metric, uncertainty approach, coverage and risk criteria before implementation and any registration. Keep implementation scopes distinct from optional new market/billing data collection.

## Design validation

Self-review against #251/#253/#255 and #289 preserves conditional/portfolio distinctions, current guards and unknown cost/censored denominators. Proposed numeric screening choices remain unapproved. Changed-file Prettier, staged diff and secret checks precede commit; no runtime or economic qualification claimed.
