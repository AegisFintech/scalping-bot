# ISSUE-289 — Execution economics evidence design

Issue: https://github.com/AegisFintech/scalping-bot/issues/289.
Parent: #288. Status: concrete design for operator review; implementation not started.

## Intent and scope

Extend the current read-only demo diagnostics to explain entry/exit economics. Keep the current cost-payoff/learning contracts immutable, expose defensible observations, and make missing evidence actionable. No runtime gate, broker client, model request, journal rewrite or automatic promotion.

## Proposed interface and files

Add `packages/evaluation/src/execution-economics.ts` with typed internal `ExecutionEconomicsRow`, `executionEconomicsObservation(row)` and `executionEconomicsReport(args, rows)`. Add `scripts/review-execution-economics.ts`, command `demo:execution-economics` and `schemas/execution-economics-1.0.json`. Keep the existing exporters and `DiagnosticRow` contract unchanged; compose their validated projection in the new module.

The new exporter accepts the existing fixed release/from/until CLI window contract (31-day/10,000-close maximum). Use a repeatable-read READ ONLY transaction, 15-second statement/30-second idle timeout, scope rejection, bounded evidence arrays and rollback before output. It exports no broker/account/order IDs, raw payloads or credentials. It runs manually against the current database; no observer registration/deployment changes.

## Evidence and calculations

1. **Close matching:** require exact owned group/position/side/time, complete entry/close volume and a unique mapped terminal close projection. Missing, partial, conflicting or duplicate evidence stays null with an explicit reason. Do not select the latest record to conceal ambiguity. Actual gross plus signed swap/commission/conversion must equal stored net; costs are never subtracted twice.
2. **Fill-relative protection:** independently report entry VWAP, intended distances and the first causally eligible exact-volume verified protection observation after the full entry fill. Include observation delay and observed protection geometry; do not call delayed protection the initial fill-time stop or continuous coverage. Out-of-order/invalid/ambiguous samples cannot supply a stop-risk estimate.
3. **Actual stop risk:** monetary stop-risk requires valid volume and causal instrument pricing/FX evidence, verified protection and defensible cost/slippage assumptions at the relevant time. Current raw `tickValue` or today's broker metadata cannot retrofit historical risk. If unavailable, retain null and explain the evidence gap; an approved leg budget is never actual stop risk. Label any modeled protection-snapshot loss estimate separately from guaranteed maximum loss.
4. **Exit attribution and slippage:** broker type 4 supplies only native protection. Exact SL/TP reason requires explicit causal trigger evidence. Price comparison additionally requires the contemporaneous valid protection level, exact closing fill and side. Gaps/partial fills/unknown trigger/reference produce null slippage. A favorable P/L sign cannot prove TP.
5. **Sampled excursions:** reuse checksum/provenance-validated sampled bid/ask evidence through a separately supplied bounded recording input, with exact owned position interval and executable side. Long liquidation uses bid, short uses ask. Reject conflicting duplicates; report largest gap and coverage. If path coverage is incomplete, label observed extrema as a lower-information sampled observation and leave full-path MAE/MFE unknown. Do not bridge closures or use post-close prices. No arbitrary new tape regeneration or recorder change.
6. **Costs:** publish actual matched commission/swap/FX components as already available. Provider money remains null without direct billing evidence; token counts/identity/latency alone are not billed dollars. Link context-level provider evidence without charging it independently to both OCO legs/trades. Allocate only under a reviewed explicit allocation rule; otherwise keep setup/provider amounts separate from trade net.

## Tests and completion criteria

- Pure tests: long/short side arithmetic; matched versus partial/conflicting closes; delayed protection cannot imply initial risk; missing historical FX/metadata remains null; no double subtraction; unsupported trigger cannot become SL/TP; no P/L-based inference; zero remains distinct from unknown.
- Sample-path tests: executable-side extrema; checksum/time conflict; gap/closure; open cutoff; post-close exclusion; duplicated files cannot double count.
- Schema/CLI tests: fixed UTC windows, unknown costs, broker authority false, no credential/identity fields, row/scope/array limits.
- Isolated database integration: exact scope/ownership/volume/time joins, ambiguous duplicate rejection and READ ONLY access. Do not mutate production for testing.
- Fixed-window actual-data audit labels all incomplete metrics and retains denominators. Future collection requirements appear as a follow-up proposal rather than invented historical evidence.
- Full repository qualification and dedicated source PR follow approved design; no source/deployment change to #255. Acceptance is reliable attribution, not guaranteed non-null metrics or profitability.

## Trade-off and review

Recommended: extend a new read-only contract rather than change current runtime telemetry or historical schemas. It gives safe useful evidence first; some risk/trigger/provider measurements will remain null until a separately reviewed collection capability exists. An alternate new runtime recorder could resolve more gaps but adds operational scope and is not included here.

Please review the evidence requirements and nullable behavior before implementing the new exporter. #290 supplies separate economic evaluation rules; its numerical qualification choices must be reviewed before registration.

## Design validation

Existing diagnostic, cost, broker-event and protection contracts inspected. Diff/self-review checks preserve unknowns, causal scope and original #255 artifacts. Changed-file Prettier, staged diff and secret scan precede commit. Documentation only; no economic/test pass claim.
