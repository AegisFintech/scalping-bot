# ISSUE-314 — Operator-authorized fresh demo epoch

Issue: https://github.com/AegisFintech/scalping-bot/issues/314.
Status: preparation; no cutover or new trading claimed yet.

On October 19 the operator explicitly requested “clear all historical records and
start from afresh” after reviewing the legacy conflict blocker. This authorizes a
one-time fresh local demo accounting epoch. The implementation uses a separate
empty operational database; previous history is absent from the new dashboard,
but the old database and immutable research/evidence remain isolated. There is no
DELETE/TRUNCATE, broker balance reset, history import or assertion that discarded
callbacks were harmless. This authorization is not a recurring recovery shortcut.

## Transition and acceptance

1. Verify current explicit demo authorization and the existing selected demo
   account, empty broker orders/positions, complete current-day deals/flows and no
   in-flight provider request. Stop only the five trading services normally before
   cutover; no forced cancellation, closing or callback replay.
2. Create a separate local database from existing forward migrations, preserve TLS
   and application/migration role separation, and use separate writable runtime
   and logs. Keep existing subscription/broker authentication; credentials alone
   do not grant trading authority. Use a new protected environment derived from
   the existing file, retaining its original values except database/runtime and
   temporary maintenance controls.
3. Prepare a fully qualified immutable release. Start with emergency stop enabled,
   submission and automatic analysis disabled. Initialize reconciled daily/capital
   baselines through the existing authenticated audit endpoint. Reject nonempty
   broker state or current-day trades; never insert an invented balance. Verify
   the second initialization rejects and the baseline survives restart.
4. Restore the existing authorized demo controls, verify actual supervisor paths,
   config checks, broker/session/account state and all gates. Observe natural
   market-open evaluation without forcing a provider call or order. Both legs
   continue sharing the dynamic 1% setup ceiling. Live remains disabled.
5. Point maintenance at the new runtime/database only. Keep the frozen #255
   checkout, registrations, reports and old source environment unchanged; the
   epoch boundary is explicit, not a fabricated continuous trading series.

The current Grok/fade policy remains unchanged. Codex transport/research work is
separate from activating a different trading provider. No economic strategy,
leverage, sizing percentage or protective maintenance change is included.

## Operational limits and rollback

The initial filesystem had only about 1.7 GiB free (97% used). Regenerable package
caches are being reclaimed before deployment; historical trading/research files
are not disposable build cache. Record final free space and storage health.
Backup work remains operator-deferred; do not claim a restore or external backup.

Before any new activity, stop the new services and retain both databases if
activation fails. After any new request/order/accounting activity, the old database
is no longer a valid execution rollback target. Roll back compatible code only
against the newest database, preserve every new claim/order/accounting row and
reconcile broker truth. Never run both epochs' trading writers concurrently.

## Validation

Full local qualification and final-head hosted checks are required before rollout.
The existing authenticated baseline initializer and lifecycle tests supply success,
repeat-rejection and fail-closed coverage; no executable source behavior is changed.
Operational checks and immutable release/configuration receipts will be added
without private identifiers, credentials, URLs or raw broker payloads.
