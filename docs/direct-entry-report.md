# ISSUE-086 — Direct stop entries

Release `0.2.4-direct-entry.1`, policy `direct-entry-v1`.
[Issue #202](https://github.com/AegisFintech/scalping-bot/issues/202).
[Pull request #203](https://github.com/AegisFintech/scalping-bot/pull/203),
implementation checkpoint `274969b` committed and pushed.

The operator requested readable buy/sell stops from EPRToken and removal of order
placement validations on September 9. Production now requests only `buy_stop`
and `sell_stop`. Spread, percentile/abnormal-spread, ATR entry/stop limits,
preferred entry corridors, model target-room and the daily order-count ceiling
no longer select which otherwise executable pairs can be submitted.

## Model and execution contract

`entry-pair-v1` requests two prices with the same exact DeepSeek route and expanded
completed history. Current bid/ask and broker minimum entry distance now accompany
the candles. Prices are used directly, without moving them by an ATR buffer or
requiring zones, multiple targets, echoed IDs, echoed timestamps or schema labels.
The reader accepts string/numeric prices, optional surrounding prose/JSON fences,
extra fields and entry objects containing `entry_price` or `price`. It rejects
missing/nonpositive/nonfinite/unrepresentable prices, off-tick prices, duplicate
keys and multiple competing pairs; it never evaluates provider text as code.
Requested/returned model identities remain recorded, but a different returned
identity no longer rejects readable entries on this explicitly selected path.
No fallback request is added. Failure codes identify unreadable pairs, missing
prices, duplicate keys, ambiguity or broker precision directly.

The HTTP route `/v1/entry-pair` transports the exact raw reply and telemetry.
The application binds its own account-scoped request identity and five-minute
capture-based lifetime. The local HTTP consumer parses the raw prices independently.
The `entry-pair-provider-1.0` request schema is intentionally two fields;
`entry-pair-context-1.0` documents the trusted local journal envelope. The permissive
provider reader is deliberately broader than the requested output format.
Historic scenario schemas/prompts and research tools remain unchanged. Legacy
maps cannot be consumed as direct entries, but still constrain request cooldown.

No SQL migration is required: `scenario_contexts.plan` already stores arbitrary
JSON objects and has no scenario-field constraint. The existing READY/time/state
constraints, account scope, unique consumption link and historical rows remain.
`entry-pair-execution-v1` projects the pair into the existing internal schema 2.1;
its technical-map fields describe mechanical local order geometry, not additional
AI forecasts. Both entries receive locally calculated fee-buffered TP/double SL
and the existing cost-inclusive risk sizing.

## Constraints retained

This removes strategy selection filters, not the executable-order and lifecycle
requirements: positive prices on broker precision, stop entry on the correct side
of current bid/ask, broker minimum distances, supported costs/currencies, affordable
broker volume/margin, valid local submission deadline, current completed-candle
data and fresh broker quotes, durable account reconciliation, strategy ownership,
single-setup/idempotency, authenticated controls and durable persistence remain.
The 1% shared modeled setup-loss budget, 5% daily loss budget, 5% drawdown lock and
risk reductions remain. No loss locks are reset and no live execution is enabled.
The three-second quote/book/input limits remain data-integrity requirements.
Thus this release does **not** implement literal removal of every validation.

Local TP still exceeds the modeled fee-buffer requirement; SL distance is twice
TP. The model cannot choose volume or risk. Broker stop-limit tolerance remains
five points. Wrong-side prices and broker rejection can still prevent placement;
the release cannot guarantee a fill or eliminate every idle state. The broker's
earlier first-leg cancellation cause remains unknown.

Accepted orders remain GTC through normal restarts. Fill/partial-fill peer
cancellation, zero-fill incomplete-pair cleanup and independent protection remain.
The five-minute failure/unknown-dispatch cooldown and one verified post-close
refresh exception are unchanged; removing retry delay was not requested here.

## Validation and rollout

All required gates passed: formatting, lint, TypeScript, build, 572 Node tests,
28 schema tests, three migration tests, three isolated PostgreSQL/TLS integration
tests, Python formatting/lint/types and 140 Python tests, sample/populated policy
and startup configuration, replay/backtest/scenario fixtures, secret scanning and
both dependency audits (zero findings). A missing test `timeoutMs` and an incorrect
isolated database role were corrected before the passing reruns. The test database
was stopped afterward; no production test writes or migrations were needed.
[Exact commands and results](evidence/direct-entry-validation.json).

Positive tests cover permissive provider formatting, omitted provider
metadata, local provenance, the actual HTTP route, direct far-entry construction,
and coordinator placement despite low spread/ATR limits. Rejection tests cover
missing/ambiguous/invalid prices, wrong tick precision, uncertain account state,
consumed maps and old scenario maps. Synthetic tests are not trading-performance
evidence. Graphify was updated with AST parsing and no API calls; its existing
`pyproject.toml` zero-node parser limitation remains. The repository secret script
reports pre-existing missing image paths; an additional all-index credential and
key-pattern scan covers the staged tree before each commit. The seven image
deletions belong to the existing working tree and are excluded from this change.

A separate real-market compatibility probe at 13:32 SGT received a readable pair
in 5,874 ms using all 480 completed candles (28,923 input / 19 output tokens).
It had no broker command authority and was not a production context request.
Requested identity was `deepseek-v4-pro/u5W`, returned `deepseek-v4-pro`, cost
unknown/null. [Probe evidence](evidence/direct-entry-probe.json).

Demo analyses were paused at 13:30:38 SGT while the account was flat. Matching
AI/execution/dashboard services restarted on the new release, passed startup and
readiness, and automatic demo analysis resumed at 13:35:43 SGT. All five PM2
services were online, without cached model/policy overrides. The populated
environment remained byte-identical (24 keys, mode 0600; template 20 keys), and
saved daily/capital risk state matched the pre-rollout snapshot.

The first durable production request became READY in 5,942 ms with the new
`entry-pair-1.0` contract: buy 4388.89 / sell 4384.67. At 13:36 SGT placement was
rejected with `BUY_ENTRY_TOO_CLOSE`; the independently sampled ask was already
4388.90. Broker reconciliation reported zero pending orders and zero positions.
This is a retained executable-stop requirement, not an EPRToken parsing failure.
The map keeps its original lifetime and cooldown. No new fill or completed
SL/TP cycle is established by this observation.
[Demo and configuration evidence](evidence/direct-entry-rollout.json).

## Rollback

Pause new analysis, reconcile existing exposure and preserve GTC orders/positions.
Restore the prior reviewed build and restart matching AI/execution/dashboard code
under the existing demo controls. Do not rewrite the environment, contexts,
model history or risk locks. Retain the new schema files for reading its history;
there are no SQL changes to undo. A prior runtime must not consume an unexpired
direct-entry map as a legacy scenario; wait for its original five-minute lifetime
and normal request cooldown before restoring automatic analysis.
