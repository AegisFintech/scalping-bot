# ISSUE-301 — Terminal conflict evidence and recovery

Issue: https://github.com/AegisFintech/scalping-bot/issues/301.
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
resolved conflict while retaining its earlier proof. Full qualification is pending
before merge or activation.
