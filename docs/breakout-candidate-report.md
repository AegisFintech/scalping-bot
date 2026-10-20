# ISSUE-329 — Entry-preserving breakout candidate

Issue: https://github.com/AegisFintech/scalping-bot/issues/329.

## Scope and authority

`packages/strategy-candidates/src/breakout.ts` is an internal typed, pure research
candidate, deliberately absent from production imports. It provides reviewable
entry geometry, not an activated release, portfolio/risk engine, broker command,
new provider prompt, candle processor or complete reproduction of the discretionary
manual method. Original provider levels are preserved: BUY above ask, SELL below
bid. Neither leg is inverted, clamped toward a quote or shifted after a crossing.
Breakout direction follows whichever boundary is broken; it does not claim that
both opposing entries agree with a single M15/M5 trend. A directional trend filter
would be a distinct candidate needing explicit causal rules and evidence.

The candidate specifies GTC STOP_LIMIT with a 30 tick-size-point entry range.
This is independent from the prior ordinary STOP and quote-adjacent LIMIT releases.
[cTrader's order documentation](https://help.ctrader.com/trading-with-ctrader/orders/)
describes stop-limit execution within the configured limit range after triggering;
execution is not assured. Points here are adapter tick-size units, not a claim
that broker/UI pips are identical. Eventual adapter integration must verify the
wire conversion and real demo acceptance without fabricating a fill.

## Validation

The caller provides original model response, symbol metadata, decision quote,
actual provider availability and decision time. The function rejects stale/future/
unordered times, symbol mismatch, crossed levels, off-tick/nonpositive prices,
invalid stop/target geometry and expired submission authority. It clones output
and never rewrites original inputs or historical schemas. GTC does not extend the
provider's validity: expiry here is the fresh-submission deadline, not pending
order cancellation. Original completed M15/M5/M1 input validation remains a
prerequisite upstream; this small function cannot establish candle provenance.

Internal TypeScript interfaces are exported together with the frozen candidate
constants; no public HTTP/JSON schema or persisted SQL contract changes. Tests
exercise preserved entry direction/identity, rejection paths and input immutability.

## Release prerequisites

No production selection, provider dispatch, order submission, existing-order
cancellation, deployment, risk reset or modification of #319/#255 registrations.
Before a demo release, integrate under an exact reviewed strategy identity,
validate original completed-candle/session/account/risk evidence and final
exact-volume commands, qualify #323 terminal recovery, and register/evaluate
breakout-specific causal paths including missing/partial/open outcomes and unknown
counterfactual costs. Current fade-fill research does not validate breakout entries.
The shared dynamic 1% setup ceiling and existing broker SL/TP/OCO remain required.
No economic superiority or profitability claim. Rollback for this unactivated
module is source removal; historical and operational state stays untouched.

Validation: `PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed at
`/tmp/scalper-qualification-9wBPUf/checks/results.json`: 915 Node, 92 isolated
PostgreSQL and 376 Python tests; formatting/lint/types/build, schema/migration/
fail-closed coverage, secret scanning and both dependency audits passed. Ten
focused breakout tests pass. Known Starlette/httpx and Graphify pyproject warnings
remain; AST-only graph update completed. Final-head hosted qualification is
required before merge. No economic evaluation or deployment was performed.
