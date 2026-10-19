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

Twenty unit cases cover context-only agreement and financial/identity/time/
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
20 passed; dashboard tests: 58 passed; isolated database suite: 73 passed.
Graphify was refreshed without provider calls; its existing pyproject empty-node
warning remains. No tracked runtime evidence, credential or frozen-study file
was changed. Documentation receipt changes still receive final-head CI before merge.
