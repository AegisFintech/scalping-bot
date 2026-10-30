# Signed research draft publisher

Issue [#452](https://github.com/AegisFintech/scalping-bot/issues/452), depending on
#448 source verification and #451 independent candidate attestation. Development
in progress; no scheduled signer, generator or publisher is activated by this text.

The existing GitHub Actions App supplies a repository-scoped job token with only
contents/PR write access for publishing. The designated independent reviewer is
`aloycwl`, authenticated separately on tc01; no reviewer credentials are copied
into research workers. This resolves the earlier local-only identity search.
[GitHub documents the App token and its lifetime](https://docs.github.com/en/actions/concepts/security/github_token).

Only a protected parent's SSH signature authorizes publication. Its private key
stays root-only outside the repo and worker namespaces. The committed public signer
verifies canonical bytes, the exact base, result/finding digests, candidate bundle
and independently checked28-case receipt. Model-generated prose cannot edit paths,
README, AGENTS, workflows, keys, tests or execution. The first bounded task can only
add the recorded-payoff module and its fixed provenance note; existing research
requires a new reviewed task. Static style/type checks must pass without modifying
the attested bytes.

A main-only workflow accepts the existing operator dispatch identity, verifies the
signature, checks main again before writes and after push, and commits only the
fixed candidate files plus parent-owned README/AGENTS metadata. The deterministic
commit binds author/time, parent, tree and message. Normal secret scan and pre-push
Graphify/documentation hooks remain active. Existing PRs must match the exact
expected commit, repository, base and publisher identity before duplicate recovery
returns them. Unknown remote failures remain unknown; no force-push, branch deletion,
merge, economic activation or deployment is performed by this publisher.

The publisher creates a draft. CODEOWNERS names `aloycwl`; server-side required
review, stale dismissal and exact-head checks must be verified before unattended
publishing is activated. The signer/controller, durable dispatch receipts, real
research PR, independent review and full natural cycle still need operational proof.

GitHub-token pushes do not start ordinary push CI; automation-created PR runs can
require approval. The qualification workflow therefore also accepts explicit
workflow dispatch and checks its exact event SHA with no persisted checkout token.
The trusted controller must verify the candidate before approving/dispatching CI.
[GitHub event behavior](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).

Qualification, failure recovery, independent review and actual activation results
will be recorded here. Infrastructure delivery is not whole-loop completion.

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

## Organization policy blocker

The repository setting to permit Actions-created PRs was rejected with HTTP409:
“The organization does not allow GitHub Actions to create or approve pull requests.”
The change did not apply. The independent reviewer identity is available; this is
an organization policy boundary, not a reviewer sign-in failure. The installed Apps
visible through the reviewer identity are third-party integrations, not a configured
harness publishing key. No third-party App identity or credential is repurposed.

Activation requires an explicit organization-policy decision or a separately
provisioned repository-scoped publishing App. The workflow remains undispatched;
no permission bypass, worker credential sharing or fallback to a broad operator PAT
is used for automatic publication. Code delivery and narrow publication design
remain reviewable while the organization decision is pending.
