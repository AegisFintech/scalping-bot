# Frozen exploratory experiment jobs

[#449](https://github.com/AegisFintech/scalping-bot/issues/449) connects a completed
current-observation finding to a durable pending experiment. This is the storage
and registration boundary, not an enabled planner, tc02 dispatcher or publisher.
Those integrations remain #450–#452. The current observation timer is unchanged.

`Registry.register` verifies the completed review's input, diagnostic, model
response, finding, claim and closure bindings. It freezes the whole observation
packet, narrowly scoped source bytes, runtime hash, hypothesis, baseline,
measurement, falsification, cost policy and coverage policy before a job can be
claimed. No model prose executes. Code and method correctness, dependency closure,
source provenance and runtime eligibility still need independent worker admission.
A hash or typed object supplied by an arbitrary caller is not authentication.
Only the trusted coordinator may write this registry; candidates must never mount it.

Only **retrospective exploratory** jobs are admitted here. The supplied observations
were already available to the review. Calling these jobs prospective tests would
be wrong: existing frozen future studies remain separate and unchanged. Recorded
signed costs remain observations; counterfactual net/costs remain null. Complete
input packets retain WAIT, rejections, nonfills, partial/open exposures, carry-ins
and gaps. This queue does not turn missing paths into executable outcomes.

Question identity includes source and normalized exact wording. Repeated identical
code/data/method jobs reuse one trial; every distinct completed finding leaves an
occurrence, including budget-blocked repetitions. Four reserved trials per exact
question include crashes, failures, negatives and unknown outcomes; changing code
or method does not reset that count. This is a bounded initial research policy,
not a trading-frequency gate. Paraphrases are **not** semantically deduplicated;
the future agenda reviewer must inspect stagnation across them. The registry admits
at most1,000 distinct questions and fails explicitly at capacity.

A durable claim grants at most one local dispatch attempt. An existing claim
returns no permission to resend; pending/unknown work stays visible until the
same remote outcome can be reconciled. Results bind trial, registration and claim;
repeated identical receipts are idempotent and conflicting bytes fail. Positive,
negative, inconclusive, rejected, failed, open and gap results remain
`RECORDED_UNVERIFIED_*`, never independent evidence or promotion authority.
Unknown jobs are not erased by a new day or process restart.

Atomic writes, directory fsync and a nonblocking registry lock preserve interrupted
registration/result recovery. Original review files and old Aurum jobs/budgets
are never modified. This library makes no broker/provider/GitHub/network call.
There is no database migration, trading release or service restart to activate.

## Validation

Focused end-to-end tests build a real observation review with a deterministic
provider fixture, then register, claim and retain its result. They cover frozen
bytes, repeat/unknown claims, all outcome classes, interruption at registration,
claim and result boundaries, foreign/conflicting results, exhausted budgets,
invalid provenance, paths, costs and prospective claims. The inert source fixture
raises if executed: these tests prove registration, not strategy quality.

Both independent Standards and Spec reviews pass. Review corrected duplicate
finding reuse and interrupted registration provenance, including another packet's
finding from the same window/question.63 focused registry/observation tests pass.
Two preliminary qualification runs were deliberately stopped for these corrections;
both isolated databases stopped successfully. They are not passing receipts.

Fresh `PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed all required gates:
1,271 Node/schema/replay tests,147 PostgreSQL lifecycle tests and802 Python tests
(2,220 total), formatting, lint, types, build, secrets and dependency audits.
The existing Starlette/httpx deprecation warning remains. Sample and active-file
policy/startup checks pass using `scripts/check-config.ts`, with and without
`--startup`. Graphify AST updated; existing pyproject zero-node warning only.
[Exact qualification commands/results](evidence/experiment-registration-validation.json).

No production experiment has been dispatched by this change. The independently
reviewed registration boundary is ready for the separately tracked #450 consumer.
