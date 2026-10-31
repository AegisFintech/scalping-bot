# CI and independent-review admission observations

Issue [#463](https://github.com/AegisFintech/scalping-bot/issues/463), under #431/#403.
The publisher previously labelled every open PR AWAITING_REVIEW, including the
failed CI on #459. Before scheduling a reviewer, this observation must distinguish
missing/running/failed checks from an eligible independent review request.

The local publisher now reads actual check runs for its exact signed head and the
pinned GitHub Actions App15368. Every required run must complete successfully;
a failed run outranks another pending run. Missing checks wait, and unknown source,
status, incomplete/truncated responses fail closed. The separate reviewer's latest
binding review, ordered by validated UTC submission time rather than creation ID,
for that head governs the next observation; a later change request
blocks and dismissal requires review again. Comments do not revoke approvals.
Other identities and approvals on other commits do not qualify. Conflicting review
IDs and unsupported states reject.

Open signed publications use this result in existing typed publisher health.
Closed/merged publications retain existing reconciliation and bypass new review
polling. No schema or execution policy changes. CHECKING with review approved only
records an observed prerequisite: it grants no approve/merge/deploy authority. A
future action controller must independently re-read current PR head, branch policy,
checks, conflicts and review immediately before any authorized transition; these
read-only observations are not atomic with GitHub mutations.

Real API probes distinguished failed checks on #459 from successful checks and
separate review on #461. This is not a claim that those historical PRs are open.
The service invokes admission observations only for a publication it just verified
as open. PR #467 merged as64d28b8; publisher-only activation passed. Recurring generation, signing,
review execution and whole unattended-cycle proof remain pending under #431.

Independent Spec review caught the creation-ID chronology assumption. The correction
uses submitted_at, rejects missing/invalid/future timestamps and conflicting decisions
at an indistinguishable latest time. Pending reviews have no submitted_at until
submission; see [GitHub review API](https://docs.github.com/en/rest/pulls/reviews).
The initial full run was stopped for this correction; an earlier run was stopped
for a test fixture lint directive. Neither is counted as passing qualification.

Validation:49 focused tests and all2,381 full qualification tests (1,275 Node,
147 PostgreSQL,959 Python), formatting/lint/types/build/schema/replay/secrets/audits
and four sample/deployment configuration checks pass. Both independent reviews
passed after the submission-order correction. Graphify:14,791 nodes/24,425 edges/
877 communities, with the existing pyproject zero-node warning.
[Exact receipt](evidence/review-admission-validation.json).
Both hosted runs41155502061/41155542251 passed with exact checked-out a688b33.
Independent authenticated aloycwl review preceded merge. Publisher artifact and
manifest were updated without restarting trading. A systemd probe under the actual
dedicated publisher UID, credential loading and filesystem restrictions returned
BLOCKED/CI_FAILED for459 and CHECKING/INDEPENDENT_REVIEW_APPROVED for461. The
publisher timer/service remain active and the real publication reconciles MERGED.
