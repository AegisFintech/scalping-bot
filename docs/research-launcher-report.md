# Restricted reviewer launcher

Issue [#477](https://github.com/AegisFintech/scalping-bot/issues/477) follows
[#465](research-reviewer-report.md) and [#466](research-delivery-report.md).

The first scheduled signed candidate, [PR #476](https://github.com/AegisFintech/scalping-bot/pull/476),
passed both exact-head hosted checks. Its reviewer recorded a root Standards claim
but could not start the worker: the shipped PATH is `/usr/local/bin:/usr/bin:/bin`,
while Debian installs `runuser` in `/usr/sbin`. No worker binding/claim/response or
GitHub transition claim was recorded. The next scheduled check correctly reported
OUTCOME_UNKNOWN. Missing worker evidence alone does not authorize replay.

The production-command regression invokes the captured launcher with `--version`
under the actual source unit's PATH. Before the fix it deterministically fails
with `FileNotFoundError: runuser`; afterward it passes. The only production change
is the absolute `/usr/sbin/runuser` executable. Environment clearing, protected cwd,
safe Python path, UID/capabilities, credentials, filesystem limits, both review
contexts, source/CI checks and durable claims remain unchanged.

Ranked alternatives were launcher lookup, UID/filesystem restrictions, and missing
child runtime dependencies. A matching tc01 systemd probe exercised the actual
fixed command/environment, substituting only a provider-free child assertion for
the worker module invocation. It imported the real worker/ReviewInput, validated
input, found the existing Codex CLI, confirmed the unprivileged UID and existing
OAuth access, and proved the loaded reviewer credential unreadable. This falsifies
the latter two alternatives at the tested launch/import boundary; it does not prove
provider availability or an actual review. Its public receipt contains no secrets.

The previous claim/source/signature remain immutable. After reviewed main changes,
#476 becomes stale and can be explicitly closed with its evidence retained; it
must not be manually approved/merged as unattended proof. A new eligible source
context may use the existing fourth/final generation attempt. No budget reset,
unknown replay, economic qualification, trading change or frozen worker edit is
part of this fix.

Validation: 51 focused reviewer/source-review/boundary/publisher tests pass, including existing
unknown-claim non-replay and API failure/restart paths. All 2,496 tests pass (1,275 Node, 147 database, 1,074 Python), with full
format/lint/types/build/schema/replay/fail-closed, secret scanning and both dependency
audits. Four sample/deployment policy/startup checks pass. Both independent reviews
approve with zero findings. [Exact qualification receipt](evidence/research-launcher-validation.json).
Graphify AST: 15,088 nodes / 25,593 edges / 903 communities; existing pyproject
zero-node warning remains. No paid semantic extraction. Exact-head hosted checks,
separate GitHub approval and matching deployment remain required before completion.

The first full run exposed two integration failures: the separate credential
boundary fixture still expected the old launcher, and a README link appended
after the protected publication marker violated the fixed template. The fixture
now asserts the absolute launcher; the link precedes the marker. No template
validation or credential assertion was relaxed. The corrected full rerun is
required; the initial 1,072-pass/two-failure Python run is not a pass.

The second full run reached the unchanged forward-study disk guard: 14 failures,
1,060 passes. This study directory lives on the separate `/tmp` tmpfs, whose minimum
reserve is 2GiB; root filesystem free space is not its available capacity. Removed
only ignored reproducible graphs/type/lint caches in inactive issue worktrees,
preserving source, current graph, receipts, runtime/rollback environments and frozen
studies. `/tmp` free space recovered to 2,905,047,040 bytes. All 38 forward/summary
tests then passed with the real reserve check unchanged. The complete rerun below,
not either failed run, determines qualification.

Rollback: restore only the prior reviewer artifact. Preserve all claims, signed
publications, rejected/stale drafts and worker/API receipts; never replay an
unknown review or change demo execution.

Commands: `PATH=/opt/scalper-node22/bin:$PATH npm run qualify`,
`npm run config:check -- .env.sample [--startup]` repeated against the existing
deployment file, and `.venv/bin/pytest -q tests/python/test_research_reviewer.py
tests/python/test_source_review.py tests/python/test_reviewer_boundaries.py
tests/python/test_research_publisher.py`. The final passing qualification source
fingerprint is `40bf832a141eb4f9f587a2618b6c7341ba4534865a23e0a0600731e80bc3e74a`.
