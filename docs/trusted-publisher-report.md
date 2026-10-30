# Local signed research draft publisher

Issue [#452](https://github.com/AegisFintech/scalping-bot/issues/452), depending on
#448 source verification and #451 independent candidate attestation.

The operator selected local execution after GitHub rejected Actions-created PRs
with organization-policy HTTP409. The publishing workflow is removed. Existing
required hosted qualification remains; no organization setting needs changing.

`scalper-research-publisher.timer` runs a dedicated unprivileged local service.
It uses the existing `AegisWalletApp` credential through systemd LoadCredential;
`aloycwl` remains the independently authenticated reviewer on tc01. This existing
credential has broader repository privileges than this service needs: it is NOT a
new least-privilege App token. The root-owned code, fixed operations, filesystem
sandbox and branch protection constrain this implementation. Research workers
receive neither credential, and the publisher cannot read the signing private key,
broker environment, demo storage or root home. A dedicated narrow App token would
further reduce the credential compromise boundary, but is not required for the
operator-selected local route. Never copy reviewer credentials into this service.

## Authority and durable delivery

A protected parent signs canonical publication bytes only after independent
attestation. Its private key stays under `/etc/scalper-publisher/authority`, outside
the publisher-owned state directory. The public signer is committed. Root owns
`/var/lib/scalper-publisher-queue`; each request is named by its payload SHA256.
The service checks ownership/permissions, signature, exact base, result/finding
hashes, candidate bundle and independent28-case receipt before preparing Git files.
At most four queued requests are considered per bounded service run. Unknown queue
entries, excessive requests, invalid signatures and unavailable identity fail closed.

The first bounded task only adds a recorded-payoff research module and fixed
provenance note. Model prose cannot alter protected paths. Parent-owned templates
update README/AGENTS; static style/type checks never modify attested bytes. No model
or candidate is executed by the publisher. Git uses ordinary secret/pre-push hooks,
with a pinned Graphify toolchain and deterministic commit identity/time/tree/message.

Per-request immutable phase receipts bind proposal, commit, push intent/confirmation,
PR intent and verified remote PR. Existing remote PRs must match exact commit,
repository, base and publisher before recovery returns them. Lost push replies
recover from either the persistent checkout or a fresh clone. Lost PR replies
reconcile by deterministic branch; closed/merged PRs never reopen. A dirty partial
checkout is preserved and blocked rather than erased or guessed safe. Main drift
blocks new publication; historical existing PR reconciliation remains available.
The service never force-pushes, deletes branches, reviews, merges or deploys.

The publisher creates a draft. CODEOWNERS names `aloycwl`; required independent
review, stale dismissal, last-push approval and exact-head qualification remain
server enforced. Credential-backed local pushes use the existing push/PR CI events;
no extra workflow dispatch or Actions PR permission is needed.

## Monitoring and operations

The two-minute timer serializes runs with a file lock, bounds runtime/resources and
refreshes `/var/lib/scalper-publisher/status.json` for the existing harness monitor.
An empty queue is IDLE only after protected queue and GitHub identity checks pass.
Failures outrank successful jobs in the public status; raw exceptions and credential
values never appear. Stale receipts remain unavailable in the dashboard. This timer
publishes signed requests; it does not fabricate them or claim the generator,
independent reviewer or economic promotion loop is scheduled.

Activation: install reviewed root-owned source/toolchain at `/opt/scalper-publisher`,
create the dedicated service user/state and root-owned queue, move the existing
signing key to the protected authority directory, and load the existing credential
from a root-only file. Verify unit sandbox, actor identity, queue rejection/recovery,
natural timer and monitor readback. Preserve all receipts and original signatures.
Rollback disables only this publisher timer/service; it does not delete queued jobs,
PRs, commits, experiment evidence or trading state. In-flight remote writes must be
reconciled by exact branch/head before any retry or replacement.

## Local revision validation

Thirty focused publisher/service tests pass, including signed tampering, actual Git
commits, persistent/fresh-checkout lost-push recovery, lost PR-create replies,
conflicting phase receipts, identity mismatch, bounded queue, failure precedence
and unchanged exact-head validation. Both independent Standards/Spec reviews found
no code blocker. The installed systemd unit ran as the dedicated user: verified idle,
rejected a real signed stale-base request with PUBLICATION_MAIN_DRIFT before remote
writes, then recovered to idle after archiving the probe. The account cannot read
the signing key or modify installed source. The timer remains disabled pending
reviewed delivery. [Local probe](evidence/local-publisher-probe.json).

The initial full-check invocation stopped before checks because the removed workflow
was not yet staged; after staging, another run was intentionally interrupted to
correct a trailing blank line in the service unit. Neither is counted as passing.
The Graphify dependency audit initially rejected a CLI flag combination; rerunning
with explicit no-deps for the complete pinned lock passed with no known vulnerabilities.
Full revised qualification passed:1,275 Node,147 PostgreSQL and940 Python tests
(2,362), all required gates and four configuration checks. Commands: `npm run qualify`,
both `npm run config:check` modes on sample/deployment files, `graphify update .`,
`systemd-analyze verify`, and the actual oneshot probes above. Graphify:14,755 nodes,
24,345 edges,866 communities; existing pyproject zero-node warning persists.
[Revised qualification receipt](evidence/local-publisher-validation.json).
Earlier counts below describe the previous source.

## Development validation

Nineteen publisher tests pass, including real temporary Git repositories, signed
bytes/tampering, exact commit creation, source drift, lost push replies recovered
from a fresh clone, lost PR-create replies, duplicate recovery, and changed PR heads.
The creation response uses the same exact-head/repository/base/publisher checks as
existing PR recovery and additionally requires an open draft. Independent review
caught that creation-response gap before delivery.

Qualification now binds every file under `policy/`, `.github/`, `.githooks/` and
`systemd/`, including extensionless signer/CODEOWNERS/hooks. Four regressions prevent
reusing qualification after authority-file changes. The first qualification run
was intentionally stopped for this correction and is not counted as passing.

A real archived #451 candidate passed signature authentication and was rejected
for stale main before any GitHub write or candidate execution. Its original
attestation/archives remain intact. Graphify's publisher toolchain is separately
version-locked and its dependency audit passed (no known vulnerabilities).

Full qualification passed:1,275 Node,147 PostgreSQL and929 Python tests (2,351),
all required gates/audits and four sample/deployment configuration checks.
[Qualification receipt](evidence/trusted-publisher-validation.json).
Graphify updated14,725 nodes/24,262 edges/856 communities with the existing
pyproject zero-node warning. Both independent reviews passed after the PR-response
binding correction; the authority-file fingerprint addition was separately reviewed.

Main now enforces one approving review, stale dismissal, code-owner review and
last-push approval, while preserving administrator enforcement and the strict
GitHub Actions check. [Server readback](evidence/publisher-review-enforcement.json).
The CODEOWNERS file is still pending this PR's merge. This is stronger enforcement,
not authorization for a research worker to approve itself. Automated publication
and its actual candidate review remain separate operational acceptance.
