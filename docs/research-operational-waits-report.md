# Research operational waits

Issue [#472](https://github.com/AegisFintech/scalping-bot/issues/472). Three narrow
operational fixes discovered during [#466 activation](research-delivery-report.md).
No economic policy, trial budget, provider-retry or broker authority change.

## CLI state outside the blocked home

The first natural protected-parent run failed before creating a job. A separate
actual systemd read-only preflight reproduced GitHub CLI's configuration permission
failure under ProtectHome and an empty capability set. Its existing loaded API
credential was not missing or exposed. Setting HOME and GH_CONFIG_DIR to private
protected parent state passed actual source API, mirror, admission and restricted
archive discovery; the natural timer then queued its first source-bound job.

Ship those explicit defaults in the unit. The state directory remains root-owned;
model workers still receive no GitHub/signing/broker credentials. ProtectHome and
empty capabilities remain. No broader permission is added to repair configuration
lookup. Existing private environment values and credential files are preserved.

## Budget exhaustion is a bounded wait

The existing coordinator validated the latest real closed review but found four
reserved trials for its normalized question, matching the four-trial limit. The
newly requested cohort was not already registered. That limit deliberately counts
negative, interrupted and unknown attempts; it must not be increased or erased.

Previously every registration exception became RESEARCH_NEW_REGISTRATION_FAILED,
so the dashboard could not distinguish this expected limit from invalid evidence.
Preserve only the exact known budget exception as RESEARCH_REGISTRY_TRIAL_BUDGET.
The monitor shows WAITING for a distinct attributable question and keeps all closed
trial counts. Existing claimed jobs still reconcile. Unknown remote outcomes take
precedence and remain BLOCKED; all other registration failures remain BLOCKED.
No new question, experiment, provider call or order is manufactured to clear a badge.

## Exact code-generation import guidance

The first natural generation returned valid JSON and exact source/result/finding
bindings, but imported typing.TypedDict. The existing protected dependency checker
permits only Any/Dict/List/Optional/Tuple from typing. Our prompt named allowed
modules but omitted symbol restrictions, so its guidance was broader than the gate.
The draft was correctly rejected; original response/claim/rejection remain intact.

Clarify the exact decimal/typing/future symbol lists and use built-in annotations
or Any for nested structures. Keep the checker unchanged. New protected source and
oracle pins require a fresh source-bound request within the existing four-attempt
budget; never reinterpret the rejected record or replay an unknown request.
This changes research code-generation guidance, not trading entry guidance.

## Delivery

`PATH=/opt/scalper-node22/bin:$PATH npm run qualify` passed all gates:1,275 Node,
147 database and1,071 Python tests (2,493 total), formatting/lint/types/build,
schema/replay/fail-closed, secrets and both dependency audits. All four
`npm run config:check -- .env.sample [--startup]` checks, repeated against the
existing populated deployment file, pass.111 focused tests pass.
[Qualification receipt](evidence/research-operational-waits-validation.json), source
`7e9db681084cd86104cfadc8b0f9baff3c0283bd5834d33cd32b848ce8464d02`.
The existing Starlette/httpx deprecation warning remains.
Graphify AST update:15,074 nodes/25,566 edges/886 communities; existing pyproject
zero-node warning only; no paid semantic extraction.

Both independent reviews approve:0 Standards blockers and0 Spec blockers. Actual
[preflight/rejected-attempt/recovery evidence](evidence/research-operational-preflight.json)
retains the original rejection digests and distinct synthetic namespace proof.
No historical response, claim, result or accounting state was rewritten. Preserve the actual fixed-method
code/runtime, approved source pin, registrations and reports. Deploy only the
coordinator/monitor operational code and unit defaults after reviewed delivery;
retain the previous artifacts and durable state. The first #466 attempt is terminal REJECTED. A new main and prompt/source context
may follow reviewed deployment within the original four-attempt cap. Stop only
new research admission during artifact updates, verify matching protected primary/
tc02 oracle pins, preserve the old pins/records, then resume normal timers.
The frozen namespace runtime/verifier, fixed-method source and registrations stay
unchanged. Matching activation and a successful natural full chain remain pending.
