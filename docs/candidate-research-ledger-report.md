# ISSUE-304 — Candidate research ledger and evaluation boundary

Issue: https://github.com/AegisFintech/scalping-bot/issues/304.
Status: implemented for qualification; no candidate promotion or new study started.

## What runs automatically

The candidate intake service scans at most 1,000 daily/weekly job directories and
imports at most two previously unseen completed jobs per invocation. It verifies
bounded generator claims, aggregate input hashes and report contracts, and records
failed proposal generation as well as successful reports. Daily jobs cannot
introduce candidates. Symlinks, contradictory outcomes and invalid evidence reject.
The hourly timer has no network access, database/broker credentials, model calls,
GitHub commands or promotion authority. It does not retry the failed October weekly
Codex claim or alter any existing research report.

Every intake, manual trial, source review, registration and evaluation attempt is
recorded in a separate private SQLite ledger. FULL synchronization, transactional
sequence allocation, hash chaining and update/delete rejection protect normal
append-only operation. An OS lock serializes complete operations. Unsupported
ledger versions reject instead of being silently migrated. This is a separate
research database; no trading tables are changed. Raw bounded proposals, including
invalid ones when available, are retained by digest. Lexical hypothesis deduplication
marks repeats without dropping attempts; it does not claim semantic equivalence.

A crash retains its durable claim. The review packet explicitly counts unfinished
attempts as unknown, alongside successes, failures and duplicate proposals. No
claim/report is deleted or overwritten to obtain a better result. Completed intake
claims are not replayed automatically; ambiguous interrupted intake needs a
separately recorded review. Limits are 10,000 events, 32 MB of event bodies, bounded
source/input/report files and exclusive publication. Capacity failure stops research.

## What still requires a concrete review

A model-provided URL is not independent source verification. `review-source`
requires a separately retrieved UTF-8 source snapshot, the exact cited HTTPS URL,
retrieval time, reviewer identifier and explicit claim-support rationale. The
receipt is honestly labelled **operator-attested independent retrieval and claim
review**, not an automated truth judgement or economic validation. Content hashes
are checked again before registration and evaluation. No URL is executed, no
external instructions become tools, and the scanner cannot grant source review.
These receipts are local trusted-operator attestations, not cryptographic proof
of a reviewer's identity. Private audit packets need normal review/secret scanning
before publication to GitHub.

Registration requires all cited sources reviewed, one of the existing implemented
changes (`model_levels`, `tp_0_75`, `tp_1_25`), a named protocol reviewer and explicit
predeclared rejection conditions. Arbitrary model-generated tactics/code are not
executed. A new indicator combination needs a separately tested implementation
and review before this closed set expands. Registration must precede a start in
the next 24 hours and fixes 30 daily windows, release, code/source hashes, source
receipts and ten-minute settlement delay. Existing #255 registrations, frozen
source and reports are never edited or reused as a new untouched sample.

## Evaluation and evidence

The evaluator consumes a separately produced bounded #253 offline input and
verified sampled-quote recordings. It does not fetch account data. Each input must
match exactly one registered daily window and release, after cutoff plus ten
minutes. Early checks return WAIT without consuming an evaluation. Once a due
window is attempted, failures/unknown outcomes remain visible and it cannot be
rerun with a more favourable path. Missing days remain missing; they are never
zero P/L or removed from the registered denominator. Source drift before or during
evaluation stops research only.

The actual existing paired engine retains provider availability, broker acceptance,
GTC lifetime, daily cutoff/open/gap/OCO censoring, all exclusions and unknown
counterfactual costs. Approved quantities remain frozen, not dynamically resized
portfolio equity. A selected hypothesis changes one economic component, but the
existing paired engine exposes all three predeclared variants under base/stress;
the protocol explicitly records that three-variant comparison family for
multiple-testing accounting. No subset is ranked or promoted. Every report and
review packet remains **HOLD**, with null counterfactual net P/L. Thirty days is a
collection batch, not qualification. No numeric statistical threshold is invented
while the separate #290 evaluation design remains under review.

## Commands

Run the trusted CLI under the isolated research identity against a private ledger:

```text
python -m python.research.candidate_lab --directory LAB scan --reports JOBS
python -m python.research.candidate_lab --directory LAB ingest --report REPORT
python -m python.research.candidate_lab --directory LAB review-source --hypothesis HASH --url URL --content SNAPSHOT --retrieved-at UTC --reviewer REVIEW_ID --rationale TEXT
python -m python.research.candidate_lab --directory LAB register --hypothesis HASH --candidate model_levels --start FUTURE_UTC --reviewer REVIEW_ID --rejection-rule TEXT
python -m python.research.candidate_lab --directory LAB evaluate --registration NUMBER --day 0 --input PAIRED_INPUT --recordings RECORDINGS
python -m python.research.candidate_lab --directory LAB packet --output NEW_PACKET
```

These are literal argument placeholders, not shell commands copied from external
sources. Review packets include the whole trial chain and explicit limitations;
they support an evidence-bearing issue/PR, never automatic merge of an economic
change. The service template targets an immutable tracked-source deployment at
`/opt/scalper-candidate-lab/current`, using the existing isolated research Python
environment. Its writable ledger directory must exist with the research user's
ownership before service start. It has CPU/memory/file/time limits and AF_UNIX
only. No runtime unit has been activated yet.

Rollback stops only the intake timer and retains the ledger and immutable
artifacts. Do not delete trials, rewrite registrations, reset accounting, edit
existing studies or restart trading services as part of rollback.

## Validation

Fourteen focused tests pass. They cover duplicate/failure retention, append-only
SQL rules and restart verification, source-review requirements, no backdating,
future waiting, immutable reports and no replay, source/code/protocol/window drift,
authority rejection, actual paired-engine empty-cohort output, unsupported ledger
versions, failed generator intake/deduplication and explicit unknown-claim/schema
validation. The latter rejects promotion authority in the published JSON Schema.
Full Python and hosted qualification remain required before merge/activation.

The complete Python run passes **299 tests**, with three storage tests explicitly
skipped because this invocation has no isolated TEST_DATABASE_URL. They are not
counted as passing; isolated database qualification is next. Full Python/dashboard
mypy passes (43 source files), focused Ruff passes, and graphify was refreshed
without provider calls (existing pyproject empty-node warning).

Final isolated qualification (`npm run qualify -- --database-only`) passes **73
PostgreSQL lifecycle tests and all 302 Python tests, with no skips**; evidence is
`/tmp/scalper-qualification-n79wvg/checks`. A read-only intake smoke test against
the existing research jobs imported the real daily report and the preserved weekly
failure into a separate temporary ledger: one PROPOSALS event, one
PROPOSAL_GENERATION_FAILED event, zero scan failures, zero provider calls and no
broker authority. No original job, claim or report was modified. Full exact-head
hosted qualification still gates merge and timer activation.

Failed evaluations also retain the exact bounded input artifact and its digest,
registration/code references and any successfully loaded tape-evidence digest
before replay begins. Preflight failures that never read input remain explicit
failures with no fabricated input hash. Review packets retain those intermediate
receipts as well as terminal/unknown outcomes.
