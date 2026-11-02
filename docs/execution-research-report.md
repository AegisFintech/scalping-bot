# Execution research inputs and explicit waits — ISSUE-494

New observation reviews now measure the full recorded execution funnel, including
windows with no closed trades. The existing half-hour review cadence, Sol model,
resource budgets, one-hour holding-generation spacing and unknown-claim behavior
remain. Nothing changes trading entries, exits, size, risk or promotion policy.

## Diagnosis

The read-only tc01 audit found44 independently completed experiment windows with
valid bindings. Fresh November2 windows exist. The latest eligible holding window
endsOctober30 18:30UTC and contains the latest actual audited close at18:18UTC.
November2 02:00–02:30 contains failed/expired setups with no closed rows.
The initial hypothesis of missing new closes was rejected: recent acknowledgement
records did not establish filled trades. Repeating holding-code generation would
reuse the same evidence. Its duplicate wait and original negative review stay.

The actual gaps were that observation prompts omitted per-setup details, leaving
useful execution evidence out of the bounded interpretation, and the parent's
current admission reason inherited an old retirement reason. Two red regressions
exercise the actual prompt and parent state boundary. New measurement/display
checks cover clocks, unknown/partial rows, stale/future/missing evidence, hashes,
read failures and recovery.

## Measurement

`execution-funnel-1.0` reuses the existing trusted cohort scorer and completed-candle
research baseline, without modifying their frozen source. It records all packet
role denominators, context decisions, analysis states/reasons, order states,
recorded acceptance/fill/partial/closed rows and known/unknown latency counts.
Acceptance uses mapped causal ORDER_ACCEPTED events matched inside the exact group;
local placement-result persistence is never broker acceptance. Acceptance may be
known while latency is unknown because the matching context is missing.

Request-to-validated-availability is a local workflow clock, not pure inference
time. Quantiles use nearest rank and integer microsecond strings. Missing,
unordered or negative relative clocks stay unknown. Actual counts describe this
packet, with repeatable carry-ins/references; they are not account trade totals
or all market opportunities. Counterfactual fills/net remain null and economic
qualification remains false.

Baseline directions are unexecuted hypotheses at recorded model availability,
without independent orders, fills, costs or an alternate request stream. A BUY
versus model WAIT disagreement establishes a research comparison, not a missed
winner or available profit. Actual price paths were not evaluated here.

The [operator probe](evidence/research494-probe.json) freezes a genuinely recent
packet selected before looking at outcomes. It is a local read-only check, not a
scheduled model review or an independently qualified strategy result.

## Immutability and display

Only NEW observation windows receive the funnel. Their registrations retain
cycle/replay source hashes and add funnel/scorer source hashes before computation.
Original observations, findings, signatures, input domains, approved-method source,
oracle, frozen runtime, registrations and unknown requests remain untouched.
No original fixed-method trial cap is reset, and no code generation is forced.

The receiver validates the exact diagnostic/finding/plan hash and packet/window
binding before exposing a typed aggregate. Old/missing/tampered measurements are
unavailable. The server labels a complete window CURRENT through one hour, then
STALE; future clocks are UNAVAILABLE. Stale counts retain an explicit historical
label. Outer read failure clears the funnel and hides the previous panel; recovery
restores it. Browser time does not establish measurement freshness.

`/learning` separates code-generation wait, measured facts and AI interpretation.
Access remains the existing private Cloudflare ingress, with same-origin controls.
The current parent reason names its actual wait; original retirement proof stays
immutable in its dedicated receipt and retained state.

## Checks and operational status

Focused Python and display-boundary regressions, actual Chromium fixture/mobile
checks and strict111-file typing pass. Independent Standards and Spec reviews are
clear. The duplicated eligibility predicate is a bounded compatibility tradeoff:
the original scorer stays frozen, while acceptance counts remain distinct from
missing-context latency. No new dependency is added.

Full qualification passes all2,630 tests (1,279 Node,147 PostgreSQL lifecycle,
1,204 Python), formatting/lint, TypeScript/build, Python typing, schemas, migrations,
replay/fail-closed, secrets and npm/pip audits. All four sample/deployment policy
and startup checks pass. [Qualified source](evidence/research494-qualification.json).
The earlier qualification stopped at a require-await violation in the browser
fixture; Promise-based fixtures fixed it without weakening lint. The final full
run uses unchanged source and passes. Chromium fixture checks cover no-key access,
forms, current/stale/unavailable counts, baseline labels, text safety, mobile width
and zero page errors. Both independent review axes have no remaining P1/P2.
The issue is the authoritative current delivery/activation record:
https://github.com/AegisFintech/scalping-bot/issues/494.
Source delivery alone does not prove the first new scheduled review. Actual
next-window diagnostic, prompt/claim/finding closure and UI readbacks must be
verified after rollout. Future broker ACK pairing #407, natural positive holding
merge #466 and economic qualification #403 remain separate open acceptance.
