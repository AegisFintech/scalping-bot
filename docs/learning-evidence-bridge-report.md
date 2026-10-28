# Read-only learning evidence bridge — ISSUE-399

The bridge projects the existing demo journal and retained Flight summaries into
an immutable, content-addressed research archive. It does not create a second
executor, call the provider, consume a protected dataset partition, record an
autonomous finding, or authorize promotion. This bot remains the sole broker
executor; tc01 is a recipient of sanitized observations only.

## Boundary and coverage

`python.operations.export_learning_evidence` uses the existing SELECT-only
reader, one repeatable-read journal snapshot, bound SQL parameters, statement and
wall-clock limits, a maximum one-hour window and bounded row counts. Ambiguous
account scope, capacity overflow or invalid contracts fail rather than truncate.
The cohort includes records observed or changed in the window, active carry-in
setups and linked references. A complete scoped export is not a census of market
opportunities, a complete tick tape or proof of valid execution.

`scalper-learning-evidence-1.0` retains context decisions including WAIT, failures
and rejected analyses; model plan prices, capture-relative expiry, typed market
context where available; approved sizing; actual order, fill, partial-close and
closed-outcome evidence; retained protection/conflict facts and separate broker
clocks. Placement-result persistence is not broker submission. Missing historical
facts, unavailable provider identity/cost and counterfactual economics remain
explicitly unknown. Approved allocation is not actual filled stop risk.

Private identifiers become opaque scoped references. Raw payloads, credentials,
account identifiers and model narrative are withheld; hashes preserve references
to original local evidence. The market object is a typed projection, not the exact
original request bytes. The exporter hash identifies its file, not an independent
attestation of the entire source or deployed release.

Recorded clocks are classified as causal, unordered or incomplete. Contradictory
clocks cannot be labeled causal; unordered observations remain available for
censoring. Local persistence must not postdate the journal snapshot. Flight is
read separately, ordered by its own observation time and explicitly unverified:
summary metrics are not a chain-verified tick path or proof of an executable exit.

## Recipient and retry behavior

`python.research.learning_archive` validates byte limits, duplicate JSON keys,
transport SHA-256, strict field/semantic contracts, revision seals and source
scope before publication. Its only output is a private filesystem namespace:
immutable deduplicated records and packet manifests, plus an atomically replaced
latest index. It does not connect to the Aurum database or protected archives.

A lock serializes import. Unique temporary files, file/directory fsync and
exclusive publication prevent a partial record write from poisoning a retry.
Corrupt existing records and conflicting revisions at the same observation clock
are rejected. Older revisions remain retained without replacing newer pointers.
Capacity exhaustion fails without deleting learning records. No polling service
or model consumption is installed by this batch; data admission belongs to #402.

## Verification status

Focused checks pass: 27 Python bridge tests, five JSON Schema tests, all source
mypy and Ruff. Both independent Standards and Spec reviews found no remaining
blocker after corrections and regressions. Isolated database qualification passes:
132 PostgreSQL lifecycle tests and 587 Python tests, no skips. The only warning is
existing Starlette/httpx test-client deprecation. Full qualification passed: 1,157 Node/schema/migration tests, 132 PostgreSQL
lifecycle tests and 587 Python tests (1,876 total), no skips. Formatting, lint,
types/build, replay/fail-closed fixtures, secret scan and npm/pip audits pass.
Command: `PYTHONDONTWRITEBYTECODE=1 /opt/scalper-node22/bin/node scripts/qualify.mjs`.
Exact check commands/results and source fingerprint are in
[`learning-evidence-bridge-validation.json`](evidence/learning-evidence-bridge-validation.json).
AST Graphify refreshed; its existing pyproject zero-node warning is unrelated.

Real cross-host receipts are in
[`learning-evidence-bridge-rollout.json`](evidence/learning-evidence-bridge-rollout.json).
The fresh thirty-minute cohort imported 66 observations; its duplicate changed
zero records. A historical window selected from the latest setup metadata,
without using its outcome, imported 31 observations including one closed setup,
1,753 protection facts and two available Flight summaries. Its duplicate also
changed zero records. The bounded history is incomplete before its start; neither
window is a trading performance study or an autonomous finding.

The existing Flight reader initially refused nine required evidence tables.
SELECT alone was added on `scenario_contexts`, `context_provider_evidence`,
`provider_prompt_artifacts`, `context_entry_retirements`, `model_requests`,
`risk_decisions`, `position_protection_events`, `broker_execution_event_variants`
and `position_close_deals`. A live privilege check confirmed zero table mutation
grants and no privileged-role attributes. These grants remain local to the
existing reader; revoke those nine additions to undo this access expansion.
No database schema or accounting transition occurred.

The exporter artifact is `/opt/scalper-learning-399`, separate from the trading
release, using the existing Flight interpreter and SELECT-only credentials.
The tc01 recipient uses a separate matching-Pydantic environment and a dedicated
non-login user, private archive and no broker/provider credential environment.
Its fourteen source files matched the recorded manifest. It cannot read `/root`.
No importer daemon, model admission or trading service restart was installed.
Existing root research execution is a separate isolation concern for #401; the
archive user does not claim to sandbox that existing process. Account overlap and
cross-account pricing equivalence remain unknown and are not assumed.

Qualification and smoke tests caught issues before delivery: a missing deadline
in a new GTC fixture; typed schema-test lint; exponent-form database zero; repeated
correlated protection-history scans; and over-restrictive precision for weighted
Flight entry metrics. These are fixed without rounding or a larger timeout.
The history reader now uses one scoped window calculation and preserves all
latest-prior ties. Capacity overflow remains an explicit refusal: the first
historical window exceeded 2,000 protection facts, so the metadata-selected
window was narrowed rather than silently truncating. Interrupted qualification
attempts and pre-fix failures are not claimed as passing results.

## Rollback

Stop invoking the exporter/importer and retain the archive for audit. No trading
service, schema migration, risk setting, accounting baseline or frozen research
registration is changed. Removing code must not delete archived observations.
