# ISSUE-085 — DeepSeek and richer market context

Date: September 9, 2026. [Issue #200](https://github.com/AegisFintech/scalping-bot/issues/200).
Release: `0.2.3-equity-risk.11`; branch: `issue-085-deepseek-model-context`.

## Change

The active EPRToken Responses request uses the literal `deepseek-v4-pro/u5W`.
The September 9 non-trading identity probe returned HTTP 200, normalized model
`deepseek-v4-pro` and valid strict boolean JSON in 3,449 ms (50 input / 30 output
tokens). Only the exact route and this explicitly observed alias authorize new
DeepSeek results; unknown or missing identity rejects. Historical Astra/Sol
aliases and evidence remain intact. No silent fallback is configured, and the
suffix is not translated to client settings. Endpoint identity
is compatibility evidence, not independent verification of upstream weights.
[Identity evidence](evidence/deepseek-identity.json).

[DeepSeek's Responses documentation](https://api-docs.deepseek.com/guides/responses_api/)
says only its vision model processes image content. The selected Pro model now
receives structured completed OHLCV history: up to **240 M1 / 144 M5 / 96 M15**
bars, versus prior chart-aligned tails of 80 / 60 / 48. This is about four / twelve /
twenty-four hours without session closures, 480 bars in total. Prices and volumes
retain their original decimal strings (or unavailable volume null), times and
quality flags. Named columns plus ordered row arrays remove repeated field names
without dropping observations; a reconstruction test verifies exact candle values. The entire source
history remains validated before slicing; marked historical closures are not
interpolated. Local chart bytes, checksum, freshness and end times remain required
and archived; no unsupported image is sent to Pro.

New immutable `scenario-v3` and research-only `scenario-research-v2` prompts explain
the numeric context and distinguish recent structure from distant levels. Earlier
prompts are unchanged. Output remains strict `scenario-1.0`, with the same semantic,
tick alignment and five-minute capture-based validity checks. A first full-market probe at the default thinking effort returned
`AI_RESPONSE_INCOMPLETE` after about 72 seconds and was rejected.
A second probe with low thinking effort confirmed truncation at 4,096 reasoning
tokens without a final answer (38,805 input tokens, about 74 seconds). The planner
explicitly requests `reasoning.effort=none` (thinking disabled)
with a 4,096-token output ceiling to fit the bounded analysis deadline. This is a compatibility/latency choice;
analysis quality versus thinking mode is unproven. The 90-second provider and 95-second HTTP deadlines, zero retries and durable
cooldowns are unchanged.
Non-thinking probes completed in about 8–11 seconds but initially omitted the
required `schema_version`; a subsequent reply used objects for price targets.
Local schema validation rejected each. The new prompts explicitly give the full
unchanged object shape, `schema_version="scenario-1.0"` and string target arrays. No field is
inserted into, repaired or coerced onto model output. The endpoint
strict-schema flag alone is not trusted. Later non-thinking replies were marked
completed by EPRToken but stopped inside JSON; these also failed closed. Compact
row tables reduce redundant input tokens while retaining the same history.
The final real-market table request validated in **9,838 ms**, with 29,584 input /
236 output tokens, 66,065 request bytes and zero reported reasoning tokens.
It used all 480 bars, the requested DeepSeek route/observed alias, strict output
schema, tick alignment and original five-minute validity. This one success is
compatibility evidence, not a reliability or strategy-quality estimate.
[All bounded probe outcomes](evidence/deepseek-scenario-probes.json).
The execution consumer checks the exact new prompt/hash and structured profile.
More history and a different model do not establish improved analysis, fills or
profitability. EPRToken route pricing has not been independently verified; cost
remains null. Research observation still cannot trade.

Local entry/fee-buffered TP/double-SL, deterministic position sizing, shared 1%
setup risk, 5% UTC daily loss budget, durable capital locks, GTC persistence and
owned-peer cancellation are unchanged. Old-model maps cannot authorize new orders;
old failed or unknown dispatches still constrain request admission. Active groups
continue to prevent inference, while protective maintenance remains independent.
No live execution is enabled.

## Migration and rollout

Forward migration `0020_deepseek_context_model.sql` adds the exact DeepSeek route
to the journal constraint and validates existing rows. It does not rewrite model
history, data or prior migration checksums. All earlier identities remain allowed
for immutable records; runtime consumers accept only the active release pin.
No output/telemetry JSON Schema changes or destructive data transition are needed.

Existing demo analyses were paused at 10:47:58 SGT with no active setup. The
populated environment and prior build were backed up in protected local storage.
Only `AI_MODEL` changes; credentials, endpoint, authorization and other keys are
preserved. All software gates passed: 553 Node / 140 Python / 27 schema / 3 migration /
3 isolated PostgreSQL/TLS integration tests; formatting, linting, TypeScript/build,
Ruff/mypy, configuration/startup, replay/fail-closed fixtures, secret scanning and
zero-vulnerability dependency audits. An initial test lint issue and the stale
migration-list fixture were corrected and retested. Both populated and sample
policy/startup checks passed. Graphify was updated using local AST extraction;
its known `pyproject.toml` parser limitation remains.
[Exact commands and results](evidence/deepseek-validation.json).
The matching AI/execution demo rollout follows this implementation checkpoint.

Source candle retrieval remains 600 M1 / 500 M5 / 300 M15. The existing normalized
decision journal retains compact raw tails and full derived features plus the
chart; it is not a complete copy of the expanded provider candle history. This
pre-existing audit limitation is explicit. Request byte/token telemetry records
actual payload size; no claim of complete provider-input replay is made.

## Rollback

Pause new analyses, reconcile exposure, restore the reviewed `.10` build and
only the previous model assignment, then restart matching AI/execution services.
Keep migration 0020 installed so DeepSeek history remains readable; do not narrow
the constraint or rewrite rows. Historical prompt files remain available. Preserve
current credentials, controls, daily/drawdown locks, GTC orders and request cooldowns.
Restore only prior demo authority after successful preflight. Back up the database
and protected chart store together; never delete audit rows or chart bytes.
