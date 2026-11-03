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
