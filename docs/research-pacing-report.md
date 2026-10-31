# Relevant, paced holding research

Issue [#483](https://github.com/AegisFintech/scalping-bot/issues/483).
The operator requested relevant research with a timer, replacing the internal
four-attempt holding-generation stop. This is not an OpenAI quota adjustment.

The protected parent checks every15 minutes and the generator every5 minutes.
Generation observation expires after20 minutes to cover the15-minute timer plus
bounded processing; reviewer observations still expire after5 minutes. Original
observation clocks remain intact. Both independently inspect durable prior claims before new dispatch: at least
one hour must pass, including claims from the original batch. Transport claims
are conservative reservations, not proof of provider receipt. Missing responses,
invalid/future/non-UTC clocks or incomplete history block new generation. Existing
claimed jobs remain query-only; saved responses finish without another call.

Discovery and parent/worker admission require completed, validated XAUUSD demo
archives containing closed rows from the last seven days. All rows in the selected
window remain included; selection never uses profit sign. Relevance remains the
fixed recorded holding/cost/payoff task, not unrestricted web browsing or strategy
mutation. A changed result, finding, row set or trusted task prompt can justify
new work; a main/docs revision alone cannot. Matching material is never called
again merely because a timer elapsed. Prompt corrections remain protected source
changes subject to review.

Historical attempts, source-review vetoes, frozen registrations and reports are
retained. One pending mailbox job bounds intake instead of counting completed
history forever. Known-unsent cooldown waits remain queued; duplicate or expired
evidence receives a terminal receipt so future relevant work can enter. Protected
material reservations bind the request before transport and preserve its lineage
even when no provider claim is made. Source reviews still run once per exact source/axis, preserve
negative/unknown decisions and require independent identity, exact-head CI and
review before merge. Their lifetime eight-directory stop is removed alongside
holding generation’s stop. Original fixed-method four-trial registrations remain
unchanged. Workers still cannot sign, publish, trade or promote economic policy.

This authorization supersedes the earlier pending holding corrective allowance;
it does not replay unknowns, change subscription/API billing, reset accounting or
change the one demo executor, entry/risk/TP/SL policy. Neither software tests nor a
successful research merge establish profitability or model training.

## Validation and activation

Source qualification passes all2,532 tests (1,275 Node,147 PostgreSQL,1,110 Python),
format/lint/types/build/schema/replay/fail-closed checks, secret scan and both
dependency audits. [Exact receipt](evidence/research-pacing-validation.json), source
fingerprint `d76680221e8c46149f11518cbfb59a90e93158846612ce6b2fdd430764a96b1d`. Commands: `npm run qualify`;
`npm run config:check -- .env.sample [--startup]` and the same two checks against
the existing deployment file. No populated environment file was changed.

Reviewed delivery and research-only activation/readback are tracked on
[#483](https://github.com/AegisFintech/scalping-bot/issues/483); do not infer deployment
from qualification alone. Both independent reviews
approve after fixing corrupted saved-response validation, terminal duplicate
queue release and expired-before-dispatch recovery. The101 focused checks including the final provider-unknown regression and
four policy/startup checks pass. Browser fixtures verify600-second generation
visibility and1,201-second expiry while preserving review expiry.

Pre-deployment readback found the parent still configured with the earlier
`5093eb1` oracle while the scoring role uses `5c960f1`. This had not been exercised
by a new generation because the original lifetime cap blocked dispatch. Rollout
will update both to the new protected composite oracle and verify exact equality;
frozen namespace/runtime/verifier pins remain unchanged. Initial focused runs exposed intentionally obsolete cap
expectations and transport fixtures with no closed rows; transport tests now
isolate admission, while dedicated tests exercise real relevance and clocks.

Two preliminary qualification runs were stopped while final source corrections
landed; only the final unchanged-source receipt counts as full qualification.

## Standards review

APPROVE. Saved worker responses are now validated before new admission; the
provider-unknown transport guard preserves fail-closed history. No remaining
documented-standard violations or actionable code-smell findings.

## Spec review

APPROVE. Permanent duplicate receipts release intake, and protected reservations
retain expired-before-dispatch lineage without blocking later relevant work.
The parent’s saved transport receipt cannot resolve an unknown provider claim.
No remaining spec deviations. Full qualification passed; matching activation
requires its separate receipt on #483.

Graphify AST update:15,136 nodes,25,726 edges,881 communities; existing
pyproject zero-node warning, no paid semantic calls. Read-only admission against
the four actual parent jobs succeeds without invoking a provider or changing history.
