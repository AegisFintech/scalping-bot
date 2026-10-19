# ISSUE-301 — Terminal conflict evidence and recovery

Issue: https://github.com/AegisFintech/scalping-bot/issues/301.
Evidence prerequisite: https://github.com/AegisFintech/scalping-bot/issues/309.
PR: https://github.com/AegisFintech/scalping-bot/pull/308.
Status: implementation in progress; no operational recovery or deployment claimed.

## Confirmed gap

Persistence previously discarded a second normalized payload with the same event
key and a different hash. It replaced any earlier reasons with KEY_CONFLICT.
Terminal recovery requires a separate mapped closing event, so a conflict on that
closing event itself cannot prove its own recovery. Ordinary history recovery
selects active groups only. A flat broker snapshot cannot repair this evidence gap.
The historical incident's discarded callback remains unavailable; matching the
original financial facts does not establish what the discarded callback contained.

## Evidence checkpoint

Migration 0027 adds a separate normalized-variant journal. On a conflict, the
store atomically retains the original and distinct incoming payload/hash/source,
together with the prior mapping, reasons and resolution reference. Callback and
history-reconstruction sources are explicitly distinguished; callers without
provenance are marked UNSPECIFIED. Reconstructed protection is not fresh broker
protection evidence. No historical variant is fabricated or backfilled.

The original event payload/hash stays unchanged. Existing reasons survive the
additional conflict reason. A newly observed variant reopens a resolved marker,
retaining the previous resolution in its variant snapshot. Repeated identical
variants deduplicate by event/hash/source. Failed variant persistence rolls back
the whole transaction. The recorder's existing in-process duplicate-fill filter
is unchanged: this journal captures conflicts reaching persistence, not every raw
broker callback or a complete wire archive.

Dashboard guidance now acknowledges that closing-event conflicts or discarded
historical variants can need reviewed attestation; it no longer promises that
automatic recovery always clears them. There is no lock reset, order command,
trade rewrite, economic change or authority increase.

## Strict proof checker

The isolated `terminal-conflict-proof.ts` checker compares every normalized
identity, monetary, price, quantity and timestamp field across retained variants;
only historical position SL/TP context and receipt metadata may differ. It
requires an originally mapped, reason-free journal snapshot and an independently
retained callback variant. Missing legacy evidence and unspecified provenance
reject. It verifies one exact order/deal against fresh, bounded, unpaginated
history; missing monetary fields reject rather than inheriting normalization
fallbacks. Raw history receives a separate evidence digest. Reconstructed local
position context is never represented as independently observed protection.

Twenty-two unit cases cover context-only agreement and financial/identity/time/
volume conflicts, missing variants, stale/incomplete/duplicate history and missing
cost fields. This checker has no database or broker connection and is not wired
into operational recovery. A match alone cannot release a group: complete entry,
peer and trade proof plus a separate attestation journal are still required.

## Remaining acceptance

A separately journaled bounded authoritative-history attestation must verify exact
owned terminal entries, peer, complete position/trade and every financial/time/
volume field. Missing variants must remain explicit; unknown or contradictory
facts cannot be accepted as harmless. This checkpoint does not introduce that
resolver or claim to restore trading. The frozen observer source is untouched.

## Migration and rollback

Apply 0027 through the normal ordered migrator after qualification. It only adds
a table; it does not rewrite trades or prior migrations. Reverting the application
leaves evidence readable in the retained table. Do not drop the table or restore
an older database over later events. No operational migration has been performed.

## Validation

Focused execution/recovery/migration tests: 39 passed. Additional PostgreSQL
regressions cover terminal conflict retention, source distinctions, duplicate/
restart behavior, rollback on invalid provenance, and preservation of mixed
failure reasons. The first full local run stopped on two test-only unsafe-access lint errors;
those were corrected. The first database run passed 71 cases and caught a new
fixture that changed a non-deal event key instead of creating a same-key conflict;
the fixture now uses a deal identity. A further regression covers reopening a
resolved conflict while retaining its earlier proof. The database rerun passes all
73 cases (`/tmp/scalper-qualification-igm1Ua/checks/database-lifecycle.log`). Python
passed 287 cases and caught the old dashboard assertion promising manual recovery
was unnecessary; that assertion now checks the corrected attestation/flat-account
guidance. Full hosted qualification is pending before merge or activation.

## Delivery boundary and outstanding work

The current incident's discarded variant cannot be recovered by this patch.
The safe automated policy explicitly rejects missing evidence. Any legacy terminal
supersession policy must first state which independently attested facts can
supersede that uncertainty and retain the missing-variant limitation; it must not
claim the discarded callback was harmless. No such transition has been performed.
#303 trading-provider activation remains dependent on #301 recovery. #304 candidate
qualification also needs independently verified sources and untouched future
outcomes; scheduled proposal generation is not completed strategy evaluation.
No economic or provider switch is included in this checkpoint.

The first hosted runs on 732dba3 stopped at TypeScript checks: two new test row
accesses needed explicit possibly-undefined handling. Those assertions now use
optional access, so missing rows fail the assertions instead of bypassing checks.

## Qualified checkpoint

Both complete `npm run qualify` hosted runs pass on `c654804aae872f8a97be998322523d93c7a640bf`:
[push qualification](https://github.com/AegisFintech/scalping-bot/actions/runs/39194061154)
and [PR qualification](https://github.com/AegisFintech/scalping-bot/actions/runs/39194064902).
These include formatting, ESLint, TypeScript/build, Node/schema/migration/replay
checks, Python format/lint/types/tests, isolated PostgreSQL lifecycle tests,
secret scanning and both dependency audits. Focused final history-proof tests:
22 passed; dashboard tests: 58 passed; isolated database suite: 73 passed.
Graphify was refreshed without provider calls; its existing pyproject empty-node
warning remains. No tracked runtime evidence, credential or frozen-study file
was changed. Documentation receipt changes still receive final-head CI before merge.

Final review additionally checks the raw closing order and deal side against the
opposite owned-position side, and any explicit order position identity. Those
fields are not all retained by normalized fills, so normalized equality alone was
insufficient. The focused checker now has 22 passing cases; the final source
revision requires its own complete hosted qualification before merge.

Final code qualification: `87739595ccb684477fc714d049c3cb256207621f` passes both
complete runs [39194701358](https://github.com/AegisFintech/scalping-bot/actions/runs/39194701358)
and [39194705666](https://github.com/AegisFintech/scalping-bot/actions/runs/39194705666),
including all required gates and clean dependency audits. The additional raw
position-ID type guard also passes lint. The frozen checkout remains clean at
`984f479`; read-only demo status still reports the original journal conflict.
Source delivery does not claim operational recovery. This final documentation
receipt will also receive exact-head CI before the evidence-only PR merges.

## Full-group attestation implementation

The follow-up adds migration 0028 and a separate bounded history-attempt journal.
One closed demo group is durably claimed per maintenance pass, with five-minute
backoff and at most three attempts per rolling day. Requests for order history,
deal history and reconciliation run serially. Windows exceeding seven days,
paginated/oversized histories, stale replies, non-flat account state, unknown
costs, partial entries and additional unresolved event kinds reject. Rejected
or verified variant sets are not automatically refetched; new retained variants
allow another bounded attempt. No unknown request is immediately replayed.

The proof requires both exact owned terminal entry orders, explicit zero-fill
peer evidence, all entry/close deals, closed positions and trades, matching
identities, prices, volumes, timestamps, commissions, swap, FX fees and net P/L.
One or two fully filled legs are supported. Partial/race cases outside this
strict contract remain blocked. Broker position protection is not reconstructed
for entry history comparison and history does not assert fresh protection.

Callback persistence and terminal reconciliation share a bounded scope lock.
The independent history fetch holds no database transaction. Completion rereads
the local snapshot, and terminal reconciliation rereads it again before using a
verified attempt. The snapshot binds original event facts and every variant;
only resolution-marker booleans are excluded from its digest for idempotent
restart use. The proof checker never ignores conflicting facts just because a
marker was previously resolved. A new variant or financial mutation invalidates
the proof. Original payloads/reasons/mapping remain immutable; resolution links
use `history:<attempt UUID>`, not a fabricated broker callback.

Missing pre-0027 variants remain `DEMO_TERMINAL_VARIANT_MISSING_REVIEW_REQUIRED`.
This policy cannot establish what the discarded callback contained and does not
unlock the October incident. An explicit separately reviewed legacy transition
would be required; no accounting baseline, trade, provider or strategy changes
are included. Frozen observer checkout remains clean at `984f479`.

Migration 0028 is additive. Rollback reverts application readers while retaining
both evidence tables; never drop evidence or restore an older trading database.
No operational migration or restart has been performed.

Validation: the first isolated run exposed an invalid use of the callback
normalizer without an entry position. Entry history now directly compares raw
order/deal facts against local fills without fabricating a position. The rerun
passes 85 PostgreSQL lifecycle tests and all Python tests (`npm run qualify --
--database-only`, `/tmp/scalper-qualification-4xPMeH/checks`). Added regressions cover
full-group success/restart, missing variants/costs/zero-fill volume, contradictory
fees/peers, extra deals, stale/truncated histories, broker failure/backoff, new
variants and mutation during retrieval. Full final qualification is pending.

The complete local qualification (`npm run qualify`) passed every required gate,
including both audits, 85 PostgreSQL tests and 288 Python tests, with evidence at
`/tmp/scalper-qualification-8z7kf7/checks`. Final review extends the positive
lifecycle fixture to include native close acknowledgements/amendments. These are
eligible only when their exact order/position has the separately verified closing
fill; unrelated or missing-child evidence remains rejected. That final adjustment
requires focused database and exact-head full hosted qualification before merge.

The extended fixture confirms the original close already resolves its acceptance
marker; the remaining conflict and amendment resolve together (two updates).
Entry history also checks the broker's original requested volume against the
approved normalized order volume; matching executed volume alone is insufficient.

Final focused database qualification passes 86 PostgreSQL lifecycle cases and
288 Python tests (`/tmp/scalper-qualification-hvYcU3/checks`). The frozen source
remains untouched. Full hosted checks on the pushed head are required before merge.

Attestations are explicitly versioned `full-group-v1`; the resolver rejects an
unknown verifier version rather than inheriting another policy's conclusions.
Any future proof-policy change must use a new version and requalification.

The verifier-version rejection case also passes: final isolated qualification
reports **87 PostgreSQL tests and 288 Python tests** at
`/tmp/scalper-qualification-uEglj3/checks`. Focused history proof remains 22/22;
TypeScript and focused ESLint pass. Final-head full CI remains the merge gate.

Full-group implementation PR: https://github.com/AegisFintech/scalping-bot/pull/310.
Both exact-head hosted qualifications must pass before this PR becomes mergeable;
#301 remains open for legacy incident policy and verified operational activation.
