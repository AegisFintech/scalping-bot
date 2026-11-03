# Strategy-bound provider completion — ISSUE-521

The detached completion callback revalidated a supplied scalp plan without the
configured strategy version. The default historical0.8 policy rejects targets
over0.40; a valid0.9 multi-unit target became FAILED/AI_SCALP_GEOMETRY_INVALID.
This is a latent non-WAIT path defect, not the explanation for recorded model WAITs.

A real ReusableScenarioModel callback regression first reproduced that failure.
Pass the already configured immutable version at this trust boundary, matching
existing stored-context, retirement and HTTP validation. The current0.9 fixture
now becomes READY; the identical proposal still fails historical0.8 validation.
All49 production-context tests pass. No provider/order was dispatched by testing.

Policy economics, prompt, schema, native protection, cooldowns, unknown outcomes
and financial history are unchanged. Full qualification, independent review and
required hosted checks precede activation. Rollout uses a matched tested release;
record exact artifact/source and scoped broker readiness separately from software
success. Frozen observers keep their original source/registration/evidence.

The initial full check stopped at require-await in the synthetic test adapter;
it was corrected to return Promise.resolve explicitly. This was a check failure,
not a strategy failure or a qualification success.

The subsequent type check also required the fixture prompt identity to remain
a literal, matching the real AiAnalysisResult contract; corrected before final gates.

Final full `PYTHONDONTWRITEBYTECODE=1 node scripts/qualify.mjs` passes all gates:
1,288 Node +157 database +1,282 Python =2,727 tests, including format/lint/types/
build/schema/migrations/replay/fail-closed, isolated DB lifecycle, secret scan and
both dependency audits. [Exact source receipt](evidence/context-policy-validation.json).
Both fresh review axes clear. [PR522](https://github.com/AegisFintech/scalping-bot/pull/522)
requires hosted exact-head success and separate review before merge. Activation
is still pending; this engineering fix is not an economic experiment result.
